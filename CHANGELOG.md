# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- Chrome Web Store publication
- Additional language presets
- Firefox port

---

## [3.2.0] - 2026-07-04

### Added
- ⚡ **Streaming translation (SSE)** — word-by-word translation as the model generates
  - OpenAI-compatible: SSE parsing (`data: {delta.content}` chunks)
  - Ollama native: NDJSON parsing (`/api/chat` with `stream: true`)
  - Google Translate: word-by-word simulation (no native streaming)
  - Persistent `chrome.runtime.connect` port for background → content chunks
  - AbortController for cancellation on port disconnect
  - New `src/utils/stream-translator.ts` (provider-agnostic streaming core)
- 🎨 **Streaming UI**:
  - "● streaming" badge (pulsing animation) on floating subtitle
  - Original text shown in dimmed state (70% opacity) for context
  - Live-updating translated text (typewriter effect)
  - First chunk visible in 100-500ms (vs 1-3s blocking)
- ⚙️ **Options toggle**: "Enable streaming (SSE)" — default ON
  - Persistent (`enableStreaming` storage key)
  - Falls back to blocking on error
- 💫 **CSS animation**: `@keyframes ut-stream-pulse` injected once

### Changed
- `content/index.ts` `translateText()` split into:
  - `translateTextStreaming()` — port-based with chunks
  - `translateTextBlocking()` — legacy `sendMessage` (fallback)
  - `handleTranslationError()` — shared error handler with anti-spam
  - `postProcess()` — shared `@@@` / newline cleanup
  - `setStreamingText()` — partial-update UI
  - `createOrUpdateFloatingStreaming()` — streaming-specific floating subtitle
- `background/index.ts`:
  - New `chrome.runtime.onConnect` listener for port-based streaming
  - `handleStreamRequest()` with `AbortController`
  - `resolveProviderAndConfig()` helper (shared with blocking path)
- `request.ts` (blocking) kept untouched — fallback path

### Performance
- First-token latency: **1-3s → 100-500ms** (~5-10x improvement)
- Long sentence handling: progressive display instead of full wait
- Perceived translation speed: dramatically improved for OpenAI / Ollama

---

## [3.1.0] - 2026-07-04

This is a major feature release — first public version of the fork.

### Added
- 🐛 **8 critical bug fixes** (B1-B8)
  - B1: `debounce` → `throttle` (leading+trailing) — fixes infinite debounce reset
  - B2: Removed double `start()` initialization
  - B3: Hostname-aware domain matching (www / m. / subdomain)
  - B4: `setItem` side-effects outside setState updaters
  - B5: Example preset clicks now persist
  - B6: Fixed `inlineBlock` CSS typo
  - B7: Fixed CSS selector placeholder typo
  - B8: Max retry limit (3) + `isActive` guard for translation requests
- 🌐 **i18n system** — English + Turkish with language auto-detection
- 🏠 **Ollama Setup wizard**:
  - One-click **Detect Ollama** with model listing
  - **Pull model** with live progress streaming
  - **Start Ollama** helper with platform-specific commands
  - CORS fix block with `OLLAMA_ORIGINS` instructions
  - 13 popular translation models in scrollable picker
- 🔍 **Auto-detect subtitle scanner**:
  - Scans main document + iframes + shadow DOM
  - UI text filtering (menus, language pickers)
  - Returns ranked candidates with selector + score + reason
  - Click any candidate to apply
- 🩺 **Connection Diagnostics card** (top of Options):
  - Live test for Ollama (`/api/version`) / OpenAI (`/models`) / Google Translate
  - 7 status types: connected, cors_blocked, unreachable, auth_error, not_found, timeout, unknown
  - Status-specific hints + recent test history
- 🌍 **Google Translate (Free)** provider:
  - No API key required
  - 14 target languages (English, Turkish, Chinese, etc.)
- 🛡️ **Friendly error messages**:
  - 403 / CORS → "Restart Ollama with OLLAMA_ORIGINS=..."
  - 404 / model not found → "Run: ollama pull <model>"
  - Network errors → "Check if Ollama is running"
  - 401 → "Invalid API key"
- 🔍 **Test selector** feature for DOM config
- 📋 **Site presets** — Netflix, Udemy (Shaka), YouTube, Amazon, Disney+, HBO Max, Hulu, Paramount+, LinkedIn, Shaka (custom)
- 🎨 **Multi-selector fallback** — try multiple CSS patterns in order
- ♻️ **Reset config** button in popup
- 🏷️ **Status badge** in popup header (connected/error)
- 📐 **Responsive popup layout** (flex-based, no overflow)
- 🛑 **Anti-spam throttling**:
  - Identical errors suppressed for 30s
  - Same subtitle text not re-sent within 3s
- 📝 **Save / Reset prompt** UI:
  - Source + Target language dropdowns that auto-generate prompt
  - Save button (no longer auto-save on every keystroke)
  - 🟡 Unsaved / 🟢 Saved status indicator
- 🚫 **Exclusive discount removed** from popup (cleanup)
- 🏠 **Direct Ollama connection** — no separate HTTPS proxy required
- 📋 **All translations work in tr/en** (2 languages, zh removed)

### Changed
- Default Ollama BaseURL: `https://localhost:11435/v1` → `http://localhost:11434/v1`
- `content_scripts.all_frames: true` — content script runs in iframes too
- `host_permissions` now includes `file:///*` and `https://translate.googleapis.com/*`
- `package.json` provider type: `'openai-compatible' | 'ollama' | 'google-translate'`
- `scripting` permission added for `executeScript` (Test selector, auto-detect)
- Manifest CSP: `connect-src` updated for localhost and translate.googleapis.com

### Fixed
- Translation silently failed (generic "Translation failed" message hidden real error)
- CORS spam (was logging every 100ms)
- Memory leak: subtitle containers not cleaned up properly
- Popup overflow on small screens
- Locale label not resetting after language change

### Removed
- `local-https-proxy-ollama` dependency — direct connection replaces it
- Hardcoded Chinese translations (project now en + tr)
- Exclusive discount page (Naifei promotion)
- "Test [provider] configuration" button in API config (replaced by Connection Diagnostics)

### Security
- `file:///*` added for local file testing
- `http://localhost/*` whitelist for direct Ollama
- CSP tightened for external script sources

---

## [3.0.2] - Original (forked from)

This version is the upstream base from [ChenYCL/chrome-extension-udemy-translate](https://github.com/ChenYCL/chrome-extension-udemy-translate).

### Features (original)
- OpenAI-compatible API translation
- Ollama translation (via separate HTTPS proxy)
- Custom DOM selectors per site
- Draggable subtitle overlay
- Auto language detection (Chinese default)

[3.0.2]: https://github.com/ChenYCL/chrome-extension-udemy-translate/releases/tag/3.0.2
[3.1.0]: https://github.com/realyasster/translator/releases/tag/v3.1.0
[Unreleased]: https://github.com/realyasster/translator/compare/v3.1.0...HEAD
