#!/usr/bin/env bash
# One-time installer for the local CTranslate2 server and native launcher.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-ct2-server.sh [options]

Creates a repository-independent installation under
  ${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator
  (macOS: ~/Library/Application Support/UniversalSubtitleTranslator)
containing venv/, models/ and native-host/.

Options:
  --model <id>          Prepare this Hugging Face model without prompting.
  --skip-model          Do not ask about or prepare a model.
  --browser <target>    chrome, edge or all (default: all).
  --force               Rebuild the native host executable.
  --repair              Reinstall every step even when it looks complete.
  --overwrite-model     Replace an existing prepared model directory.
  --install-root <dir>  Override the installation root.
  --models-from <dir>   Copy prepared models from this folder.
EOF
}

MODEL=""
SKIP_MODEL=0
BROWSER="all"
FORCE=0
REPAIR=0
OVERWRITE_MODEL=0
INSTALL_ROOT_ARG=""
MODELS_FROM=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model)
      [ "$#" -ge 2 ] || { echo "--model requires a value" >&2; exit 2; }
      MODEL="$2"; shift 2 ;;
    --skip-model) SKIP_MODEL=1; shift ;;
    --browser)
      [ "$#" -ge 2 ] || { echo "--browser requires a value" >&2; exit 2; }
      BROWSER="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --repair) REPAIR=1; shift ;;
    --overwrite-model) OVERWRITE_MODEL=1; shift ;;
    --install-root)
      [ "$#" -ge 2 ] || { echo "--install-root requires a value" >&2; exit 2; }
      INSTALL_ROOT_ARG="$2"; shift 2 ;;
    --models-from)
      [ "$#" -ge 2 ] || { echo "--models-from requires a value" >&2; exit 2; }
      MODELS_FROM="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$BROWSER" in
  chrome|edge|all) ;;
  *) echo "Unsupported browser: $BROWSER" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [ -n "$INSTALL_ROOT_ARG" ]; then
  install_root="$INSTALL_ROOT_ARG"
elif [ "$(uname -s)" = "Darwin" ]; then
  install_root="$HOME/Library/Application Support/UniversalSubtitleTranslator"
else
  install_root="${XDG_DATA_HOME:-$HOME/.local/share}/universal-subtitle-translator"
fi
venv_root="$install_root/venv"
venv_python="$venv_root/bin/python"
models_root="$install_root/models"
mkdir -p "$install_root" "$models_root"

doctor_tsv() {
  # serverVersion, install ref, host up-to-date, chrome registered, edge registered
  "$venv_python" -m ct2_nllb_server doctor --json --install-root "$install_root" 2>/dev/null | "$venv_python" -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    print("\t".join(["", "", "0", "0", "0"]))
    raise SystemExit(0)
host = payload.get("host") or {}
browsers = payload.get("browsers") or {}
state = payload.get("installState") or {}
print("\t".join([
    str(payload.get("serverVersion") or ""),
    str(state.get("ref") or ""),
    "1" if host.get("upToDate") else "0",
    "1" if browsers.get("chrome") else "0",
    "1" if browsers.get("edge") else "0",
]))
' || true
}

source_fingerprint() {
  "$venv_python" - "$repo_root/server" <<'PY'
import hashlib, sys
from pathlib import Path
root = Path(sys.argv[1])
digest = hashlib.sha256()
for path in [root / "pyproject.toml", root / "native_host_entry.py"]:
    if path.is_file():
        digest.update(path.name.encode("utf-8"))
        digest.update(path.read_bytes())
for path in sorted((root / "src").rglob("*.py")):
    if "__pycache__" in path.parts:
        continue
    digest.update(str(path.relative_to(root)).encode("utf-8"))
    digest.update(path.read_bytes())
print("local-" + digest.hexdigest()[:12])
PY
}

