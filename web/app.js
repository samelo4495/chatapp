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

  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Erro na liga    o");
  return j;
}

// --- RENDERIZA ^g ^cO ---
function renderRooms() {
  const containerIA = document.getElementById("roomsList");
  const containerUsers = document.getElementById("usersList");
  
  if (!containerIA || !containerUsers) return;
  
  // Limpa ambos os lados antes de desenhar
  containerIA.innerHTML = "";
  containerUsers.innerHTML = "";

  ROOMS.forEach(room => {
    const isActive = activeRoomId === room.id;
    const tile = document.createElement("div");
    tile.className = `room-tile ${isActive ? 'active' : ''}`;
    
    tile.innerHTML = `
      <button class="btn-delete-room" onclick="handleDeleteRoom(event, '${room.id}')">&times;</button>
      <div class="icon ${isActive ? 'active' : ''}" onclick="selectRoom('${room.id}')">
        ${room.name[0].toUpperCase()}
      </div>
      <div class="label">${room.name}</div>
    `;

    // LÓGICA DE SEPARAÇÃO:
    // Se o protocolo for 'p2p' ou 'direct', vai para o lado dos Utilizadores
    if (room.protocol === "p2p" || room.protocol === "direct") {
      containerUsers.appendChild(tile);
    } else {
      // Caso contrário (como os teus chats de LXC/IA), vai para o lado do Sistema
      containerIA.appendChild(tile);
    }
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
    lastCount = 0; // Força o refresh do log para a nova sala
    
    // --- ADICIONA ESTAS LINHAS AQUI ---
    const log = elLog();
    if (log) log.innerHTML = ""; 
    // ---------------------------------
  }
  
  activeRoomId = id;
  const room = ROOMS.find(r => r.id === id);
  
  if (elRoomName()) {
    elRoomName().textContent = room ? room.name : "Chat";
  }
  
  renderRooms();
  refreshLog();
}
 
// --- FUN ^g ^cO CORRIGIDA PARA N ^cO PISCAR ---
async function refreshLog() {
  if (!activeRoomId) return;
  try {
    const j = await api(`/api/log?roomId=${activeRoomId}`);
    const log = elLog();
    
    if (j.lines && j.lines.length !== lastCount) {
      log.innerHTML = ""; 
      
    j.lines.forEach((line) => {
        const cleanLine = line.trim();
        if (!cleanLine || cleanLine.startsWith("SISTEMA:")) return;
    
        // Procura a posição do primeiro ":"
        const separatorIdx = cleanLine.indexOf(":");
        if (separatorIdx === -1) return; // Linha inválida, ignora
    
        const senderPart = cleanLine.substring(0, separatorIdx).trim();
        const messagePart = cleanLine.substring(separatorIdx + 1).trim();
    
        // 1. Identificação: É minha se o prefixo for o meu email OU "EU"
        const isMe = (senderPart === ME.email) || (senderPart === "EU");
        
        // 2. Criação da Bolha
        const div = document.createElement("div");
        
        // Se isMe -> Direita ('me')
        // Se NÃO isMe -> Esquerda ('ai') -> Isto inclui IA e outros utilizadores
        div.className = `msg ${isMe ? 'me' : 'ai'}`;
        
        div.innerText = messagePart;
        log.appendChild(div);
    });
    
      lastCount = j.lines.length;
      log.scrollTop = log.scrollHeight;
    }
  } catch (err) { console.error("Erro ao carregar log:", err); }
}

// --- INICIALIZA ^g ^cO (Boot Seguro) ---
async function boot() {
  setTheme(themeIdx);

  try {
    const data = await api("/api/me"); // Vai buscar os dados do utilizador
    ME = data.user; 

    if (ME && ME.email) {
      // 1. Coloca a primeira letra do email no círculo
      const userCircle = document.getElementById("userCircle");
      if (userCircle) userCircle.textContent = ME.email[0].toUpperCase();
    }

    const res = await api("/api/rooms");
    ROOMS = res.rooms;
    renderRooms();
   
    if (ROOMS.length > 0 && !activeRoomId) {
      selectRoom(ROOMS[0].id);
    }
  } catch (err) {
    console.error("Erro ao iniciar:", err);
  }

  // --- LÓGICA DO MENU CIRCULAR ---
const userCircle = document.getElementById("userCircle");
const userDropdown = document.getElementById("userDropdown");

userCircle?.addEventListener("click", (e) => {
    e.stopPropagation();
    userDropdown.classList.toggle("hidden");
});

// Se clicar no chat ou no menu, o dropdown fecha
document.addEventListener("click", () => {
    userDropdown?.classList.add("hidden");
});

  // --- ATIVAÇÃO DOS BOTÕES DENTRO E FORA DO MENU ---
  document.getElementById("btnNewRoom")?.addEventListener("click", () => document.getElementById("dlgNewRoom")?.showModal());
  document.getElementById("btnTheme")?.addEventListener("click", () => setTheme(themeIdx + 1));
  
  // O ID btnSettings agora está dentro do dropdown
  document.getElementById("btnSettings")?.addEventListener("click", () => {
    document.getElementById("dlgSettings")?.showModal();
  });
 
  // BOTÃO SAIR (Dentro do dropdown)
  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    try {
        await fetch("/api/logout", { method: "POST" }); // Mata a sessão no servidor
        localStorage.clear(); 
        window.location.replace("/web/login.html"); // Redireciona sem deixar voltar atrás
    } catch (e) {
        window.location.replace("/web/login.html");
    }
  });

  // --- RESTANTE LÓGICA (CRIAR SALAS E MENSAGENS) ---
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
      
      // CORREÇÃO: O objeto sala é o próprio 'j', não 'j.room'
      ROOMS.push(j); 
      document.getElementById("dlgNewRoom")?.close();
      renderRooms();
      selectRoom(j.id); 
    } catch (e) { alert(e.message); }
});

  document.getElementById("send")?.addEventListener("click", sendMsg);
  document.getElementById("msg")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); sendMsg(); }
  });

  setInterval(() => { if (activeRoomId) refreshLog(); }, 100);
}

