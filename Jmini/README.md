# Jmini

Jmini is a local-first Tauri desktop assistant. The interface is TypeScript, the desktop and data layer is Rust, and llama.cpp runs the local GGUF model.

## Run locally

Start both local model servers with one command from this directory:

```powershell
npm run models
```

The launcher expects these files:

```text
models/gemma-3-4b-it-Q4_K_M.gguf
models/mmproj-model-f16.gguf
```

It starts the text server on port `8080` and the vision-enabled server on port `8082`. Logs are written to `.logs`. Stop both servers with `Ctrl+C` in the launcher terminal.

Then start Jmini in another terminal:

```powershell
npm run tauri dev
```

## Local knowledge system

Conversations and memories are stored in a SQLite database in Tauri's application-data directory. They never need to leave the computer. The **View memory** control lets you add and remove durable facts.

Jmini sends relevant memories to the local chat model before each response. If an embedding server is not running, retrieval falls back to local keyword matching. For semantic retrieval, run a second llama.cpp server with an embedding-capable GGUF model on port `8081` using its `--embedding` option. The memory service calls `http://127.0.0.1:8081/embedding`.

## Image understanding

Click the `+` button in the composer to attach an image. Jmini automatically sends text-only messages to port `8080` and messages with an image to port `8082`. The vision server uses the same Gemma text model plus the `mmproj-model-f16.gguf` multimodal projector. The image is converted to a local data URL in memory and sent to `127.0.0.1`; it is not uploaded to an external service.

## Build checks

```powershell
npm run build
cd src-tauri
cargo check
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
