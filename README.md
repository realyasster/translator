# Universal Subtitle Translator

Chrome extension that translates video subtitles in place, with cloud or fully
local providers.

**[Türkçe](#türkçe)** · **[English](#english)**

---

## Türkçe

### Nedir

Altyazıları eklentinin kendi katmanında gerçek zamanlı çevirir. Altyazıyı
kendisi bulur; Netflix, YouTube, Udemy, Prime Video, Disney+, HBO Max ve manuel
seçici eklenen her sitede çalışır.

- 14 hedef dil, Türkçe + İngilizce arayüz
- OpenAI uyumlu API'ler, Ollama, Google Translate, DeepL ve yerel CTranslate2
- Akışlı çeviri, sürüklenebilir katman, orijinal satırı gizleme, bağlantı testi

### Kurulum

**Release (önerilen)**

1. [Son sürüm zip'i](https://github.com/realyasster/translator/releases/latest) indir ve aç.
2. `chrome://extensions` → **Geliştirici modu**.
3. **Paketlenmemiş öğe yükle** → açtığın klasörü seç.

**Kaynaktan**

```bash
git clone https://github.com/realyasster/translator.git
cd translator
npm install
npm run build
```

`build/` klasörünü yükle. Test: `npm test` · Tip kontrolü: `npx tsc --noEmit`

### Sağlayıcılar

| Sağlayıcı | Gerekli |
|---|---|
| OpenAI / DeepSeek / GLM | Base URL + API anahtarı + model |
| Ollama | Yerel sunucu, API anahtarı yok |
| Google Translate | Ücretsiz, anahtar yok |
| DeepL | Free veya Pro API anahtarı |
| CTranslate2 | Yerel model (çevrimdışı) |

### DeepL

Ayarlar → Çeviri → **DeepL** → planı (Free/Pro) seç → anahtarı gir →
**Bağlantıyı test et**.

Anahtar: [deepl.com/pro-api](https://www.deepl.com/pro-api). Free anahtarlar
`:fx` ile biter. İki planın anahtarı ayrı saklanır; uç nokta plandan seçilir.

### Yerel CTranslate2

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1 | iex
```

Kurulum `%LOCALAPPDATA%\UniversalSubtitleTranslator` altına venv, modeller ve
native launcher'ı kurar. Menüden hazır model seçebilir veya yeni model
indirebilirsin. Ayrıntılar: [docs/ctranslate2.md](docs/ctranslate2.md)

### Ollama

```powershell
$env:OLLAMA_ORIGINS = "chrome-extension://*"
ollama serve
```

Base URL: `http://localhost:11434/v1` · Örnek model: `qwen2.5:3b`

### Sorun giderme

| Belirti | Çözüm |
|---|---|
| Altyazı bulunamadı | **Altyazıları otomatik algıla** veya domain + CSS seçici ekle |
| Ollama 403 / CORS | `OLLAMA_ORIGINS` ile yeniden başlat |
| Native host bulunamadı | Kurulumu tekrar çalıştır, tarayıcıyı tamamen kapat/aç |
| CTranslate2 model uyuşmazlığı | Karttaki **Hazır modeller** listesinden doğru modeli seç |

### Teşekkür

Bu proje, Udemy altyazılarını çeviren
[ChenYCL/chrome-extension-udemy-translate](https://github.com/ChenYCL/chrome-extension-udemy-translate)
projesinden esinlenerek geliştirildi. Fikir ve ilk uygulama için o projeye
teşekkürler.

---

## English

### What it does

Translates video subtitles in place, in real time, inside the extension's own
overlay. It finds subtitles on its own, so it works on Netflix, YouTube, Udemy,
Prime Video, Disney+, HBO Max and any site with a manual selector.

- 14 target languages, English + Turkish UI
- OpenAI-compatible APIs, Ollama, Google Translate, DeepL and local CTranslate2
- Streaming translation, draggable overlay, hide-original toggle, connection test

### Install

**Release (recommended)**

1. Download the [latest zip](https://github.com/realyasster/translator/releases/latest) and unzip it.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder.

**From source**

```bash
git clone https://github.com/realyasster/translator.git
cd translator
npm install
npm run build
```

Load the `build/` folder. Test: `npm test` · Type-check: `npx tsc --noEmit`

### Providers

| Provider | Required |
|---|---|
| OpenAI / DeepSeek / GLM | Base URL + API key + model |
| Ollama | Local server, no API key |
| Google Translate | Free, no key |
| DeepL | Free or Pro API key |
| CTranslate2 | Local model (offline) |

### DeepL

Settings → Translation → **DeepL** → choose the plan (Free/Pro) → enter the
key → **Test connection**.

Get a key at [deepl.com/pro-api](https://www.deepl.com/pro-api). Free keys end
with `:fx`. Each plan keeps its own key; the endpoint follows the plan.

### Local CTranslate2

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1 | iex
```

The installer creates a venv, models and the native launcher under
`%LOCALAPPDATA%\UniversalSubtitleTranslator`. Pick a prepared model from the
menu or download a new one. Details: [docs/ctranslate2.md](docs/ctranslate2.md)

### Ollama

```powershell
$env:OLLAMA_ORIGINS = "chrome-extension://*"
ollama serve
```

Base URL: `http://localhost:11434/v1` · Example model: `qwen2.5:3b`

### Troubleshooting

| Symptom | Fix |
|---|---|
| Subtitles not found | Use **Auto-detect subtitles** or add a domain + CSS selector |
| Ollama 403 / CORS | Restart with `OLLAMA_ORIGINS` set |
| Native host not found | Run the installer again, then fully restart the browser |
| CTranslate2 model mismatch | Pick the right model under **Prepared models** in the setup card |

### Credits

This project was inspired by
[ChenYCL/chrome-extension-udemy-translate](https://github.com/ChenYCL/chrome-extension-udemy-translate),
a Chrome extension that translates Udemy subtitles. Thanks to that project for
the idea and the initial implementation.
