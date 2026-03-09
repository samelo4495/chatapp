const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const { execSync, spawn } = require("child_process"); 
const net = require("net");
const APP_PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, "web");
const DATA_DIR = path.join(ROOT, "data");
const ROOMS_DIR = path.join(ROOT, "rooms");
const DB_PATH = path.join(DATA_DIR, "app.db");
const AI_STATUS_FILE = path.join(__dirname, 'data', 'lxc_status.txt');

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
    // 1. Criar tabela de utilizadores (se não existir)
    await dbRun(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE, 
        pass_hash TEXT, 
        is_admin INTEGER DEFAULT 0, 
        created_at TEXT
    )`);

    // 2. Criar tabela de salas com target_id
    await dbRun(`CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT,
        protocol TEXT,
        owner_id TEXT,
        target_id TEXT, -- Para conversas P2P
        created_at TEXT
    )`);

    // TENTATIVA DE MIGRAR: Se a tabela já existia sem target_id, isto adiciona a coluna
    try {
        await dbRun(`ALTER TABLE rooms ADD COLUMN target_id TEXT`);
    } catch(e) { /* Coluna já existe, ignorar erro */ }               
    
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

// --- ROTA POST (Garantir que o objeto enviado é sólido) ---
app.post("/api/rooms", requireAuth, async (req, res) => {
    // 1. Adicionamos o targetId aqui (vem do frontend)
    const { name, protocol, targetId } = req.body; 
    const userId = req.session.user.id;
    const roomId = "sala_" + Date.now();

    try {
        // 2. Incluímos o target_id na query SQL
        await dbRun(
            `INSERT INTO rooms (id, name, owner_id, protocol, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`, 
            [roomId, name, userId, protocol, targetId || null, new Date().toISOString()]
        );

        // 3. Guardamos também na memória activeRooms
        activeRooms.set(roomId, { 
            id: roomId, 
            name: name, 
            protocol: protocol, 
            owner_id: userId,
            target_id: targetId || null,
            lines: [] 
        });

        // 4. Retornamos o objeto completo
        return res.status(201).json({ 
            id: roomId, 
            name: name, 
            protocol: protocol,
            target_id: targetId 
        });

    } catch (e) {
        console.error("Erro ao criar sala:", e);
        return res.status(500).json({ error: "Erro no banco de dados" });
    }
});

// --- ROTA GET (Garantir que NUNCA envia undefined) ---
app.get("/api/rooms", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const rows = await dbAll(
            `SELECT * FROM rooms WHERE owner_id = ? OR target_id = ?`, 
            [userId, userId]
        );
        
        // Se rows for null ou undefined, enviamos um array vazio []
        // O erro "reading id" acontece quando rows tem algo como [null] ou [undefined]
        const rooms = (rows || []).filter(r => r && r.id);
        
        res.json({ rooms: rooms });
    } catch (e) {
        console.error("Erro na listagem:", e);
        res.status(500).json({ rooms: [] });
    }
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.session.user }));

app.get("/api/rooms", requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const rooms = await dbAll(
            `SELECT * FROM rooms WHERE owner_id = ? OR target_id = ?`, 
            [userId, userId]
        );
        
        // Limpeza: remove entradas inválidas que possam causar erro no frontend
        const safeRooms = (rooms || []).filter(r => r && r.id);
        
        res.json({ rooms: safeRooms });
    } catch (e) {
        res.status(500).json({ error: "Erro ao listar salas" });
    }
});

app.get("/api/log", requireAuth, (req, res) => {
    const { roomId } = req.query;
    const logPath = path.join(__dirname, 'data', `${roomId}.log`);

    // Em vez de ler da memória, lemos o ficheiro real que o cat mostrou
    if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(l => l.trim() !== "");
        return res.json({ lines });
    }

    // Se o ficheiro ainda não existir, tenta ir à memória ou envia vazio
    const room = activeRooms.get(roomId);
    res.json({ lines: room ? room.lines : [] });
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

// --- 1. ROTAS ---

app.post('/api/message', async (req, res) => {
    const { roomId, text } = req.body;
    const room = activeRooms.get(roomId);
    
    if (!room) return res.status(404).json({ error: "Sala não encontrada" });

    const logPath = path.join(__dirname, 'data', `${roomId}.log`);

    try {
        // 1. Define o prefixo correto: P2P usa email, IA usa "EU:"
        const prefix = (room.protocol === 'p2p') ? `${req.session.user.email}: ` : "EU: ";
        fs.appendFileSync(logPath, `${prefix}${text}\n`);
        
        // 2. Se for P2P, termina aqui (o outro user lê via refreshLog)
        if (room.protocol === 'p2p') {
            return res.json({ success: true });
        }

        // 3. SE FOR IA (protocolo 'bwrap' ou outro), envia para o socket
        const socketPath = '/tmp/ia_socket.sock'; 
        
        const client = net.createConnection({ path: socketPath }, () => {
            client.write(text);
        });

        client.setTimeout(30000);

        client.once('data', (data) => {
            const aiReply = data.toString().trim();
            // Grava a resposta da IA no log para o frontend ver
            fs.appendFileSync(logPath, `IA: ${aiReply}\n`);
            if (!res.headersSent) res.json({ reply: aiReply });
            client.end();
        });

        client.on('error', (err) => {
            console.error("Erro no socket da IA:", err.message);
            if (!res.headersSent) res.status(500).json({ error: "A IA não está a ouvir (Socket Error)" });
        });

    } catch (e) {
        console.error("Erro na rota de mensagem:", e);
        if (!res.headersSent) res.status(500).json({ error: "Erro interno ao processar mensagem" });
    }
});

app.delete("/api/rooms/:id", requireAuth, async (req, res) => {
    const id = req.params.id;
    activeRooms.delete(id);
    await dbRun(`DELETE FROM rooms WHERE id = ?`, [id]);
    res.json({ ok: true });
});

// --- 2. FUNÇÕES AUXILIARES ---

function syncAIBrain() {
    try {
        const stdout = execSync("lxc list --format csv -c n,s").toString();
        // Escreve no ficheiro que será mapeado para o chatConnect
        fs.writeFileSync(AI_STATUS_FILE, stdout); 
        console.log("🧠 IA Sincronizada com LXC");
    } catch (e) {
        console.error("Erro ao sincronizar IA:", e.message);
    }
}

function launchChatInstance(roomId) {
    const socketPath = path.join(DATA_DIR, `${roomId}.sock`);
    const roomDir = path.join(ROOMS_DIR, roomId);
    const scriptPath = path.join(ROOT, "chatConnect.js");
    
    if (!fs.existsSync(roomDir)) fs.mkdirSync(roomDir, { recursive: true });
    
    // Remove socket antigo se existir
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);

    const nodePath = "/usr/bin/node"; // Caminho direto para evitar o which node

    spawn("bwrap", [
        "--dev-bind", "/", "/",
        "--share-net",
        "--tmpfs", "/tmp",
        "--bind", roomDir, "/tmp",
        "--bind", DATA_DIR, DATA_DIR,
        "--ro-bind", AI_STATUS_FILE, "/lxc_status.txt", 
        "--chdir", "/tmp",
        nodePath, scriptPath, socketPath
    ], { stdio: 'inherit' });
}

// --- 3. BOOT (INICIALIZAÇÃO) ---

async function boot() {
    await initDb();
    
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(ROOMS_DIR, { recursive: true });

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
            owner_id: r.owner_id,
            lines: history,
            proc: null
        });

        launchChatInstance(r.id);
    }

    // Intervalos e Servidor
    setInterval(syncAIBrain, 30000);
    syncAIBrain();

        app.listen(APP_PORT, "0.0.0.0", () => {
        console.log(`Servidor ativo em http://0.0.0.0:${APP_PORT}`);
    });
}

boot();