check_model_tsv() {
  # ok, message, suggestions
  "$venv_python" -m ct2_nllb_server check-model "$1" --json 2>/dev/null | "$venv_python" -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    print("\t".join(["0", "Model doğrulanamadı.", ""]))
    raise SystemExit(0)
message = (payload.get("message") or "").replace("\t", " ").replace("\n", " ")
print("\t".join([
    "1" if payload.get("ok") else "0",
    message,
    ", ".join(payload.get("suggestions") or []),
]))
' || true
}


find_python() {
  for candidate in python3.11 python3.12 python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
        echo "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

python="$(find_python)" || {
  echo "Python 3.11 or newer was not found." >&2
  echo "Install it from https://www.python.org/downloads/ and run this script again." >&2
  exit 1
}

echo "==> Install root: $install_root"
echo "==> Repository:   $repo_root"

if [ ! -x "$venv_python" ]; then
  echo "==> Creating the Python virtual environment"
  "$python" -m venv "$venv_root"
else
  echo "Using the existing virtual environment: $venv_python"
fi

if ! "$venv_python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
  echo "The existing venv is older than Python 3.11. Remove $venv_root and rerun." >&2
  exit 1
fi

desired_ref="$(source_fingerprint)"
repair_all=0
if [ "$FORCE" -eq 1 ] || [ "$REPAIR" -eq 1 ]; then
  repair_all=1
fi
server_version=""
state_ref=""
host_uptodate="0"
chrome_ready="0"
edge_ready="0"
if [ "$repair_all" -eq 0 ] && [ -x "$venv_python" ]; then
  doctor_line="$(doctor_tsv)"
  if [ -n "$doctor_line" ]; then
    IFS=$'\t' read -r server_version state_ref host_uptodate chrome_ready edge_ready <<< "$doctor_line" || true
  fi
fi

if [ "$repair_all" -eq 0 ] && [ -n "$server_version" ] && [ "$state_ref" = "$desired_ref" ]; then
  echo "✓ Sunucu zaten kurulu (atlandı)"
else
  echo "==> Installing server dependencies (convert + native extras)"
  "$venv_python" -m pip install --upgrade pip
  # Non-editable: the installed server must keep working if the checkout moves.
  "$venv_python" -m pip install --upgrade "$repo_root/server[convert,native]"
  # The freshly installed package may know a newer host version.
  if [ "$repair_all" -eq 0 ]; then
    doctor_line="$(doctor_tsv)"
    if [ -n "$doctor_line" ]; then
      IFS=$'\t' read -r server_version state_ref host_uptodate chrome_ready edge_ready <<< "$doctor_line" || true
    fi
  fi
fi

browsers_ready=0
case "$BROWSER" in
  chrome) [ "$chrome_ready" = "1" ] && browsers_ready=1 ;;
  edge) [ "$edge_ready" = "1" ] && browsers_ready=1 ;;
  all) [ "$chrome_ready" = "1" ] && [ "$edge_ready" = "1" ] && browsers_ready=1 ;;
esac
if [ "$repair_all" -eq 0 ] && [ "$host_uptodate" = "1" ] && [ "$browsers_ready" -eq 1 ]; then
  echo "✓ Native launcher güncel (atlandı)"
else
  echo "==> Registering the native launcher (browser: $BROWSER)"
  host_args=(
    install-native-host
    --browser "$BROWSER"
    --repo-root "$repo_root"
    --force-if-outdated
  )
  if [ "$FORCE" -eq 1 ]; then
    host_args+=(--force)
  fi
  "$venv_python" -m ct2_nllb_server "${host_args[@]}"
fi

"$venv_python" -m ct2_nllb_server record-install --ref "$desired_ref" --install-root "$install_root" >/dev/null \
  || echo "Uyarı: kurulum durumu yazılamadı; sonraki çalıştırma adımları yineleyebilir." >&2

