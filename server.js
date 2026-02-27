const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");

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
    await dbRun(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, pass_hash TEXT, is_admin INTEGER DEFAULT 0, created_at TEXT)`);
    await dbRun(`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, protocol TEXT, config_json TEXT, created_at TEXT)`);
   
    const admin = await dbGet(`SELECT * FROM users WHERE email = ?`, ["admin@local"]);
    if (!admin) {
        const hash = await bcrypt.hash("admin", 10);
        await dbRun(`INSERT INTO users (email, pass_hash, is_admin, created_at) VALUES (?,?,?,?)`, ["admin@local", hash, 1, new Date().toISOString()]);
    }
}

// ---------- Gestão de Salas em Memória ----------
const activeRooms = new Map();

// ---------- Auth Middleware ----------
const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).send("Não autorizado");

// ---------- Rotas ----------
app.get("/", (req, res) => res.redirect(req.session?.user ? "/web/chat.html" : "/web/login.html"));

app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
    if (user && await bcrypt.compare(password, user.pass_hash)) {
        req.session.user = { id: user.id, email: user.email, is_admin: !!user.is_admin };
        return res.json({ ok: true });
    }
    res.status(401).json({ error: "Falha no login" });
});

app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.session.user }));

app.get("/api/rooms", requireAuth, async (req, res) => {
    const rooms = await dbAll(`SELECT * FROM rooms`);
    res.json({ rooms });
});

app.post("/api/rooms", requireAuth, async (req, res) => {
    try {
        const { name, protocol } = req.body;
        const id = crypto.randomBytes(4).toString("hex");

        await dbRun(`INSERT INTO rooms (id, name, protocol, config_json, created_at) VALUES (?,?,?,?,?)`,
                    [id, name, protocol, "{}", new Date().toISOString()]);

        const roomData = {
            id: id,
            name: name,
            lines: ["SISTEMA: Nova sala criada. Ligação ao container 10.10.2.124 pronta."],
            proc: null
        };

        activeRooms.set(id, roomData);
        res.json({ ok: true, room: { id, name, protocol } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get("/api/log", requireAuth, (req, res) => {
    const room = activeRooms.get(req.query.roomId);
    res.json({ lines: room ? room.lines : ["Sala inativa ou a carregar..."] });
});

// --- ROTA DE MENSAGEM COM CORREÇÃO DE LOOP ---
app.post("/api/message", requireAuth, async (req, res) => {
    const { roomId, text } = req.body;
    const room = activeRooms.get(roomId);

    if (!room) return res.status(404).json({ error: "Sala não encontrada" });

    room.lines.push(`${text}`);

    // --- NOVO: CONSULTA AO ESTADO DOS CONTAINERS NO HOST ---
    let contextoLXC = "";
    try {
        // Assume-se que o script 'Observador' está a correr no IP do Host (bridge lxcbr0)
        const hostResponse = await fetch("http://10.10.2.142:5000/stats", { timeout: 2000 });
        const containers = await hostResponse.json();
        
        // Transformamos o JSON em texto que a IA entenda
        contextoLXC = "Estado Atual dos Containers LXC:\n";
        containers.forEach(c => {
            contextoLXC += `- ${c.name}: [Estado: ${c.state}, IP: ${c.ipv4 || 'N/A'}, RAM: ${c.memory_usage || '0'}]\n`;
        });
    } catch (e) {
        contextoLXC = "Aviso: Não foi possível obter o estado dos outros containers no momento.";
        console.error("Erro ao contactar Observador no Host:", e.message);
    }

    try {
        const aiResponse = await fetch("http://127.0.0.1:8080/completion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                // INJETAMOS O CONTEXTO AQUI:
                prompt: `Instruction: És um administrador de sistemas. Usa as informações abaixo para responder em Português.\n\n${contextoLXC}\n\nUser: ${text}\n\nAssistant:`,
                n_predict: 256,
                temperature: 0.5, // Baixamos a temperatura para ela ser mais factual e menos criativa
                stop: ["<|user|>", "<|assistant|>", "User:", "Assistant:", "Instruction:", "\n\nUser:"]
            })
        });

        const data = await aiResponse.json();
        let respostaIA = data.content || "A IA não enviou texto.";
        
        respostaIA = respostaIA.replace("<|assistant|>", "").trim();
        room.lines.push(`${respostaIA}`);
        res.json({ ok: true });

    } catch (e) {
        console.error("Erro na ligação local à IA:", e.message);
        room.lines.push("SISTEMA: O motor de IA local está a iniciar ou offline.");
        res.status(500).json({ error: "IA Offline" });
    }
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
        activeRooms.set(r.id, {
            id: r.id,
            name: r.name,
            lines: ["SISTEMA: Sala recuperada da base de dados."],
            proc: null
        });
    }
   
    app.listen(APP_PORT, "0.0.0.0", () => {
        console.log(`🚀 Servidor em http://localhost:${APP_PORT}`);
        console.log(`>> ${activeRooms.size} salas carregadas.`);
    });
}

boot();
