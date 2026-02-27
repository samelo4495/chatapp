# ChatApp
Esta é uma Aplicação Web Full-Stack de Gestão de Chat Multi-Instância, que utiliza uma arquitetura de micro-serviços isolados via processos Unix. É um sistema híbrido entre um servidor de mensagens e um painel de controlo de instâncias remotas/locais.

O ChatApp é um servidor de chat robusto construído em Node.js, focado em isolamento de processos e flexibilidade de interface. Ao contrário de chats tradicionais, cada sala de conversação opera como uma instância independente, isolada num ambiente seguro Bubblewrap (bwrap).

🚀 Características Principais
Arquitetura Multi-Instância: Cada sala de chat é gerida por um processo filho (chatConnect.js), comunicando com o servidor principal via Unix Sockets.

Segurança e Isolamento: Execução de scripts avançados (Bash, Python, Node) dentro de um ambiente sandboxed usando Bubblewrap.

Interface Adaptativa (UI/UX):

Menu flutuante inteligente com expansão dinâmica e transparência.

Design totalmente responsivo (Desktop, Tablet e Mobile).

Sistema de temas dinâmicos: Diurno, Noturno e o exclusivo tema Floribela (colorido e vibrante).

Gestão de Utilizadores e Sessão: Autenticação baseada em SQLite com persistência de sessão via cookies.

Sistema de Log Distribuído: Cada instância de chat gere o seu próprio histórico de mensagens dentro do seu sistema de ficheiros isolado.

🛠️ Stack Tecnológica
Backend: Node.js, Express.

Base de Dados: SQLite (User management).

Comunicação IPC: Unix Domain Sockets.

Segurança: Bubblewrap (Linux sandboxing).

Frontend: HTML5, CSS3 (Modern Flexbox/Grid), Vanilla JavaScript.

Estrutura do Projeto (Snippet para o README)
Plaintext
├── server.js           # Servidor principal (Orquestrador)
├── chatConnect.js      # Lógica de cada sala (Instanciado por sala)
├── database.db         # DB SQLite de utilizadores
├── web/                # Ficheiros estáticos
│   ├── index.html      # Login e Chat UI
│   ├── css/            # Temas (Day, Night, Floribela)
│   └── js/             # Lógica de cliente
└── logs/               # Logs gerados pelas instâncias bwrap
