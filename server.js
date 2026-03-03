const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const { execSync, spawn } = require("child_process"); 
const APP_PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, "web");
const DATA_DIR = path.join(ROOT, "data");
const ROOMS_DIR = path.join(ROOT, "rooms");
const DB_PATH = path.join(DATA_DIR, "app.db");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ROOMS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    name: "chatapp.sid",
    secret: "dev_secret_change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
}));

app.use("/web", express.static(WEB_DIR, { extensions: ["html"] }));


// ---------- SQLite ----------
const db = new sqlite3.Database(DB_PATH);
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this) }));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

async function initDb() {
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE, 
        pass_hash TEXT, 
        is_admin INTEGER DEFAULT 0, 
        created_at TEXT
)`);
    
    await dbRun(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT,
    protocol TEXT,
    owner_id TEXT,
    created_at TEXT
)`);               
    
    const admin = await dbGet(`SELECT * FROM users WHERE email = ?`, ["admin@local"]);
    if (!admin) {
        const hash = await bcrypt.hash("admin", 10);
        await dbRun(`INSERT INTO users (email, pass_hash, is_admin, created_at) VALUES (?,?,?,?)`, ["admin@local", hash, 1, new Date().toISOString()]);
    }

    const users = [
    { email: "claudio@local", pass: "12345" },
    { email: "emanuel@local", pass: "12345" },
];

for (const u of users) {
    const exists = await dbGet(`SELECT * FROM users WHERE email = ?`, [u.email]);
    if (!exists) {
        const hash = await bcrypt.hash(u.pass, 10);
        await dbRun(
            `INSERT INTO users (email, pass_hash, is_admin, created_at) VALUES (?,?,?,?)`,
            [u.email, hash, 0, new Date().toISOString()]
        );
        console.log(`Utilizador criado: ${u.email}`);
    }
}
}

// ---------- Gestão de Salas em Memória ----------
const activeRooms = new Map();

// ---------- Auth Middleware ----------
const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).send("Não autorizado");

function getLocalLxcStatus() {
    try {
        // Executa o comando lxc e formata a saída
        // n = nome, s = estado, 4 = ipv4
        const output = execSync('lxc list --format csv -c n,s,4', { encoding: 'utf8' });
        
        if (!output.trim()) return "Nenhum container LXC encontrado.";

        let resumo = "Estado Atual dos Containers LXC (Local):\n";
        const linhas = output.trim().split('\n');
        
        linhas.forEach(linha => {
            const [nome, estado, ipv4] = linha.split(',');
            resumo += `- ${nome}: [Estado: ${estado}, IP: ${ipv4 || 'N/A'}]\n`;
        });
        
        return resumo;
    } catch (e) {
        console.error("Erro ao ler LXC:", e.message);
        return "Aviso: Não foi possível aceder ao serviço LXC local.";
    }
}

// ---------- Rotas ----------
app.get("/", (req, res) => res.redirect(req.session?.user ? "/web/chat.html" : "/web/login.html"));

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
        
        // Se o utilizador existe, comparamos a password enviada com o hash da BD
        if (user && await bcrypt.compare(password, user.pass_hash)) {
            req.session.user = { id: user.id, email: user.email, is_admin: !!user.is_admin };
            return res.json({ ok: true });
        }
        
        res.status(401).json({ error: "Email ou password incorretos" });
    } catch (e) {
        res.status(500).json({ error: "Erro interno" });
    }
});

app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ error: "Erro ao sair" });
        res.clearCookie("chatapp.sid"); // Limpa o cookie de sessão
        res.json({ ok: true });
    });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.session.user }));

app.get("/api/rooms", requireAuth, async (req, res) => {
    const rooms = await dbAll(`SELECT * FROM rooms WHERE owner_id = ?`, [req.session.user.id]);
    res.json({ rooms });
});

