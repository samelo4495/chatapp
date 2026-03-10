# ChatApp
This is a Full-Stack Multi-Instance Chat Management Web Application, which uses an architecture of isolated microservices via Unix processes. It is a hybrid system between a messaging server and a remote/local instance control panel.

ChatApp is a robust chat server built in Node.js, focused on process isolation and interface flexibility. Unlike traditional chats, each conversation room operates as an independent instance, isolated in a secure Bubblewrap (bwrap) environment.

🚀 Main Features Multi-Instance Architecture: Each chat room is managed by a child process (chatConnect.js), communicating with the main server via Unix Sockets.

Security and Isolation: Running advanced scripts (Bash, Python, Node) within a sandboxed environment using Bubblewrap.

Adaptive Interface (UI/UX):

Smart floating menu with dynamic expansion and transparency.

Fully responsive design (Desktop, Tablet and Mobile).

Dynamic theme system: Daytime, Nighttime and the exclusive Floribela theme (colorful and vibrant).

User and Session Management: SQLite-based authentication with session persistence via cookies.

Distributed Log System: Each chat instance generates its own message history within its isolated file system.

🛠️ Technology Stack Backend: Node.js, Express.

Database: SQLite (User management).

IPC Communication: Unix Domain Sockets.

Security: Bubblewrap (Linux sandboxing).

Frontend: HTML5, CSS3 (Modern Flexbox/Grid), Vanilla JavaScript.
