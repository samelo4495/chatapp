let ME = null;
let ROOMS = [];
let activeRoomId = null;
// --- ADICIONADO: Vari  vel para controlar o estado e evitar o piscar ---
let lastCount = 0;

// --- SISTEMA DE TEMAS (Cinzento e Fonte Inter) ---
const THEMES = ["theme-day", "theme-night", "theme-floribela"];
let themeIdx = parseInt(localStorage.getItem("selected-theme")) || 1;

function setTheme(i) {
  themeIdx = (i + THEMES.length) % THEMES.length;
  document.body.classList.remove(...THEMES);
  document.body.classList.add(THEMES[themeIdx]);
  localStorage.setItem("selected-theme", themeIdx);
}

// --- UTILIT ^aRIOS ---
const elLog = () => document.getElementById("chatLog");
const elRoomName = () => document.getElementById("roomName");

async function api(url, opts) {
  const r = await fetch(url, opts);
 
  if (r.status === 401) {
    if (!window.location.pathname.includes("login.html")) {
      window.location.replace("/web/login.html");
    }
    return;
  }

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Erro na liga    o");
  return j;
}

// --- RENDERIZA ^g ^cO ---
function renderRooms() {
  const container = document.querySelector(".icon-strip");
  if (!container) return;
  container.innerHTML = "";

  ROOMS.forEach(room => {
    const isActive = activeRoomId === room.id; // Verifica se esta    a sala atual
    const tile = document.createElement("div");
   
    // Adicionamos a classe 'active' ao tile (pai), mantendo a 'room-tile'
    tile.className = `room-tile ${isActive ? 'active' : ''}`;
   
    tile.innerHTML = `
      <button class="btn-delete-room" onclick="handleDeleteRoom(event, '${room.id}')">&times;</button>

      <div class="icon ${isActive ? 'active' : ''}" onclick="selectRoom('${room.id}')">
        ${room.name[0].toUpperCase()}
      </div>

      <div class="label">${room.name}</div>
                                                      `;
    container.appendChild(tile);
  });
}

async function handleDeleteRoom(event, roomId) {
  event.stopPropagation();
  if (!confirm("Tens a certeza que queres eliminar esta sala?")) return;
  try {
    await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
    ROOMS = ROOMS.filter(r => r.id !== roomId);
    if (activeRoomId === roomId) {
        activeRoomId = null;
        lastCount = 0; // Reset ao contador
    }
    renderRooms();
  } catch (err) { alert(err.message); }
}
 
async function selectRoom(id) {
 if (activeRoomId !== id) {
   lastCount = 0; // Reset para for  ar o desenho da nova sala
 }
 activeRoomId = id;
 const room = ROOMS.find(r => r.id === id);
 if (elRoomName()) elRoomName().textContent = room ? room.name : "";
 renderRooms();
 refreshLog();
}
 
// --- FUN ^g ^cO CORRIGIDA PARA N ^cO PISCAR ---
async function refreshLog() {
  if (!activeRoomId) return;
  try {
    const j = await api(`/api/log?roomId=${activeRoomId}`);
    const log = elLog();
    if (!log || !j.lines) return;

    if (j.lines.length !== lastCount) {
      log.innerHTML = j.lines
        .filter(line => {
          const cleanLine = line.trim();
          if (cleanLine.startsWith("SISTEMA:")) {
            console.log("%c" + cleanLine, "color: #10b981; font-weight: bold;");
            return false;
          }
          return true;
        })
        .map((line, index) => { // ADICIONADO 'index' AQUI para corrigir o erro
          const cleanLine = line.trim();

          // L ^sGICA DE EMERG ^jNCIA:
          // Se n  o h   prefixos, assume que as mensagens   mpares (0, 2, 4...) s  o tuas
          // Se os prefixos voltarem, a l  gica antiga startsWith("EU:") continua a funcionar
          const isMe = cleanLine.toUpperCase().startsWith("EU:") || (index % 2 === 0);

          const cleantext = cleanLine.replace(/^(EU:|IA:)\s*/i, "");
          return `<div class="msg ${isMe ? 'me' : ''}">${cleantext}</div>`;
        })
        .join("");

      lastCount = j.lines.length;
      log.scrollTop = log.scrollHeight;
    }
  } catch (err) { console.error("Erro log:", err); }
}
// --- INICIALIZA ^g ^cO (Boot Seguro) ---
async function boot() {
  setTheme(themeIdx);

  try {
    ME = await api("/api/me");
    if (!ME) return;

    const res = await api("/api/rooms");
    ROOMS = res.rooms;
    renderRooms();
   
    if (ROOMS.length > 0 && !activeRoomId) {
      selectRoom(ROOMS[0].id);
    }
  } catch (err) {
    console.error("Erro ao iniciar:", err);
  }

  // --- ATIVA ^g ^cO DOS BOT ^uES DO MENU ---
  document.getElementById("btnNewRoom")?.addEventListener("click", () => document.getElementById("dlgNewRoom")?.showModal());
  document.getElementById("btnTheme")?.addEventListener("click", () => setTheme(themeIdx + 1));
  document.getElementById("btnSettings")?.addEventListener("click", () => document.getElementById("dlgSettings")?.showModal());
 
  // BOT ^cO SAIR
  document.getElementById("btnLogout")?.addEventListener("click", () => {
    window.location.href = "/web/login.html";
  });

  // BOT ^cO CRIAR (DENTRO DA MODAL)
  document.getElementById("nrCreate")?.addEventListener("click", async () => {
    const name = document.getElementById("nrName")?.value.trim();
    const protocol = document.getElementById("nrProto")?.value.trim();
   
    if (!name || !protocol) return alert("Preenche os campos!");

    try {
      const j = await api("/api/rooms", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ name, protocol })
      });
      ROOMS.push(j.room);
      document.getElementById("dlgNewRoom")?.close();
      renderRooms();
      selectRoom(j.room.id);
    } catch (e) { alert(e.message); }
  });

  // Envio de mensagens
  document.getElementById("send")?.addEventListener("click", sendMsg);
  document.getElementById("msg")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        sendMsg();
    }
  });

  // Intervalo de 4 segundos est   bom para n  o sobrecarregar
  setInterval(() => { if (activeRoomId) refreshLog(); }, 4000);
}
 
async function sendMsg() {
  const input = document.getElementById("msg");
  const text = input.value.trim();
 
  if (!text || !activeRoomId) return;

  try {
    input.value = ""; // Limpa logo para dar sensa    o de velocidade
   
    await api("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: activeRoomId,
        text: text
      })
    });
   
    refreshLog(); // Tenta atualizar logo a seguir ao envio
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
  }
}

boot();
