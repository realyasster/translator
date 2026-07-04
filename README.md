<p align="center">
  <img src="https://github.com/ChenYCL/chrome-extension-udemy-translate/raw/v2.0.0/example/ball-logo.png" alt="Universal Subtitle Translator" height="128" width="128" />
</p>

<h1 align="center">
  Universal Subtitle Translator
</h1>

<p align="center">
  <strong>Real-time subtitle translation for any website · OpenAI · Ollama · Google Translate</strong>
</p>

<p align="center">
  <a href="https://github.com/realyasster/translator/releases/latest">
    <img src="https://img.shields.io/github/v/release/realyasster/translator?label=version" alt="Release">
  </a>
  <img src="https://img.shields.io/github/downloads/realyasster/translator/total" alt="Downloads">
  <a href="https://github.com/realyasster/translator/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/realyasster/translator" alt="License">
  </a>
  <a href="https://github.com/ChenYCL/chrome-extension-udemy-translate">
    <img src="https://img.shields.io/badge/forked%20from-ChenYCL%2Fchrome--extension--udemy--translate-blue" alt="Forked from ChenYCL">
  </a>
</p>

---

## 🎬 Demo Videos

> Demos from the original project (hosted in this repo under [`docs/demo/`](docs/demo/)). See [Credits](#-credits) for source attribution.

<table>
  <tr>
    <td width="50%"><b>Demo 1 — Subtitle translation in action</b></td>
    <td width="50%"><b>Demo 2 — Real-time translation demo</b></td>
  </tr>
  <tr>
    <td>
      <video src="https://raw.githubusercontent.com/realyasster/translator/main/docs/demo/demo1.mp4" controls width="100%" preload="metadata"></video>
    </td>
    <td>
      <video src="https://raw.githubusercontent.com/realyasster/translator/main/docs/demo/demo2.mov" controls width="100%" preload="metadata"></video>
    </td>
  </tr>
</table>

<p align="center">
  <img src="https://raw.githubusercontent.com/realyasster/translator/main/docs/demo/demo3.png" alt="Demo screenshot" width="60%" />
</p>

<p align="center">
  <a href="https://github.com/realyasster/translator/tree/main/docs/demo">
    📁 View source files in <code>docs/demo/</code>
  </a>
</p>

---

## 🌟 About

A Chrome extension that translates subtitles from **any website** in real time using your choice of AI backend. Works on Netflix, YouTube, Udemy (including Shaka Player), Disney+, HBO Max, and any site where you can identify a subtitle DOM selector.

### Why this fork?

This is a maintained fork of the [ChenYCL/chrome-extension-udemy-translate](https://github.com/ChenYCL/chrome-extension-udemy-translate) project with:

- 🐛 **Critical bug fixes** (debounce → throttle, double init, hostname match, error spam)
- 🌐 **Direct Ollama connection** — no separate HTTPS proxy needed (MV3 localhost exception)
- 🪟 **Platform-specific setup** (PowerShell, CMD, Service mode)
- 🌍 **Google Translate** as a free fallback provider
- 🔍 **Auto-detect subtitles** (scans iframes + shadow DOM)
- 🌐 **i18n** — English + Turkish
- 🩺 **Connection Diagnostics** card with live test
- 🎨 **Multi-selector** fallback system for tricky players (Udemy Shaka)
- 🛡️ **Friendly error messages** (CORS, model not found, etc.)
- ♻️ **Reset config** button + status badge

---

## ✨ Features

- 🤖 **3 translation providers**: OpenAI-compatible APIs, local Ollama, Google Translate (free)
- 🎯 **Custom selectors** with multi-selector fallback (try several patterns in order)
- 🔍 **Auto-detect subtitles**: scans the page (including iframes + shadow DOM) and suggests the right selector
- 🪟 **Platform-specific** Ollama setup instructions (macOS / Linux / PowerShell / CMD / Service)
- 🩺 **Connection Diagnostics** — live test with status badge in popup
- 🌍 **i18n** — English + Turkish
- 🎨 **Customizable subtitle UI** (color, size, weight, position, drag)
- 🛡️ **Friendly errors** — CORS / model not found / network / timeout
- ⚡ **Real-time** translation with anti-spam throttling
- 🧪 **Site presets** — Netflix, YouTube, Udemy, Amazon, Disney+, HBO Max, etc.

---

## 📦 Installation

### From Release (easiest)

1. Download the latest `Udemy_Translate-v*.zip` from [Releases](https://github.com/realyasster/translator/releases)
2. Unzip the file
3. Open `chrome://extensions/` in Chrome
4. Enable **Developer mode** (top right)
5. Click **Load unpacked** → select the unzipped folder

### From Source

```bash
git clone https://github.com/realyasster/translator.git
cd translator
npm install
npm run build
# Then load unpacked: select the `build/` folder
```

---

## 🚀 Quick Start

1. **Configure translation backend**: Right-click extension icon → Options
   - **Google Translate** (free, no API key) — fastest setup
   - **OpenAI / GLM / DeepSeek** — best quality
   - **Ollama (local)** — privacy-focused, no API costs

2. **Add a website**:
   - Pick a preset (Netflix, YouTube, Udemy, etc.) or enter custom domain + selector
   - Or click **🔮 Auto-detect subtitles** to let the extension find the right selector

3. **Open the site**, turn on subtitles, and translation appears in real time

For step-by-step instructions, see [`docs/QUICKSTART.md`](docs/QUICKSTART.md) *(TODO)*.

---

## 🏠 Ollama Setup (No Proxy Needed!)

MV3 service workers can connect directly to `http://localhost:11434` thanks to Chrome's localhost exception for extensions.

### Quick Setup (pick your platform)

#### macOS / Linux (bash, zsh)

```bash
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
```

#### Windows PowerShell

> ⚠️ PowerShell does **NOT** accept bash inline env-var syntax (`OLLAMA_ORIGINS=...`).
> It throws `CommandNotFoundException` and Ollama silently starts without CORS.

```powershell
$env:OLLAMA_ORIGINS = "chrome-extension://*"
ollama serve
```

#### Windows CMD

```cmd
set OLLAMA_ORIGINS=chrome-extension://*
ollama serve
```

#### Windows: Ollama runs as a Service

```powershell
Stop-Service ollama
[System.Environment]::SetEnvironmentVariable(
  "OLLAMA_ORIGINS", "chrome-extension://*",
  [System.EnvironmentVariableTarget]::Machine
)
Start-Service ollama
```

#### Verify

```bash
curl http://localhost:11434/api/version
# Should return: {"version":"0.x.x"}
```

### Popular Models (Ollama Setup → Recommended)

| Tier | Model | Size | Best for |
|---|---|---|---|
| 🥇 Balanced | `qwen2.5:3b` | ~2 GB | Best mid-size for translation |
| ⚡ Lightest | `qwen2:0.5b` | ~500 MB | Older machines |
| 🦙 Meta | `llama3.2:3b` / `llama3.1:8b` | ~2-5 GB | General purpose |
| 💎 Google | `gemma2:2b` / `gemma3:4b` | ~1.6-3 GB | Multilingual |
| 🌬️ Mistral | `mistral:7b` / `mistral-nemo:12b` | ~4-7 GB | European languages |
| 🧠 Microsoft | `phi3:mini` / `phi3.5` | ~2 GB | Compact |
| 🔬 Best quality | `qwen2.5:14b` | ~9 GB | High-end systems |

---

## 🎯 Supported Platforms (Presets)

| Platform | Selector |
|---|---|
| Netflix | `.player-timedtext-text-container` |
| YouTube | `.ytp-caption-segment` |
| Udemy (Shaka) | `.shaka-text-container span` (+ fallbacks) |
| Amazon Prime | `.atvwebplayersdk-captions-text` |
| Disney+ | `.dss-subtitle-renderer-cue` |
| Shaka Player (custom) | `.shaka-text-container span` (+ fallbacks) |
| LinkedIn Learning | `[class*="transcript"]` |
| **Any website** | Custom selector + auto-detect |

---

## 🐛 Troubleshooting

- **HTTP 403 / "CORS blocked"**: Restart Ollama with `OLLAMA_ORIGINS="chrome-extension://*"`. See platform-specific commands above.
- **`CommandNotFoundException` (Windows PowerShell)**: You used bash syntax. Use `$env:OLLAMA_ORIGINS = "..."` instead.
- **Service didn't pick up the env var (Windows)**: Use the "Windows: Ollama runs as a Service" block above to set the env var at Machine level.
- **HTTP 404 / "Model not found"**: Run `ollama pull <model>` first.
- **HTTP 401**: Invalid API key. Check provider credentials.
- **"Unreachable"**: Server is not running. Run `ollama serve`.
- **Verify CORS works**: `curl http://localhost:11434/api/version` should return JSON.
- **Still stuck?**: Open Options → **Connection Diagnostics** → **Test Now** for live diagnosis.

---

## 🤝 Contributing

Pull requests welcome! For major changes, please open an issue first to discuss what you'd like to change.

```bash
# Dev workflow
npm install
npm start              # webpack dev server
npm run build          # production build
npm test               # unit tests
```

---

## 📜 Credits

This project is a fork of **[ChenYCL/chrome-extension-udemy-translate](https://github.com/ChenYCL/chrome-extension-udemy-translate)**.

### Original Author
- **[ChenYCL](https://github.com/ChenYCL)** — original design, UI/UX, and core implementation
  - [GitHub](https://github.com/ChenYCL)
  - [WeChat Official Account](https://raw.githubusercontent.com/ChenYCL/chrome-extension-udemy-translate/master/example/qrcode.BMP)
  - [Telegram Group](https://t.me/joinchat/Gs1RFzD5MpIwJ7S-)

### Demo Videos
- Demo videos in the [🎬 Demo Videos](#-demo-videos) section are from the original project

### This Fork (realyasster/translator)
Major rewrite and extensions:
- 🐛 8 critical bug fixes (B1-B8)
- 🌐 Direct Ollama connection (no proxy)
- 🪟 Platform-specific setup instructions
- 🌍 Google Translate provider
- 🔍 Auto-detect subtitles (iframes + shadow DOM)
- 🩺 Connection Diagnostics card
- 🌐 i18n (English + Turkish)
- 🎨 Multi-selector fallback system
- 🛡️ Friendly error messages
- ♻️ Reset config + status badge

### Upstream Acknowledgement

Special thanks to ChenYCL for the original implementation and design. The demo videos above are sourced from the original repository.

### Original Project Links
- **Original repo**: https://github.com/ChenYCL/chrome-extension-udemy-translate
- **Original docs**: see [original README](https://github.com/ChenYCL/chrome-extension-udemy-translate/blob/main/README.md)
- **Original WeChat OA**: scan the QR code above for tutorials
- **Original Telegram**: https://t.me/joinchat/Gs1RFzD5MpIwJ7S-

### Donations / Support
The original author accepts donations. The donation channels (Alipay, WeChat QR) in the original README still work — please support ChenYCL if you find this extension useful. The forked version is provided free of charge.

---

## 📄 License

[MIT](./LICENSE) — same as the original project.

---

<p align="center">
  <sub>Built with ❤️ on top of <a href="https://github.com/ChenYCL/chrome-extension-udemy-translate">ChenYCL's original work</a></sub>
</p>
