# Local CTranslate2 translation server

Universal Subtitle Translator can use a local CTranslate2 translation server
for offline subtitle translation. The server source lives in this repository.
CTranslate2, Python virtual environments and downloaded models are installed
**outside** the extension and are never tracked or packaged with the Chrome
extension.

The server supports four model families: **NLLB**, **M2M-100**, **mBART-50**
and single-pair **Marian** models (for example
`Helsinki-NLP/opus-mt-en-tr`). The extension always speaks FLORES codes such as
`eng_Latn` / `tur_Latn`; a server-side adapter maps them to each tokenizer's
vocabulary. The default model is
[`facebook/nllb-200-distilled-600M`](https://huggingface.co/facebook/nllb-200-distilled-600M).

## What is in this repository

```text
server/
  pyproject.toml                 # Python 3.11 runtime, conversion, native and test pins
  native_host_entry.py           # PyInstaller entrypoint for the native launcher
  src/ct2_nllb_server/           # FastAPI server, prepare/serve CLI and native host
  tests/                         # fake-engine and native host tests
src/utils/ctranslate2.ts          # shared extension HTTP client and FLORES mapping
src/utils/ctranslate2-server-settings.ts
                                  # persisted startup settings and command builders
src/utils/ctranslate2-native-host.ts
                                  # extension client for native messaging
src/pages/options/CTranslate2SetupCard.tsx
                                  # setup UI, health display, native controls
```

`server/models/` and `server/.venv/` are gitignored development leftovers. A
normal install keeps models and the venv under the single installation root
(see below). Do not commit downloaded
models, virtual environments, Hugging Face caches, native host executables or
Python bytecode. The extension persists its startup choices under
`ctranslate2ServerSettings`; it does not store a path or device in the
translation request.

## Requirements

- Python **3.11** (the reference interpreter).
- Windows x86-64, macOS, or Linux on x86-64/ARM64.
- Disk space for Python, PyTorch conversion and the converted model.
- CPU works by default. CUDA is optional and only works on supported NVIDIA
  hardware with CUDA 12.x.

Runtime dependencies are pinned in `server/pyproject.toml`:
CTranslate2, Transformers 4.x, SentencePiece, FastAPI and Uvicorn.

PyTorch is a separate `convert` extra and is only needed for `prepare-model`.
Serving does not import PyTorch.

The optional one-click launcher uses the `native` extra (`psutil` and
PyInstaller). PyInstaller builds the small native host executable once; it is not
needed for normal manual `serve` usage.

## Install (Windows PowerShell)

Run from the repository root:

```powershell
$root = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator'
py -3.11 -m venv (Join-Path $root 'venv')
& (Join-Path $root 'venv\Scripts\Activate.ps1')
python -m pip install --upgrade pip
python -m pip install ".\server[convert]"
```

If PowerShell blocks activation, use a process-scoped policy:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& (Join-Path $root 'venv\Scripts\Activate.ps1')
```

If `py -3.11` is unavailable, install Python 3.11 from
[python.org](https://www.python.org/downloads/) and reopen the terminal.

## Install (macOS / Linux)

Run from the repository root:

```bash
root="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator"
python3.11 -m venv "$root/venv"
. "$root/venv/bin/activate"
python -m pip install --upgrade pip
python -m pip install "./server[convert]"
```

## One-click install (recommended)

No checkout is needed. In PowerShell:

```powershell
irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1 | iex
```

`irm` downloads the script for this version and `iex` runs it in memory; no file
is written and the default `ExecutionPolicy` does not block it. The tag is
generated from the extension manifest version (`buildOneClickInstallCommand`)
and stamped from `package.json` by `scripts/stamp-installer.js` before release.
If the tag is missing, the script warns and falls back to `main`.

Review the source first:
<https://github.com/realyasster/translator/blob/v3.6.0/scripts/install-ct2-server.ps1>

Parameterized remote use:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1))) `
  -Model facebook/nllb-200-distilled-600M
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/realyasster/translator/v3.8.0/scripts/install-ct2-server.ps1))) `
  -SkipModel
```