function renderMessage(sender, text) {
    const log = elLog(); // Usa a função utilitária que já tens para o chatLog
    if (!log) return;

    const isMe = (sender === "user");
    
    // Cria o elemento da mensagem com a mesma estrutura que o refreshLog usa
    const msgDiv = document.createElement("div");
    msgDiv.className = `msg ${isMe ? 'me' : ''}`;
    msgDiv.innerText = text;

    log.appendChild(msgDiv);
    
    // Faz scroll para o fundo para vermos a nova mensagem
    log.scrollTop = log.scrollHeight;
}

function renderSingleMessage(text, isMe) {
    const log = elLog();
    if (!log) return;

    const div = document.createElement("div");
    div.className = `msg ${isMe ? 'me' : 'ai'}`;
    div.innerText = text;
    
    log.appendChild(div);
    log.scrollTop = log.scrollHeight; // Faz scroll automático
}

async function sendMsg() {
    const input = document.getElementById("msg");
    const text = input.value.trim();

    if (!text || !activeRoomId) return;

    // 1. Limpa o input imediatamente
    input.value = ""; 

    // 2. DESENHA LOGO NO ECRÃ (Instantâneo!)
    renderSingleMessage(text, true);

    try {
        const response = await api('/api/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId: activeRoomId, text: text })
        });

        // 3. Se a IA responder no JSON, desenhamos a resposta dela logo a seguir
        if (response.reply) {
            renderSingleMessage(response.reply, false);
        }

        // Atualizamos o lastCount para o próximo refreshLog não duplicar nada
        lastCount = 0;
        await refreshLog(); // Recarrega o log para garantir que tudo está sincronizado 
        
    } catch (error) {
        console.error("Erro ao enviar:", error);
        // Opcional: Avisar o utilizador que a mensagem falhou
        renderSingleMessage("ERRO: Mensagem não enviada.", false);
    }
}

let selectedUserId = null;

// Lógica de Pesquisa Dinâmica
document.getElementById("usSearch")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim();
    const resDiv = document.getElementById("usResults");
    
    // we only need to bail out when the query is empty – one character is fine now
    if (q.length < 1) {
        resDiv.classList.add("hidden");
        return;
    }

    const data = await api(`/api/users/search?q=${q}`);
    resDiv.innerHTML = "";
    
    // show results even if there is only a single match
    if (data.users.length > 0) {
        resDiv.classList.remove("hidden");
        data.users.forEach(u => {
            const item = document.createElement("div");
            item.className = "search-item";
            item.textContent = u.email;
            item.onclick = () => {
            inputSearch.value = u.email;
            inputSearch.dataset.selectedId = u.id; // ESTA LINHA É VITAL
            resResults.style.display = "none";
            };
            resDiv.appendChild(item);
        });
    }
});

