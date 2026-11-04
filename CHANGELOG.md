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

## [3.8.0] - 2026-11-04

### Added
- **DeepL Free/Pro ayrımı** — Ayarlar → DeepL altında plan seçici. Free ve Pro
  anahtarları ayrı alanlarda saklanır; plan değişince diğer anahtar silinmez.
  Uç nokta seçili plandan belirlenir, anahtar sonekinden tahmin edilmez.
  Plan/anahtar uyuşmazlığında satır içi uyarı ve tanılama ipucu gösterilir.
- **Orijinal altyazıyı göster** anahtarı (popup) — kapatıldığında yalnızca
  eklentinin kendi orijinal satırı gizlenir; çeviri satırı ve sitenin kendi
  altyazısı etkilenmez. Video altı ve floating düzenlerde geçerlidir.

### Fixed
- DeepL seçiliyken çeviri çalışırken beliren "API anahtarı girilmemiş" kutusu:
  tüm DeepL yolları tek anahtar çözücüyü (`getDeepLApiKey`) kullanır, boş
  `providerConfig` sağlayıcıya özgü kayıttan tamamlanır, anahtar yalnızca
  alandan çıkınca kaydedilir ve taze ayarda anahtar doluysa istek bir kez
  yeniden denenir.
- `capture` edilen eski `apiKey` kayıtları okunurken plan/anahtar alanlarına
  taşınır; `apiKey` aktif planla eşlenir (geri uyum).

---

## [3.7.0] - 2026-11-04

### Added
- **DeepL sağlayıcısı** — API anahtarı ile çalışır; `:fx` ile biten ücretsiz
  anahtarlar `api-free.deepl.com`, diğerleri `api.deepl.com` uç noktasını
  otomatik kullanır. Kaynak dil varsayılanı **Otomatik (algıla)**; 429 yanıtında
  `Retry-After` (en fazla 2 sn) dikkate alınır. Bağlantı testi `/v2/usage` ile
  anahtarı doğrular.
- **Gizli sunucu penceresi** — Windows launcher'ı PyInstaller `--noconsole` ile
  derlenir; sunucu `pythonw.exe` + `CREATE_NO_WINDOW` + `SW_HIDE` ile açılır.
  Pencere yokken native messaging için ham stdio handle'ları kullanılır.
- `ct2-nllb-server doctor` (kurulum durumu), `check-model` (indirmeden model
  doğrulama, 404 önerileri, gated/aile sınıflandırması) ve `record-install`.
- Installer **tekrar çalıştırmada atlar**: içerik parmak izi ile sunucu, host
  sürümü ve tarayıcı kayıtları güncelse pip/PyInstaller adımları atlanır;
  `-Repair`/`--repair` her şeyi yeniden çalıştırır.

### Changed
- Native host **v6**; mevcut kurulumlar installer çalıştırılınca otomatik yeniden
  derlenir.
- Model menüsü hatalara dayanıklı: doğrulama/indirme hatası script'i kapatmaz,
  menüye döner; etkileşimli oturumda çıkış 0, CI'da `-Model` hatasında 1.
- `irm ... | iex` model hatasında PowerShell penceresini kapatmaz; görünür hata
  verir (`exit` yalnızca dosyadan çalışırken kullanılır).

---

## [3.6.0] - 2026-11-03