app.post("/api/rooms", requireAuth, async (req, res) => {
    try {
        const { name, protocol } = req.body;
        const id = crypto.randomBytes(4).toString("hex");
        const owner_id = req.session.user.id; // Vai buscar o ID de quem está logado

        // 1. Grava na BD incluindo o owner_id para garantir a privacidade
        await dbRun(
            `INSERT INTO rooms (id, name, protocol, owner_id, created_at) VALUES (?,?,?,?,?)`,
            [id, name, protocol, owner_id, new Date().toISOString()]
        );

        // 2. Lança a instância isolada (Passo 3/Ponto 10)
        launchChatInstance(id);

        // 3. Define os dados da sala na memória local
        const newRoom = {
            id,
            name,
            protocol,
            owner_id, 
            lines: [`SISTEMA: Sala '${name}' criada.`],
            proc: null
        };

        activeRooms.set(id, newRoom);
        
        res.json({ ok: true, room: { id, name, protocol } });
    } catch (e) {
        console.error("Erro ao criar sala:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/log", requireAuth, (req, res) => {
    const room = activeRooms.get(req.query.roomId);
    res.json({ lines: room ? room.lines : ["Sala inativa ou a carregar..."] });
});

// Rota para pesquisar utilizadores (excluindo o próprio)
app.get("/api/users/search", requireAuth, async (req, res) => {
    const q = req.query.q || "";
    // server side should also only reject empty queries – one character is acceptable
    if (q.length < 1) return res.json({ users: [] });
    
    const users = await dbAll(
        `SELECT id, email FROM users WHERE email LIKE ? AND id != ? LIMIT 5`,
        [`%${q}%`, req.session.user.id]
    );
    res.json({ users });
});

// --- ROTA DE MENSAGEM COM CORREÇÃO DE LOOP ---
const net = require("net");

app.post("/api/message", requireAuth, async (req, res) => {
    const { roomId, text } = req.body;
    const socketPath = path.join(DATA_DIR, `${roomId}.sock`);
    const room = activeRooms.get(roomId);

    if (!room) return res.status(404).json({ error: "Sala não encontrada" });

    const net = require("net"); // Se não quiseres pôr no topo, deixa aqui, mas garante que o resto está certo
    const client = net.createConnection(socketPath, () => {
        client.write(text);
    });

    client.on("data", (data) => {
        const reply = data.toString();
        room.lines.push(`EU: ${text}`);
        room.lines.push(`BOT: ${reply}`);
        client.end();
        res.json({ ok: true });
    });

    client.on("error", () => {
        res.status(500).json({ error: "A instância bwrap não está a responder." });
    });
});

app.delete("/api/rooms/:id", requireAuth, async (req, res) => {
    const id = req.params.id;
    activeRooms.delete(id);
    await dbRun(`DELETE FROM rooms WHERE id = ?`, [id]);
    res.json({ ok: true });
});

async function boot() {
    await initDb();
    const rooms = await dbAll(`SELECT * FROM rooms`);
   
    for (const r of rooms) {
        const logPath = path.join(ROOMS_DIR, r.id, "chat.log");
        let history = ["SISTEMA: Sala recuperada."];
        
        if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, "utf-8");
            history = content.split("\n").filter(l => l.trim() !== "");
        }

        activeRooms.set(r.id, {
            id: r.id,
            name: r.name,
            protocol: r.protocol,
            owner_id: r.owner_id, // ADICIONA ESTA LINHA AQUI
            lines: history,
            proc: null
        });

        launchChatInstance(r.id);
    }

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
    
    function updateLxcStatusFile() {
        try {
            // Como és ROOT, o comando lxc list vai funcionar sem problemas
            const status = execSync("/usr/bin/lxc list --format csv -c ns").toString(); 
            const statusPath = path.join(DATA_DIR, "lxc_status.txt");
            
            fs.writeFileSync(statusPath, status || "Nenhum container encontrado.");
        console.log("[SISTEMA] Estado atualizado com sucesso.");
    } catch (e) {
        // Log detalhado para sabermos o erro exato no terminal
        console.error("[ERRO DETALHADO LXC]:", e.message);
        fs.writeFileSync(path.join(DATA_DIR, "lxc_status.txt"), "Erro técnico ao aceder ao LXD Daemon.");
    }
}

// Atualiza a cada 30 segundos e corre uma vez no início
setInterval(updateLxcStatusFile, 30000);
updateLxcStatusFile();
    
    // LIGAR O SERVIDOR (Importante: tem de estar aqui ou no fim)
    app.listen(APP_PORT, () => {
        console.log(`Servidor ativo em http://localhost:${APP_PORT}`);
    });
 }

 // --- 2. FUNÇÃO LAUNCH (FORA DO BOOT) ---
 // Estar fora permite que seja chamada tanto pelo boot() quanto pela rota POST /api/rooms
function launchChatInstance(roomId) {
    const socketPath = path.join(DATA_DIR, `${roomId}.sock`);
    const roomDir = path.join(ROOMS_DIR, roomId);
    const scriptPath = path.join(ROOT, "chatConnect.js");
    
    if (!fs.existsSync(roomDir)) fs.mkdirSync(roomDir, { recursive: true });
    fs.chmodSync(roomDir, 0o777); 

    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

    const nodePath = execSync("which node").toString().trim();

    const child = spawn("bwrap", [
        "--ro-bind", "/", "/",
        "--share-net",              // DESBLOQUEIO: Permite falar com a llama.cpp (8080)
        "--dev", "/dev",
        "--proc", "/proc",
        "--tmpfs", "/tmp",
        "--bind", roomDir, "/tmp",
        "--bind", DATA_DIR, DATA_DIR, // Permite criar o socket de comunicação
        "--ro-bind", path.join(DATA_DIR, "lxc_status.txt"), "/tmp/lxc_status.txt", // Permite ler o estado dos containers
        "--chdir", "/tmp",
        nodePath, scriptPath, socketPath
    ], { stdio: 'inherit' });

    child.on("error", (err) => console.error(`[Erro bwrap] ${err.message}`));
    return socketPath;
}

// --- 3. EXECUTAR O BOOT ---
boot();