// --- ROTA DE MENSAGEM COM CORREÇÃO DE LOOP ---
const usSearch = document.getElementById("usSearch");
const usResults = document.getElementById("usResults");

usSearch?.addEventListener("input", async () => {
    const q = usSearch.value.trim();
    
    // allow single‑character lookups; hide only when empty
    if (q.length < 1) {
        usResults.classList.add("hidden");
        return;
    }

    try {
        const data = await api(`/api/users/search?q=${q}`); // Chama a rota que criámos acima
        usResults.innerHTML = "";

        if (data.users && data.users.length > 0) {
            usResults.classList.remove("hidden");
            data.users.forEach(u => {
                const item = document.createElement("div");
                item.className = "search-item";
                item.textContent = u.email;
                item.onclick = () => {
                    usSearch.value = u.email;
                    usSearch.dataset.selectedId = u.id; // Guarda o ID para o envio
                    usResults.classList.add("hidden");
                };
                usResults.appendChild(item);
            });
        } else {
            usResults.classList.add("hidden");
        }
    } catch (err) {
        console.error("Erro ao procurar:", err);
    }
});

// Gestão da pesquisa de utilizadores
document.addEventListener('input', async (e) => {
    if (e.target.id === "usSearch") {
        const q = e.target.value.trim();
        const resDiv = document.getElementById("usResults");
        
        // show results even for a one‑letter query; only suppress when there is no input
        if (q.length < 1) {
            resDiv.style.display = "none";
            return;
        }

        try {
            const data = await api(`/api/users/search?q=${q}`);
            resDiv.innerHTML = "";
            
            if (data.users && data.users.length > 0) {
                resDiv.style.display = "block";
                data.users.forEach(u => {
                    const item = document.createElement("div");
                    item.className = "search-item";
                    item.textContent = u.email;
                    item.onclick = () => {
                        document.getElementById("usSearch").value = u.email;
                        // Guardamos o ID num atributo do input para usar ao enviar
                        selectedUserId = u.id;
                        document.getElementById("usSearch").dataset.selectedId = u.id;
                        resDiv.style.display = "none";
                    };
                    resDiv.appendChild(item);
                });
            } else {
                resDiv.style.display = "none";
            }
        } catch (err) {
            console.error("Erro na pesquisa:", err);
        }
    }
});

// Botão "Enviar e Abrir Chat" (Lado Direito)
document.getElementById("usSend")?.addEventListener("click", async () => {
    const inputSearch = document.getElementById("usSearch");
    const inputMsg = document.getElementById("usMsg");
    
    const email = inputSearch.value.trim();
    const msg = inputMsg.value.trim();
    
    // Vamos buscar o ID que guardámos no elemento quando clicaste na lista
    const userId = inputSearch.dataset.selectedId;

    // Validação mais rigorosa
    if (!userId || !msg) {
        return alert("Erro: Precisas de selecionar um utilizador da lista e escrever uma mensagem!");
    }

    try {
        const roomName = email.split('@')[0];
        const j = await api("/api/rooms", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ 
                name: roomName, 
                protocol: "p2p", 
                targetId: userId
            })
        });

        // CORREÇÃO: Verificamos 'j.id' em vez de 'j.room'
        if (!j || !j.id) throw new Error("Erro ao criar a sala no servidor.");

        await api("/api/message", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ roomId: j.id, text: msg })
        });

        if (!ROOMS.find(r => r.id === j.id)) {
            ROOMS.push(j);
        }
        
        renderRooms();
        selectRoom(j.id);
        
        // Fechar a modal e limpar tudo
        document.getElementById("dlgNewRoom").close();
        inputSearch.value = "";
        inputMsg.value = "";
        delete inputSearch.dataset.selectedId; // Limpa o ID guardado
        
    } catch (e) { 
        console.error(e);
        alert("Erro ao enviar: " + e.message); 
    }
});

boot();