prepare_ct2_model() {
  model_id="$1"
  model_segment="${model_id##*/}"
  model_dir="$models_root/$model_segment"
  if [ -f "$model_dir/model-metadata.json" ] && [ "$OVERWRITE_MODEL" -eq 0 ]; then
    echo "Model already prepared, skipping: $model_dir"
    return 0
  fi
  echo "==> Preparing model: $model_id"
  prepare_args=(prepare-model --model "$model_id" --family auto --output "$model_dir")
  if [ "$OVERWRITE_MODEL" -eq 1 ]; then
    prepare_args+=(--overwrite)
  fi
  if ! "$venv_python" -m ct2_nllb_server "${prepare_args[@]}"; then
    return 1
  fi
  return 0
}

prepare_with_retry() {
  model_id="$1"
  model_segment="${model_id##*/}"
  model_dir="$models_root/$model_segment"
  if [ -f "$model_dir/model-metadata.json" ] && [ "$OVERWRITE_MODEL" -eq 0 ]; then
    echo "Model already prepared, skipping: $model_dir"
    return 0
  fi
  while :; do
    check_line="$(check_model_tsv "$model_id")"
    IFS=$'\t' read -r check_ok check_message suggestions <<< "$check_line" || true
    if [ "$check_ok" != "1" ]; then
      echo "${check_message:-Model doğrulanamadı.}"
      [ -z "$suggestions" ] || echo "Şunu mu demek istediniz: $suggestions"
      if [ ! -t 0 ]; then
        return 1
      fi
      read -r -p '[D] Başka model gir  [S] Atla (Enter) ' choice || choice=""
      case "$choice" in
        d|D)
          read -r -p 'Hugging Face model id (boş = menüye dön) ' next || next=""
          [ -n "$next" ] || return 1
          model_id="$next"
          model_segment="${model_id##*/}"
          model_dir="$models_root/$model_segment"
          continue
          ;;
      esac
      return 1
    fi
    if prepare_ct2_model "$model_id"; then
      return 0
    fi
    echo "Model hazırlanamadı."
    if [ ! -t 0 ]; then
      return 1
    fi
    read -r -p '[T] Tekrar dene  [D] Başka model gir  [S] Atla (Enter) ' choice || choice=""
    case "$choice" in
      t|T) continue ;;
      d|D)
        read -r -p 'Hugging Face model id (boş = menüye dön) ' next || next=""
        [ -n "$next" ] || return 1
        model_id="$next"
        model_segment="${model_id##*/}"
        model_dir="$models_root/$model_segment"
        continue
        ;;
    esac
    return 1
  done
}

list_prepared_tsv() {
  "$venv_python" -m ct2_nllb_server list-models --json --models-root "$1" \
    | "$venv_python" -c '
import json, sys
payload = json.load(sys.stdin)
for model in payload["models"]:
    state = "ready" if model["valid"] else (model["problem"] or "invalid")
    print("\t".join([model["name"], model["model_id"] or "-", model["family"] or "-", state]))
'
}

search_tsv() {
  "$venv_python" -m ct2_nllb_server search-models "$1" --json \
    | "$venv_python" -c '
import json, sys
for model in json.load(sys.stdin):
    print("\t".join([model["id"], model["family"]]))
'
}

source_models="${MODELS_FROM:-$repo_root/server/models}"
if [ -d "$source_models" ] && [ "$source_models" != "$models_root" ]; then
  migration_models=()
  while IFS=$'\t' read -r name _model_id _family state; do
    [ "$state" = "ready" ] || continue
    migration_models+=("$name")
  done < <(list_prepared_tsv "$source_models")
  if [ "${#migration_models[@]}" -gt 0 ]; then
    copy_models=1
    if [ -t 0 ]; then
      answer=""
      read -r -p "$source_models içinde ${#migration_models[@]} hazır model bulundu. Kuruluma kopyalansın mı? [E/h] " answer || answer=""
      case "$answer" in
        h|H|n|N) copy_models=0 ;;
      esac
    fi
    if [ "$copy_models" -eq 1 ]; then
      for name in "${migration_models[@]}"; do
        if [ ! -e "$models_root/$name" ]; then
          echo "Copying model: $name"
          cp -R "$source_models/$name" "$models_root/$name"
        fi
      done
    fi
  fi
fi

