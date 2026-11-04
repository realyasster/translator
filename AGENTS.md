# AGENTS.md

## Project

Universal Subtitle Translator Chrome extension. Main content flow lives under
`src/pages/content`; detection adapters and presentation logic under
`src/pages/content/detection`.

## Project structure

- `src/pages/content/` — content script, `translation-manager.ts`, subtitle
  lifecycle and DOM overlay.
- `src/pages/content/detection/` — detection engine, ports, scoring/text
  helpers and player adapters (`udemy.ts`, `youtube.ts`, `native-track.ts`,
  `generic-dom.ts`).
- `src/pages/background/` — service worker, source coordinator and detection
  port registry.
- `src/pages/options/`, `src/pages/popup/`, `src/pages/panel/`,
  `src/pages/devtools/` — extension UI entries.
- `src/utils/` — storage/settings, provider clients, streaming translation,
  i18n, subtitle scanner and shared icon assets.
- `src/types/` — shared detection/message contracts.
- `public/` — `manifest.json`, HTML templates, favicon and extension icons.
- `server/` — optional local FastAPI/CTranslate2 NLLB server, `prepare-model`
  and `serve` CLI, native messaging launcher, and fake-engine/native tests.
  Python environments and downloaded models are external and gitignored.
- `docs/ctranslate2.md` — local server setup, offline/CUDA behavior, native
  launcher, troubleshooting and model licensing.
- `config/`, `scripts/` — CRA-derived webpack/Jest configuration and build/test
  runners. Entries are defined in `config/pageConf.js`.

## Conventions

- Read the relevant modules before making changes
- Keep consistent with the existing code style
- Do not commit generated `build/`, `release/` or `graphify-out/` artifacts

## Graphify knowledge graph

- `graphify-out/` is gitignored at the repository root and is **not copied**
  into Orca worktrees/workspaces. An agent running inside a worktree will not
  find `graphify-out/graph.json` next to its current directory; this does not
  mean the graph is missing.
- Canonical graph (main checkout):
  `C:\Users\yasin\orca\translator\graphify-out\graph.json`
  Related files in the same folder: `graph.html`, `GRAPH_REPORT.md`,
  `.graphify_python`, `.graphify_root`.
- From a worktree, pass the canonical path explicitly instead of relying on
  auto-detection:
  ```text
  graphify query "<question>" --graph "C:\Users\yasin\orca\translator\graphify-out\graph.json"
  graphify explain "<node>" --graph "C:\Users\yasin\orca\translator\graphify-out\graph.json"
  graphify path "A" "B" --graph "C:\Users\yasin\orca\translator\graphify-out\graph.json"
  graphify god-nodes --graph "C:\Users\yasin\orca\translator\graphify-out\graph.json"
  ```
- If a workspace-specific graph is needed, run `/graphify update <worktree-path>`
  inside that workspace and let its own gitignored `graphify-out/` be created.
  Do not copy or commit graphify outputs between workspaces.
- Keep the canonical graph current from the main checkout; after structural
  changes run `/graphify update .` there.