From a local checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-ct2-server.ps1
```

Double-clicking `scripts\install-ct2-server.bat` is the equivalent wrapper.

Source resolution order: `-Source <repo-or-server-folder>`, then the `server\`
folder next to a script running from disk, otherwise the GitHub archive for the
pinned `-Ref` tag (falling back to `main` on 404). A downloaded archive is
extracted under `%TEMP%\ust-<guid>\`, only its `server\` folder is used, and the
folder is deleted in `finally`.

macOS / Linux:

```bash
./scripts/install-ct2-server.sh --model facebook/nllb-200-distilled-600M
```

The script builds one repository-independent folder:

```text
%LOCALAPPDATA%\UniversalSubtitleTranslator\
  venv\            Python environment (server installed non-editable)
  models\          prepared models (auto-detected)
  native-host\     host exe, manifest, config, state\ and logs\
```

macOS uses `~/Library/Application Support/UniversalSubtitleTranslator/`, Linux
uses `${XDG_DATA_HOME:-~/.local/share}/universal-subtitle-translator/`.
`-InstallRoot`/`--install-root` overrides it. The checkout is only used as the
package source; deleting or moving it later does not break the installed server
or native launcher.

The script creates the venv, installs `server[convert,native]` non-editably,
registers the native launcher for **both Chrome and Edge**, and then asks about
the model. In an interactive terminal the menu is:

```text
Model hazırlığı:
  [1] nllb-200-distilled-600M  (nllb, hazır)
  [D] Yeni model indir (HF model id gir)
  [A] Hugging Face'te çeviri modeli ara
  [S] Atla (varsayılan, Enter)
```

- A numbered entry selects a model that is already prepared in the install
  `models/` folder; nothing is downloaded.
- `D` asks for a Hugging Face model id, validates it with `check-model` and
  prepares it with `--family auto`.
- `A` searches Hugging Face translation models, lists supported families and
  prepares the selected model.
- Enter or `S` skips the model step.
- A typo, a gated repository, an unsupported architecture or a download error
  never aborts the installer. The model step explains the problem and returns
  to the menu (`[D]` another id, `[S]` skip); a failed download offers
  `[T] retry`, `[D] another id` or `[S] skip`.

`-Model`/`--model` and `-SkipModel`/`--skip-model` never prompt. Redirected
stdin (CI/pipe) also skips the menu. An existing prepared model is always
skipped unless you explicitly pass `-OverwriteModel`/`--overwrite-model`.

### Repeated runs

Each run asks the installed server package and the launcher for their state
(`ct2-nllb-server doctor --json`). When the recorded install ref still matches
the requested source (`install-state.json` in the install root), the venv
creation and `pip install` steps are skipped (`[ok] Sunucu zaten kurulu`). For a
local checkout the ref is a fingerprint of `server/src`, `pyproject.toml` and
`native_host_entry.py`, so editing server code triggers a reinstall; an explicit
`-Ref <tag>` compares the tag instead. When the
host executable version and every targeted browser registration are current,
the launcher step is skipped too (`✓ Native launcher güncel`). Only the model
menu runs again.

- `-Repair`/`--repair` (or `-Force`/`--force`, which also rebuilds the host)
  ignores those checks and reruns every step.
- A failed model step is not fatal in an interactive session: the installer
  still exits `0` and tells you to rerun it or pick the model in the setup card.
  In a non-interactive session with `-Model`/`--model`, a failed model step
  exits non-zero (useful for CI).
- `check-model` validates the repository, gated status and model family without
  downloading or converting anything:

  ```bash
  ct2-nllb-server check-model Helsinki-NLP/opus-mt-en-tr --json
  ct2-nllb-server doctor --json
  ```

Optional parameters:

| Script | Purpose |
| --- | --- |
| `-Model <id>` / `--model <id>` | Prepare the model into the install `models\` folder without prompting. |
| `-SkipModel` / `--skip-model` | Do not ask about or prepare a model. |
| `-Browser chrome\|edge\|all` / `--browser` | Registration target; default `all`. |
| `-Force` / `--force` | Rebuild the native host executable and rerun every step. Does not touch the model. |
| `-Repair` / `--repair` | Reinstall every step even when it looks complete. |
| `-OverwriteModel` / `--overwrite-model` | Replace an already prepared model directory (`--overwrite`). |
| `-InstallRoot <dir>` / `--install-root <dir>` | Override the single installation root. |
| `-ModelsFrom <dir>` / `--models-from <dir>` | Copy prepared models from an old folder (default: `<repo>\server\models` when present). |
| `-Source <dir>` | Use a local repository root or its `server\` folder instead of downloading. |
| `-Ref <tag>` | Git tag or branch for the remote archive; default is the stamped extension tag (`v3.6.0`). |

On first run, valid models found in the old repository folder are offered for
copying into the install folder; the source is not deleted.

After the script finishes, fully quit and reopen the browser, then click
**Refresh status** in the setup card. The summary prints the install root, the
venv, the models folder, the native host folder and the selected model id. The launcher is installed with the stable
extension ID described below, so you no longer need to copy it from
`chrome://extensions`.

