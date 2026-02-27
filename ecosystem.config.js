module.exports = {
  apps: [
    {
      name: "chatapp-site",
      script: "server.js",
      cwd: "/home/chatapp",
      env: { PORT: 3000 }
    },
    {
      name: "llama-server",
      script: "/opt/llama.cpp/build/bin/llama-server",
      args: [
        "-m", "/home/chatapp/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
        "--port", "8080",
        "--host", "127.0.0.1",
        "-c", "8192", 
        "-t", "10",    
        "--n-gpu-layers", "0"
      ],
      interpreter: "none"
    }
  ]
}