### Added
- **Tek kurulum kökü** — sunucu, modeller ve native launcher artık
  `%LOCALAPPDATA%\UniversalSubtitleTranslator\` altında (`venv\`, `models\`,
  `native-host\`). Sunucu non-editable kurulur; repo taşınsa veya silinse de
  çalışır.
- **Repo indirmeden PowerShell kurulumu** — sürüm etiketine sabit
  `irm .../vX.Y.Z/scripts/install-ct2-server.ps1 | iex`; tag yoksa `main`'e
  güvenli fallback, kaynak inceleme bağlantısı ve `-Ref`/`-Source` desteği.
- **İnteraktif model menüsü** — hazır model seç, Hugging Face model id'si indir,
  çeviri modeli ara veya Enter ile atla; eski repo modellerini yeni köke kopyalama.
- **Çoklu model ailesi** — NLLB, M2M-100, mBART-50 ve tek yönlü Marian
  (`opus-mt-*`) adapter'ları; metadata `format_version: 2` + `family`;
  `prepare-model --family auto`.
- **Model keşfi** — `list-models`, `search-models`, native host `list_models`,
  kartta **Hazır modeller** listesi ve boş model dizininde otomatik eşleme.
- `/health` yanıtında `family` ve `language_pairs`; Marian ters yön için net 422.
- `uninstall-native-host --purge --purge-models`; `-InstallRoot`, `-ModelsFrom`,
  `-SkipModel` installer parametreleri.

### Changed
- Native host **v5**: config `install_root`/`models_root` kullanır, `serve`
  `cwd=install_root` ile açılır, göreli model yolu `models_root` altında çözülür.
- Kurulum scripti önce `scripts/stamp-installer.js` ile `package.json`
  sürümünü `$DefaultRef` satırına işler; kart komutu manifest sürümünü kullanır.
- README Türkçe + İngilizce ve sadeleştirildi; CTranslate2 dokümanları yeni
  kurulum kökü, uzak kurulum ve model menüsüne göre güncellendi.

### Fixed
- `model-metadata.json was not found in ...\native-host\server\models\...`
  hatası: göreli yollar artık host cwd'sine değil `models_root`'a göre çözülür.
- Eski host exe nedeniyle `Unknown native host action: 'list_models'` hatası;
  kart sürüm eskimişliğini algılayıp yeniden kurulum istiyor.
- Host exe çalışırken `--force` yeniden derlemesinde kilit hatası: yönetilen
  sunucu önce durdurulur, kalan `PermissionError` anlaşılır mesaja çevrilir.

---

## [3.5.0] - 2026-11-03

### Added
- **Yeni uygulama ikon seti** — onaylanan 1254x1254 kaynaktan üretilen gerçek
  16x16, 32x32, 48x48 ve 128x128 PNG ikonlar; 16/32/48/128 katmanlı
  `favicon.ico`; `public` ve `src/utils/images` kopyaları; popup import'u
- **BFCache uyumlu içerik yaşam döngüsü** — `pagehide.persisted` ile askıya
  alma, `pageshow` restore'unda yeni detection portu/kaynağı ve engine
  `resetAfterRestore` temizliği

### Changed
- **Udemy video altı yerleşimi** — well bloğu için `mountAfter` dış satır
  sözleşmesi, genişletilmiş görünümde `no-sidebar` filtre düzeltmesi ve tam
  ekranda gerçek ekleme ebeveynine göre floating/below kararı
- **Manifest ve DevTools ikonları** — `icons`/`action.default_icon` 16/32/48/128
  nesne eşlemeleri; DevTools paneli artık `icon-48.png` kullanıyor
- **Port hata yönetimi** — `runtime.lastError` callback başında okunuyor;
  disconnect nedenleri kararlı `port-closed` / `port-bfcache` enum'ları

### Fixed
- BFCache kapanışında askı durumuna göre reconnect; aktif sayfada stream
  kopmasında sınırlı retry, askıda sessiz ownership bırakma
- Beklenmedik stream kopmasında hata bandı yerine önce retry; kalıcı hatada
  mevcut hata akışı; çift `releaseRequest` kaldırıldı
- Kalıcı anchor kaybında kurtarma sonrası floating; geçici kayıpta below niyeti
- Well/Q&A yanlış pozitifleri, legacy selector doğrulaması, geçersiz mount
  satırı fallback'i, native cache yapısal kontrolü ve rebind bütçesi
- Persisted olmayan `pagehide` eklentiyi durdurmuyor; dispose sonrası geç
  storage yanıtı manager'ı canlandırmıyor

---

## [3.4.0] - 2026-11-03

### Added
- 🎬 **Video-altı (below-caption) yerleşim** — Udemy altyazısı videonun altında
  gösterildiğinde çeviri, oynatıcının dışındaki özgün altyazı bloğunun hemen
  altına yerleştirilir; Udemy'nin kendi altyazısı görünür kalır ve eklenti
  ikinci bir özgün satır basmaz
- 🧭 **Yerleşim sözleşmesi** (`src/pages/content/detection/presentation.ts`) —
  dedektör yerleşimi metin örneklerinden bağımsız yayınlar
  (`subscribePresentation`, `samePresentation`, `isUsablePresentationAnchor`);
  tam ekran, bağlantı kopması ve görünürlük değişimlerinde hedef yeniden çözülür
- 🧩 **Udemy dış blok algılama** — `resolveBelowVideoAnchor` ile oynatıcı kökü
  dışındaki kararlı `data-purpose` seçicileri taranır; yalnızca video altı
  geometrisi doğrulanan blok yerleşim hedefi olur
- 🧪 Kapsamlı regresyon testleri: translation-manager, detection-engine,
  adapters, text ve scoring

### Changed
- Yerleşim, geçici dedektör durumlarında (searching / waiting / revoked) korunur;
  floating ve below-caption arasında titreme olmaz
- Udemy altyazı tercihi oynatıcı içi/dışı için tek yolda birleştirildi; kararlı
  `data-purpose` seçicileri sınıf adlarından önce denenir
- Udemy video-altı eşiği 3x, genel oynatıcı kapsayıcı eşiği 8x olarak ayrıldı
- Anchor yeniden bağlama saniyede en fazla 5 deneme ile sınırlandı (host
  yeniden render döngüsünde sonsuz yeniden eklemeyi önler)
- Q&A / curriculum bölüm dışlamaları tam sözcük eşleşmesine geçirildi ve video
  içeren kapsayıcılar dışlanmıyor
- Background ve storage dinleyicileri kayıt/kaldırma ile yönetiliyor; yeniden
  başlatmada çoğalan dinleyici kalmıyor
- Native text-track anchor'ı video öğesi anahtarlı `WeakMap` ile önbelleklenir

### Fixed
- Video-altı modda özgün satır görünürlüğü sabitlendi; kullanılmayan
  `showOriginal` bayrağı kaldırıldı
- Video-altı modda sürükleme ve konum menüsü devre dışı (yerleşim akışı bozulmuyor)
- Kamera/oynatıcı yeniden render'ında yerleşim hedefinin kopması ve kutunun
  yanlış ebeveyne taşınması giderildi

---

## [3.3.0] - 2026-11-02

### Added
- 🔍 **Automatic subtitle source detection** — no per-site selectors needed
  - Candidate collection and text analysis (`src/pages/content/detection/text.ts`)
  - Weighted candidate scoring with invalid-reason reporting (`scoring.ts`)
  - Video registry, root registry and frame-visibility tracking
  - Player adapters: native text track, YouTube, Udemy, generic DOM
  - Background `source-coordinator.ts` grants one authoritative source per tab
    across frames (generation, token and expiry based)
  - `detection-ports.ts` bridges content-script detection ports with the background
  - Shared message/types contract in `src/types/detection.ts`
- 🌐 **Interface language selector** — English and Turkish (`SUPPORTED_LANGS`)
- ⚙️ **Provider presets** — OpenAI, DeepSeek, GLM and custom, replacing the
  previous promotional example cards
- 🧩 Shared settings module `src/utils/settings-utils.ts` (provider
  normalization, preset/config merge, prompt template) and `src/utils/storage.ts`

### Changed
- `content/index.ts` split into focused modules:
  - `subtitle-lifecycle.ts` — visibility timing, source normalization, pair tracking
  - `translation-manager.ts` — translation orchestration and DOM updates
- Options and popup rebuilt on the shared settings helpers with autosave and
  reliable persistence

### Fixed
- Subtitle flicker caused by overlapping lifecycle updates
- Stale translation results overwriting newer subtitles

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
[3.2.0]: https://github.com/realyasster/translator/compare/v3.1.0...v3.2.0
[3.3.0]: https://github.com/realyasster/translator/compare/v3.2.0...v3.3.0
[3.4.0]: https://github.com/realyasster/translator/compare/v3.3.0...v3.4.0
[Unreleased]: https://github.com/realyasster/translator/compare/v3.4.0...HEAD