### Stable extension ID

`public/manifest.json` contains a `"key"` field. Chromium derives the extension
ID from that key, so the unpacked extension keeps the ID
`jjpnokgnapgibbacgponlpkeejlcffgh` regardless of its folder. The installer uses
the same value as its default; `--extension-id` remains available for extra IDs
(the native manifest's `allowed_origins` accepts several).

The matching private key is **not** committed. Keep it in a safe place for a
future Web Store update; publishing a different key changes the extension ID.
If you already loaded an older build without the key, remove and reload the
unpacked extension, then rerun the installer so the registry/manifest point at
the new ID.

## Prepare a model

Preparation downloads the Hugging Face checkpoint, validates the detected model
family, converts it to INT8 CTranslate2 format, saves the tokenizer locally, and
writes `model-metadata.json` with `format_version: 2`, `family` and the resolved
revision. It refuses to overwrite a non-empty directory unless `--overwrite` is
explicit.

`--family` accepts `auto` (default), `nllb`, `m2m100`, `mbart50` and `marian`.
Auto detection checks the tokenizer first, so the official NLLB checkpoint
(config class `m2m_100`) is still recognized as NLLB.

### Windows PowerShell

```powershell
$models = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator\models'
ct2-nllb-server prepare-model `
  --model facebook/nllb-200-distilled-600M `
  --family auto `
  --output (Join-Path $models 'nllb-200-distilled-600M')
```

### macOS / Linux

```bash
models="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator/models"
ct2-nllb-server prepare-model \
  --model facebook/nllb-200-distilled-600M \
  --family auto \
  --output "$models/nllb-200-distilled-600M"
```

Other supported examples:

```powershell
$models = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator\models'
ct2-nllb-server prepare-model --model facebook/m2m100_418M `
  --family auto --output (Join-Path $models 'm2m100_418M')
ct2-nllb-server prepare-model --model facebook/mbart-large-50-many-to-many-mmt `
  --family auto --output (Join-Path $models 'mbart-large-50')
ct2-nllb-server prepare-model --model Helsinki-NLP/opus-mt-en-tr `
  --family auto --output (Join-Path $models 'opus-mt-en-tr')
```

Marian models are usually single-direction pairs. The pair is read from names
such as `opus-mt-en-tr` and stored as `source_lang`/`target_lang`; the server
rejects the opposite direction with HTTP 422 and lists the supported pair.

List prepared models and find Hugging Face translation models:

```powershell
ct2-nllb-server list-models
ct2-nllb-server list-models --json
ct2-nllb-server search-models opus-mt --limit 15
ct2-nllb-server search-models opus-mt --json
```

`list-models` reports broken folders with a reason and `search-models` keeps
only NLLB/M2M-100/mBART-50/Marian checkpoints.

The output directory contains the converted CTranslate2 model, the local
tokenizer, and metadata with the resolved Hugging Face revision. The extension
does not need the Hugging Face repository id at runtime; it sends the id only to
compare against the model the server loaded.

Use an external folder if preferred:

```powershell
ct2-nllb-server prepare-model --model facebook/nllb-200-distilled-600M `
  --output D:\models\nllb-200-distilled-600M
ct2-nllb-server serve --model-dir D:\models\nllb-200-distilled-600M
```

## Start the server

CPU / INT8 is the default:

```powershell
$models = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator\models'
ct2-nllb-server serve --model-dir (Join-Path $models 'nllb-200-distilled-600M')
```

```bash
models="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator/models"
ct2-nllb-server serve --model-dir "$models/nllb-200-distilled-600M"
```

Defaults:

- bind: `127.0.0.1:8000` (loopback only)
- device: `cpu`
- compute type: `int8`
- one Uvicorn worker
- maximum input: 512 tokens including special tokens
- overall request deadline: 30 seconds

The server loads the local model and tokenizer once at startup through the
FastAPI lifespan handler. It never downloads during `/health` or `/translate`.
`/health` returns ready only after the model has loaded.

### Optional CUDA

Install the CUDA 12.x runtime supported by the pinned CTranslate2 wheel, then
start with:

```powershell
$models = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator\models'
ct2-nllb-server serve --model-dir (Join-Path $models 'nllb-200-distilled-600M') `
  --device cuda --compute-type int8_float16
```

```bash
models="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator/models"
ct2-nllb-server serve --model-dir "$models/nllb-200-distilled-600M" \
  --device cuda --compute-type int8_float16
```

If CUDA is unavailable, or the selected compute type is unsupported on the
chosen device, startup fails with a clear error. Use `--device cpu
--compute-type int8` on machines without a supported GPU. No speed guarantee is
made: CPU latency depends on the machine, the model, sentence length and
threading. INT8 generally reduces model size and CPU cost, but measure your own
setup.

## Configure the Chrome extension

1. Open extension **Settings**.
2. Select **CTranslate2 (Local)**.
3. Set the manual **Source language** (English by default) and **Target
   language**.
4. In the CTranslate2 setup card, review the persisted startup options:
   - **Prepared models**: the native launcher scans the install `models/` folder
     and lists valid folders. Selecting one sets **Model directory** to that
     folder and updates the provider **Model name** to its `model_id`, so health
     checks do
     not report a mismatch. **Refresh models** re-scans the folder.
   - **Model directory**: empty by default, which means auto-detect. The native
     launcher resolves a relative path against the repository root and, when
     the path is missing or empty, finds the prepared folder whose
     `model_id` matches the selected provider model. If several folders match,
     Start returns `model_select_required` and the card lists them. A manual
     path must contain the CT2 model files, `tokenizer/` and
     `model-metadata.json`.
   - **Device**: `cpu` or `cuda`.
   - **Compute type**: the same CLI choices accepted by the server. Changing
     device resets the value to the suggestion (`cpu` → `int8`,
     `cuda` → `int8_float16`).
   - **Command shell**: PowerShell or Bash; auto-detected on first use.
   - **Advanced startup**: host (`127.0.0.1` or `localhost`), port
     (1–65535), and log level.
5. Copy the generated blocks in order:
   - **First install** creates the Python 3.11 virtual environment, activates
     it and installs `server[convert]`. Run it from the repository root.
   - **Prepare model** uses the existing provider model name and the configured
     model directory. It never adds `--overwrite`.
   - **Start server** uses `--model-dir`, `--host`, `--port`, `--device`,
     `--compute-type` and `--log-level` on one line. Activate the virtual
     environment before running it.
6. The generated translation address is `http://<host>:<port>`. Editing host or
   port does **not** change the provider Base URL by itself. Click **Use this
   address for translation** to update the active CTranslate2 Base URL through
   the normal provider save flow.
7. **Test connection** always tests the active provider Base URL shown beside
   the button. The 5-second health check reports the actual loaded model,
   folder name when supported, device, compute type and check time. The server
   deliberately reports only the model folder basename, not the absolute path,
   so the operating-system user name is not exposed. Older servers that do not
   report `model_dir` remain valid.
8. Turn translation on in the popup.

Relative model paths resolve against the terminal working directory. Use an
absolute path when the terminal may start somewhere other than the repository
root. Paths with spaces, quotes, Unicode, `$`, backticks and semicolons are
supported; generated commands quote them as literal arguments. NUL and newline
characters are rejected.

Startup options are saved after a 400 ms debounce, separately from translation
settings. Changing them does not invalidate the subtitle cache or active
translation. They also do not reconfigure a running server: restart the server
to apply a new model directory, device, compute type, host, port or log level.
Device/compute type changes are highlighted in the health panel until the
running server reports the requested values.

## One-click local server (native launcher)

Chrome extensions cannot directly start operating-system processes. The setup
card can therefore use a small **native messaging host** that the user installs
once. The extension asks this host to start or stop the already configured
server; it never executes a shell command.

### One-time install

The recommended path is `scripts/install-ct2-server.ps1` (or `.bat`) /
`scripts/install-ct2-server.sh` from the previous section: it installs the
`native` extra and registers both browsers with the stable extension ID.

For a manual install after the Python environment exists:

```powershell
python -m pip install ".\server[native]"
ct2-nllb-server install-native-host --force-if-outdated
```

```bash
python -m pip install "./server[native]"
ct2-nllb-server install-native-host --force-if-outdated
```

Defaults changed with the stable ID:

- `--extension-id` is optional and defaults to
  `jjpnokgnapgibbacgponlpkeejlcffgh` (the manifest key ID). Repeat the flag to
  allow several IDs, for example a Web Store ID:
  `--extension-id <store-id>`.
- `--browser` accepts `chrome`, `edge` or `all`; the default is `all`.
- `--repo-root` defaults to the repository that contains the installed CLI, so
  the command also works from another working directory.

The installer builds the native host executable under the user data folder,
writes a `stdio` host manifest whose `allowed_origins` lists every supplied
extension ID, and registers it with Chrome and Edge. After writing, it verifies
that the executable and manifest exist and, on Windows, that the registry value
reads back correctly; a missing or stale entry is reported as an error.

The installer compares the host version marker and rebuilds a stale launcher
even without `--force`. Use `--force` when you explicitly want to rebuild the
host executable.

Host version 5 introduced the single installation root
`%LOCALAPPDATA%\UniversalSubtitleTranslator` (or the platform equivalent).
Version 6 adds the hidden launch (windowed launcher, `pythonw.exe` server) and
keeps the same layout plus `list_models` and model-directory resolution:

- The host uses `install_root`, `models_root` and the venv Python from its
  config. It does not look at the source checkout at runtime; the legacy
  `repo_root` config key is still read for upgrades.
- A relative **Model directory** is resolved under `models_root` using its last
  segment, so old values such as `./server/models/nllb-200-distilled-600M`
  keep working.
- An empty path scans `models_root` and selects the folder whose `model_id`
  matches the provider model. Several matches return
  `model_select_required`; no match returns `model_not_prepared` with the
  folders that were found.
- The resolved absolute directory is passed to `serve --model-dir`.
- The setup card calls `list_models` to populate **Prepared models**.

Restart Chrome/Edge if the setup card still reports **Native launcher not
installed** after installation, then click **Refresh status**. The setup card
shows the one-click command while the host is missing; the manual command block
is folded under **Manual installation**. A runtime ID that differs from the
manifest key is flagged, but the manual command simply omits `--extension-id`
when the default ID is in use.

### Start and stop

- **Start server** sends the current valid startup settings to the native host.
  The host validates the model folder and identity, starts
  `ct2-nllb-server serve` with an argument list (`shell=False`), waits up to 30
  seconds for `/health`, and returns the managed process state. The extension
  client waits 75 seconds so a slow start has margin; a timeout message points
  back to **Refresh status**.
- On Windows the launcher is built with `--noconsole` and starts the server with
  `pythonw.exe` (`CREATE_NO_WINDOW`, `SW_HIDE`), so no console window appears
  during Start or while the server runs. Both processes still write to
  `<install root>\native-host\logs\ct2-server.log`; host-level failures go to
  `<install root>\native-host\logs\ct2-host.log` when stdio is unavailable.
- **Stop server** stops the managed process. If the server was started
  externally, it can also stop it when the process listening on the configured
  host/port is recognized as a CT2 server (`ct2-nllb-server serve` or
  `python -m ct2_nllb_server serve`). It refuses to kill unrelated processes
  that happen to use the port.
- Starting while a managed server is already running with different model,
  device, compute type, host, port or log level fails with
  `already_running_with_different_settings`. Stop it first.
- Changing host or port in the setup card re-queries the launcher status after a
  short debounce; Start is disabled while that status is being refreshed.
- If the generated address matches the active provider Base URL, Start runs the
  existing connection test automatically. If they differ, apply the address
  explicitly before testing.
- An `external_running` response is not treated as a managed start success and
  does not trigger the automatic connection test.
- Start/Stop does not auto-start at browser launch and does not change the
  provider Base URL.

The native host writes its PID, process creation time and startup settings
immediately after spawning the server, before waiting for health. This lets a
later status call recover an orphaned managed server if the host process itself
is interrupted. The host stores state and server logs under the user data
folder, not in the extension package. The extension itself does not bundle
Python, CTranslate2, models or the host executable.

### Uninstall the launcher

```powershell
ct2-nllb-server uninstall-native-host
# optional: stop the managed server and remove host, venv, config, state and logs
ct2-nllb-server uninstall-native-host --purge
# also delete the downloaded models folder
ct2-nllb-server uninstall-native-host --purge --purge-models
```

`--purge` attempts to stop the managed server before deleting its state, so it
does not intentionally orphan a running process. It removes the native host,
venv and configuration but keeps `models/` unless `--purge-models` is given.
`uninstall-native-host` targets every registered browser by default; pass
`--browser chrome|edge` to remove only one. Because the extension ID is now
fixed by `public/manifest.json`, reloading the extension from another folder no
longer changes it.

### Permissions and security

The extension manifest includes the `nativeMessaging` permission only for this
launcher flow. The host:

- is registered only for the exact extension origin;
- accepts only `ping`, `status`, `start` and `stop`;
- validates loopback host, port, device, compute type, log level, model folder,
  metadata and selected model before spawning anything;
- uses `subprocess.Popen` with an argument list, never a shell;
- never receives subtitle text;
- stops only a managed PID or a recognized CT2 process listening on the
  configured port; unrelated processes are rejected.

The extension maps exactly the fourteen languages shown in Settings to NLLB
codes. It never silently falls back for an unknown language. The server also
rejects unsupported codes with HTTP 422.

The extension itself never launches Python, CTranslate2 or a model process. It
uses the externally installed native host for the explicit Start/Stop buttons;
manual command blocks remain available without the host. The only extra Chrome
permission is `nativeMessaging`; the existing loopback host permissions remain.

## HTTP contract

`GET /health` (ready only after load):

```json
{
  "status": "ready",
  "model": "facebook/nllb-200-distilled-600M",
  "model_dir": "nllb-200-distilled-600M",
  "family": "nllb",
  "language_pairs": null,
  "device": "cpu",
  "compute_type": "int8",
  "max_input_tokens": 512
}
```

`family` is one of `nllb`, `m2m100`, `mbart50` or `marian`. Older servers omit
both fields. `language_pairs` is `null` for many-to-many families and
`[["eng_Latn","tur_Latn"]]` for a single-pair Marian model.

`model_dir` is the basename of the loaded model folder, not the full path. It is
additive and optional for client compatibility: older servers that omit it still
return valid health responses, and the extension labels the folder as “not
reported”. A full path is never exposed by `/health`.

`POST /translate` requires `Content-Type: application/json`:

```json
{
  "model": "facebook/nllb-200-distilled-600M",
  "text": "Hello world",
  "source_lang": "eng_Latn",
  "target_lang": "tur_Latn"
}
```

Success:

```json
{ "translatedText": "Merhaba dünya" }
```

Errors use `{"detail":"..."}`:

- `404` — requested model does not match the loaded model
- `422` — blank text, unsupported language code or more than 512 tokens
- `504` — overall 30-second deadline expired
- `500` — inference failed

If source and target languages are the same, the server returns the input text
without running native inference. Blank input is still rejected. Input over 512
tokens is rejected, never truncated.

One inference runs at a time. Waiting requests share the same 30-second overall
deadline. Work that is disconnected or expired before native inference starts is
discarded. Native CTranslate2 inference **cannot be cancelled immediately**:
after a timeout the HTTP response returns, but the native calculation may keep
running briefly. The next request remains serialized so a tokenizer language
change cannot race an active native inference.

## Offline behavior

- `prepare-model` needs network access the first time it downloads the
  Hugging Face checkpoint and tokenizer. It also records the resolved revision.
- If the checkpoint is already in the local Hugging Face cache, prepare can run
  offline by passing the full 40-character commit SHA to `--revision` and
  setting `HF_HUB_OFFLINE=1`. A full SHA skips the revision metadata request.
- After preparation, `serve` loads only the local model directory. Tokenizer
  loading uses `local_files_only=True` and the server does not contact Hugging
  Face.
- The Chrome extension talks only to the configured local URL (default
  `http://127.0.0.1:8000`). It never downloads a model.
- You can disconnect the network after preparation and restart the server. The
  first load may still take time on CPU, but it does not need the internet.
- Hugging Face caches are external. Do not copy them into the extension or
  commit them.

## Switching models

The model directory is fixed for one server process. To switch:

1. Stop the running server (native **Stop server** or the terminal process).
2. Prepare the new model into a new directory, for example:
   ```powershell
   $models = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator\models'
   ct2-nllb-server prepare-model --model facebook/nllb-200-distilled-1.3B `
     --family auto --output (Join-Path $models 'nllb-200-distilled-1.3B')
   ```
3. Pick the folder in **Prepared models** (or update the manual path). This sets
   the provider **Model name** too; adjust it manually only when using an
   external directory.
4. Use **Start server** with the new settings, or copy/run the generated start
   command.
5. Test the connection again.

Restarting is required because the model is loaded once. The extension persists
`ctranslate2Config` plus the active `providerConfig`, so switching providers or
restarting Chrome restores the CTranslate2 URL, model name, source language and
target language. Startup choices are restored separately from
`ctranslate2ServerSettings`; update them before copying a new start command.

Changing the generated host or port does not change the translation Base URL
until **Use this address for translation** is clicked. After applying it,
restart the server with the new startup options; a running server is not
reconfigured by the extension.

Only NLLB, M2M-100, mBART-50 and Marian checkpoints are accepted. Other
architectures are rejected during preparation or at local startup. Marian
single-pair models reject the opposite direction with 422; switch to a model
that covers the requested pair.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Connection refused` / unreachable | Start `ct2-nllb-server serve`. Confirm the URL is `http://127.0.0.1:8000`. |
| Model not found / 404 | The loaded model id must equal the extension's Model name. Prepare and serve the same model, then retest. |
| Model mismatch diagnostic | The server is running a different model. Restart it with the selected model, or update the provider Model name. |
| Unsupported source/target language | Use one of the fourteen UI languages. Unknown names are not mapped to a fallback. |
| 422 token limit | Subtitle input exceeds 512 tokens including special tokens. Split the input; the server does not truncate. |
| Compute type unsupported | Use CPU `int8` or choose a type printed by the startup error. |
| CUDA requested but no CUDA device | Use `--device cpu`, or install a supported CUDA 12.x runtime. |
| 504 timeout | CPU inference is slower than 30 seconds or the queue is busy. Try a smaller model/line. The native inference may still be finishing. |
| Server starts then exits | Read the startup error. Confirm the model directory has `model-metadata.json`, `tokenizer/`, and CTranslate2 model files. |
| Missing conversion dependencies | Install the conversion extra: `python -m pip install ".\server[convert]"` (Windows) or `"./server[convert]"` (macOS/Linux). |
| Port already in use | Stop the other process or use `--port` and update the extension URL. The server intentionally binds loopback only. |
| Generated command has wrong quoting | Select the matching **Command shell** (PowerShell or Bash). Paths with spaces, quotes, `$`, backticks, semicolons and Unicode remain literal. |
| Health panel says restart required | Restart the server with the generated start command after changing device or compute type. Form edits do not mutate the running server. |
| Loaded model folder name is “not reported” | The running server is older and does not expose `model_dir`; update the server and test again. |
| Model folder contains spaces or Unicode | Keep the path as typed and copy the generated command; do not manually rewrite it into unquoted shell code. |
| Native launcher not installed | Run `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-ct2-server.ps1` (Windows) or `./scripts/install-ct2-server.sh`, then refresh/restart the browser. |
| `Specified native messaging host not found` | The registry/manifest does not cover the current extension ID. Reload the extension from a build that uses `public/manifest.json` (stable ID) and rerun the installer. |
| Native launcher not detected after install | Fully quit and reopen Chrome/Edge (including background apps), rerun the installer if the ID changed, then click **Refresh status**. |
| Native launcher says model not prepared | The message lists the prepared folders it found. Prepare a model or select one in **Prepared models**; an empty model directory auto-matches by provider model name. |
| Native launcher says model selection required | Several folders contain the same `model_id`. Pick the exact folder in **Prepared models** and click Start again. |
| `model-metadata.json was not found` under native-host | Update the native host (host version 6) with the installer; older hosts resolved relative paths against their own working directory. |
| Launcher outdated warning | Rerun the installer; it installs the server non-editably into the shared folder and rebuilds the host when `HOST_VERSION` changes. |
| Marian model returns 422 for a language pair | Single-pair Marian models support only their prepared direction. Use a model that covers the requested pair. |
| Native launcher says model mismatch | The prepared metadata model id differs from the provider Model name. Fix the model name or prepare the matching model. |
| Native launcher says running externally | A server was started from a terminal. Stop it there; the extension only stops processes it launched. |
| PyInstaller is not installed | Run the one-click installer or install the native extra: `python -m pip install ".\server[native]"` (Windows) or `"./server[native]"` (macOS/Linux). |
| Host registration fails | On Windows, user registry access is required; on macOS/Linux, the user Chrome/Edge NativeMessagingHosts folder must be writable. Rerun the installer with the same extension ID. |
| Health shape invalid | Check that the running server is this version and that `/health` returns the documented fields. |

No subtitle text is logged by the extension or server. Avoid adding request-body
logging when debugging; log model ids, languages and status codes only.

## Tests

Server tests inject a fake inference engine. They do not download a model and do
not require PyTorch:

```powershell
python -m pytest server\tests
```

```bash
python -m pytest server/tests
```

The tests cover health shape (including folder-basename `model_dir`), model
mismatch, language validation, token-limit rejection, same-language behavior,
JSON content type, inference errors, timeout, CORS and serialization of different
source languages. Converter architecture checks and output-overwrite refusal are
tested without a model download. Native host tests cover message framing,
settings/model validation, start/status/stop process management, external
running detection, port conflicts, and installer manifest/browser paths without
launching a real model.

Extension-side tests cover the FLORES mapping, config persistence/provider switch,
server settings defaults/derivation/normalization, device compute-type reset,
PowerShell/Bash literal escaping, prepare/serve command generation, explicit
Base URL application, autosave failures, old and new health schemas,
selected-vs-loaded model display, startup-only cache isolation, native messaging
responses/errors/timeouts, one-click Start/Stop UI behavior, JSON request body,
empty/invalid responses, timeout/abort, streaming single-final-result behavior,
cache invalidation and stale responses.

## Licence and model limitations

The NLLB model is published by Meta. The model card for
`facebook/nllb-200-distilled-600M` states the **CC-BY-NC-4.0** licence
(non-commercial use). Review the model card and licence before use:

- <https://huggingface.co/facebook/nllb-200-distilled-600M>
- <https://github.com/facebookresearch/flores/blob/main/flores200/README.md#languages-in-flores-200>

NLLB is a machine translation model. It can produce incorrect, incomplete,
biased or hallucinated translations, especially on short subtitle lines, names,
slang and low-resource languages. It has no subtitle context beyond the line
sent. The first extension release exposes fourteen languages even though NLLB
supports more; adding a language requires an explicit extension mapping and
server support. Do not use the model where inaccurate translation could cause
harm. This project does not grant rights to the model weights or training data.

Official CTranslate2 references:

- <https://opennmt.net/CTranslate2/guides/transformers.html#nllb>
- <https://opennmt.net/CTranslate2/installation.html>
- <https://opennmt.net/CTranslate2/quantization.html>
- <https://fastapi.tiangolo.com/advanced/events/>