search_menu() {
  read -r query || query=""
  [ -n "$query" ] || return 1
  results=()
  index=0
  while IFS=$'\t' read -r model_id family; do
    [ -n "$model_id" ] || continue
    index=$((index + 1))
    results+=("$model_id")
    echo "  [$index] $model_id ($family)"
  done < <(search_tsv "$query")
  if [ "${#results[@]}" -eq 0 ]; then
    echo "Desteklenen çeviri modeli bulunamadı."
    return 1
  fi
  read -r choice || choice=""
  case "$choice" in
    ''|*[!0-9]*) return 1 ;;
  esac
  choice=$((10#$choice))
  if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#results[@]}" ]; then
    echo "Geçersiz seçim."
    return 1
  fi
  selected="${results[$((choice - 1))]}"
  if ! prepare_with_retry "$selected"; then
    return 1
  fi
  SELECTED_MODEL="$selected"
  echo "Seçili model: $selected"
  return 0
}

model_menu() {
  while :; do
    echo
    echo "Model hazırlığı:"
    names=()
    ids=()
    states=()
    index=0
    while IFS=$'\t' read -r name model_id family state; do
      [ -n "$name" ] || continue
      index=$((index + 1))
      names+=("$name")
      ids+=("$model_id")
      states+=("$state")
      echo "  [$index] $name ($family, $state)"
    done < <(list_prepared_tsv "$models_root")
    echo "  [D] Yeni model indir (HF model id gir)"
    echo "  [A] Hugging Face'te çeviri modeli ara"
    echo "  [S] Atla (varsayılan, Enter)"
    read -r choice || choice=""
    case "$choice" in
      ''|s|S) return 1 ;;
      d|D)
        read -r model_id || model_id=""
        [ -n "$model_id" ] || continue
        if ! prepare_with_retry "$model_id"; then
          continue
        fi
        SELECTED_MODEL="$model_id"
        echo "Seçili model: $model_id"
        return 0
        ;;
      a|A)
        search_menu && return 0
        continue
        ;;
      *[!0-9]*)
        echo "Geçersiz seçim."
        continue
        ;;
    esac
    if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#ids[@]}" ]; then
      echo "Geçersiz seçim."
      continue
    fi
    choice=$((10#$choice))
    selected="${ids[$((choice - 1))]}"
    state="${states[$((choice - 1))]}"
    if [ "$state" != "ready" ]; then
      echo "Bu klasör kullanılamıyor: $state"
      continue
    fi
    if [ "$selected" = "-" ]; then
      echo "Bu klasörde model kimliği yok."
      continue
    fi
    SELECTED_MODEL="$selected"
    echo "Seçili model: $selected"
    return 0
  done
}

SELECTED_MODEL=""
model_step_failed=0
if [ -n "$MODEL" ]; then
  if prepare_with_retry "$MODEL"; then
    SELECTED_MODEL="$MODEL"
  else
    model_step_failed=1
  fi
elif [ "$SKIP_MODEL" -eq 1 ]; then
  echo "Model adımı atlandı (--skip-model)."
elif [ -t 0 ]; then
  if ! model_menu; then
    echo "Model adımı atlandı."
  fi
else
  echo "Etkileşimli olmayan oturum: model adımı atlandı."
fi

echo ""
echo "==> Installation complete"
echo "Install root:   $install_root"
echo "Virtual env:    $venv_root"
echo "Models:         $models_root"
echo "Native host:    $install_root/native-host"
if [ -n "$SELECTED_MODEL" ]; then
  echo "Selected model: $SELECTED_MODEL"
  echo "In Options -> CTranslate2, select the model name '$SELECTED_MODEL'."
fi
if [ "$model_step_failed" -eq 1 ] && [ ! -t 0 ]; then
  echo "Model hazırlanamadı." >&2
  exit 1
fi
echo ""
echo "Next steps:"
echo "  1. Fully quit and reopen the browser."
echo "  2. Reload the extension once."
echo "  3. Open extension Options -> CTranslate2 -> Start server."
