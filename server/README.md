# CTranslate2 NLLB server

Local-only HTTP server for Universal Subtitle Translator. The server loads a
prepared CTranslate2 NLLB model from disk and never downloads a model during
startup or inference.

Full setup, offline, CUDA, troubleshooting and licence notes:
[`docs/ctranslate2.md`](../docs/ctranslate2.md).

## Quick start (Python 3.11)

Everything installs into one repository-independent folder:

```text
%LOCALAPPDATA%\UniversalSubtitleTranslator\
  venv\  models\  native-host\
```

Recommended: one PowerShell line, no checkout required:

```powershell
irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1 | iex
```

`irm | iex` runs the pinned tag in memory (no file, no ExecutionPolicy issue).
Parameters use a scriptblock:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1))) `
  -Model facebook/nllb-200-distilled-600M
```

From a local checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-ct2-server.ps1
```

```bash
./scripts/install-ct2-server.sh
```

The server is installed non-editably, so moving or deleting the checkout does
not break the installed host. For automation use `-Model <id>` / `--model <id>`,
or skip the menu with `-SkipModel` / `--skip-model`. Supported families are
NLLB, M2M-100, mBART-50 and single-pair Marian models; `prepare-model` detects
them with `--family auto`. Use `-InstallRoot`/`--install-root` to override the
folder and `-ModelsFrom`/`--models-from` to copy old models.

An existing prepared model is skipped. `-Force`/`--force` rebuilds the native
host only; use `-OverwriteModel`/`--overwrite-model` to replace the model
explicitly.

Then open the extension options, select **CTranslate2 (Local)** and use the
Start/Stop controls. The manual equivalent:

```powershell
$root = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator'
py -3.11 -m venv (Join-Path $root 'venv')
& (Join-Path $root 'venv\Scripts\Activate.ps1')
python -m pip install ".\server[convert]"
$models = Join-Path $root 'models'
ct2-nllb-server prepare-model --model facebook/nllb-200-distilled-600M `
  --family auto --output (Join-Path $models 'nllb-200-distilled-600M')
ct2-nllb-server serve --model-dir (Join-Path $models 'nllb-200-distilled-600M')
```

```bash
root="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator"
python3.11 -m venv "$root/venv"
. "$root/venv/bin/activate"
python -m pip install "./server[convert]"
ct2-nllb-server prepare-model --model facebook/nllb-200-distilled-600M \
  --family auto --output "$root/models/nllb-200-distilled-600M"
ct2-nllb-server serve --model-dir "$root/models/nllb-200-distilled-600M"
```

Then open the extension options, select **CTranslate2 (Local)**, keep
`http://127.0.0.1:8000` and the prepared model id, and test the connection.

Prepared models can be listed without loading them, and a model id can be
validated before a download:

```bash
ct2-nllb-server list-models --json
ct2-nllb-server search-models opus-mt --limit 15
ct2-nllb-server check-model Helsinki-NLP/opus-mt-en-tr --json
```

`check-model` reports `ok`, `code` (`not_found`, `gated`,
`unsupported_family`, `network`) and, for a 404, up to three fallback
suggestions. It never converts or downloads the model.

`doctor` reports what the one-click installer would need: Python, installed
package version, `install-state.json`, host executable version, browser
registrations and prepared models. `record-install --ref <ref>` writes
`install-state.json` so repeated installer runs can skip completed steps:

```bash
ct2-nllb-server doctor --json
ct2-nllb-server record-install --ref local
```

## Optional one-click native launcher

Chrome cannot start native processes directly. To enable the setup card's
Start/Stop buttons, run the one-click installer (it installs the `native` extra
and registers Chrome and Edge):

```powershell
irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1 | iex
```

```bash
./scripts/install-ct2-server.sh
```

Manual registration:

```powershell
python -m pip install ".\server[native]"
ct2-nllb-server install-native-host --force-if-outdated
```

```bash
python -m pip install "./server[native]"
ct2-nllb-server install-native-host --force-if-outdated
```

`--extension-id` defaults to the stable manifest-key ID
`jjpnokgnapgibbacgponlpkeejlcffgh` and can be repeated; `--browser` defaults to
`all`. Host version 5 uses the single install root (`venv/`, `models/`,
`native-host/`), resolves relative model directories under `models/`, and
exposes `list_models` for the extension's **Prepared models** picker. Restart
Chrome/Edge if the launcher is not detected. **Stop server**
stops a managed server and can also stop a recognized external
`ct2-nllb-server serve` process listening on the configured host/port;
unrelated processes are refused. `uninstall-native-host` removes the
registration for all browsers by default; `--purge` stops the managed server and
also removes the launcher/config/state/logs. See
[`docs/ctranslate2.md`](../docs/ctranslate2.md) for details.

## Tests

```bash
python -m pip install -e "./server[test]"
python -m pytest server/tests
```

The tests inject a fake inference engine. They do not download a model and do
not require PyTorch.

## HTTP contract

- `GET /health` → `{"status":"ready","model":"...","model_dir":"nllb-200-distilled-600M","family":"nllb","language_pairs":null,"device":"cpu","compute_type":"int8","max_input_tokens":512}`
- `POST /translate` with
  `{"model":"...","text":"...","source_lang":"eng_Latn","target_lang":"tur_Latn"}`
  → `{"translatedText":"..."}`

Errors use `{"detail":"..."}`. Status codes: 404 model mismatch, 422 invalid
input/language, 504 deadline, 500 inference failure.
