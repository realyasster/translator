export type Lang = 'en' | 'tr'

export interface ProviderPreset {
  name: string
  baseURL: string
  defaultModel: string
  sourceLanguage?: string
  deeplPlan?: 'free' | 'pro'
  requiresApiKey: boolean
  descriptionKey: string
}

export const SUPPORTED_LANGS: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Türkçe' },
]

type Dict = Record<string, string>

const en: Dict = {
  'options.page.title': 'Settings',
  'options.page.description':
    'Translation settings for Universal Subtitle Translator.',
  'options.autosave.pageNote':
    'Changes save automatically. The custom translation prompt has its own Save button.',
  'options.autosave.saving': 'Saving...',
  'options.autosave.saved': 'Saved',
  'options.autosave.error': 'Could not save: {message}',
  'options.loadError': 'Could not load settings: {message}',

  'options.section.general': 'General',
  'options.section.translation': 'Translation',
  'options.section.connection': 'Connection',
  'options.section.sites': 'Subtitle detection',
  'options.general.language': 'Interface language',
  'options.general.languageHint': 'Changes apply immediately.',

  'options.translation.description':
    'Choose the service and the language used for subtitle translation.',
  'options.provider.label': 'Provider',
  'options.provider.hint': 'The service used to translate subtitles.',
  'options.provider.openaiCompatible': 'OpenAI-Compatible API',
  'options.provider.ollama': 'Ollama (Local)',
  'options.provider.ctranslate2': 'CTranslate2 (Local)',
  'options.provider.googleTranslate': 'Google Translate (Free)',
  'options.provider.deepl': 'DeepL',
  'options.provider.short.openaiCompatible': 'OpenAI-compatible API',
  'options.provider.short.ollama': 'Ollama',
  'options.provider.short.ctranslate2': 'CTranslate2',
  'options.provider.short.googleTranslate': 'Google Translate',
  'options.provider.short.deepl': 'DeepL',
  'options.providerDesc.openaiCompatible':
    'Any OpenAI-compatible API, such as OpenAI, DeepSeek or GLM.',
  'options.providerDesc.ollama':
    'A local Ollama server. No API key is needed.',
  'options.providerDesc.ctranslate2':
    'A local CTranslate2 NLLB server. No API key is needed; the server and model run outside the extension.',
  'options.providerDesc.googleTranslate':
    'Google Translate free endpoint. No API key is needed.',
  'options.providerDesc.deepl':
    'DeepL API. Requires an API key; the free or Pro endpoint is picked from the key.',
  'options.provider.presetLabel': 'Service preset',
  'options.provider.presetHint':
    'Fills the connection details for a common OpenAI-compatible service.',
  'options.provider.preset.openai': 'OpenAI',
  'options.provider.preset.deepseek': 'DeepSeek',
  'options.provider.preset.glm': 'GLM (Zhipu)',
  'options.provider.preset.custom': 'Custom',
  'options.targetLang.label': 'Target language',
  'options.targetLang.hint':
    'Used by Google Translate and CTranslate2, and as a reference when writing a custom prompt.',
  'options.sourceLang.label': 'Source language',
  'options.sourceLang.hint':
    'Manual NLLB source language for CTranslate2. It is never auto-detected.',
  'options.sourceLang.hintDeepL':
    'DeepL detects the source language when Auto is selected; choose a language only if detection is unreliable.',
  'options.sourceLang.auto': 'Auto (detect)',
  'options.modelName.label': 'Model name',
  'options.modelName.placeholder': 'Enter a model name (for example, {model})',
  'options.apiKey.label': 'API key',
  'options.apiKey.placeholder': 'Enter your API key',
  'options.apiKey.hint': 'Stored locally in this browser.',
  'options.baseUrl.label': 'Base URL',
  'options.baseUrl.placeholder.openaiCompatible': 'https://api.openai.com/v1',
  'options.baseUrl.placeholder.ollama': 'http://localhost:11434/v1',
  'options.baseUrl.placeholder.ctranslate2': 'http://127.0.0.1:8000',
  'options.baseUrl.placeholder.google':
    'https://translate.googleapis.com/translate_a',
  'options.baseUrl.googleFixed': 'Google Translate uses a fixed endpoint.',
  'options.baseUrl.deeplFixed':
    'DeepL uses a fixed endpoint; the free or Pro host is selected from the API key.',
  'options.translation.googleNote':
    'Google Translate needs no API key. Model, custom prompt and streaming settings are not used with this provider.',
  'options.deepl.planLabel': 'DeepL plan',
  'options.deepl.planHint':
    'Free and Pro keys use different endpoints; each plan keeps its own key.',
  'options.deepl.planFree': 'Free',
  'options.deepl.planPro': 'Pro',
  'options.deepl.freeKeyLabel': 'DeepL API Free key',
  'options.deepl.proKeyLabel': 'DeepL API Pro key',
  'options.deepl.keyHint':
    'Create a key at deepl.com/pro-api. Free keys end with ":fx".',
  'options.deepl.planMismatchFree':
    'This key does not look like a Free key (no ":fx" suffix). Switch the plan to Pro or enter a Free key.',
  'options.deepl.planMismatchPro':
    'This key looks like a Free key. Switch the plan to Free.',
  'options.deepl.keyNote':
    'The DeepL API keys are stored only in this browser and are never sent anywhere except DeepL.',
  'options.deepl.enterKey':
    'Enter the API key for the selected DeepL plan to enable translation.',
  'options.deepl.error.freeKeyMissing':
    '🔑 The DeepL Free API key is missing. Add it in Settings → DeepL.',
  'options.deepl.error.proKeyMissing':
    '🔑 The DeepL Pro API key is missing. Add it in Settings → DeepL.',

  'options.prompt.title': 'Custom prompt',
  'options.prompt.description':
    'Used for OpenAI-compatible and Ollama translation. This field is saved only when you press Save prompt.',
  'options.prompt.draftLabel': 'Prompt template',
  'options.prompt.placeholder':
    'Translate the following <English> text into <Chinese> and separate the translations with @@@',
  'options.prompt.unsaved': 'Unsaved changes',
  'options.prompt.saved': 'Prompt saved',
  'options.prompt.save': 'Save prompt',
  'options.prompt.saving': 'Saving...',
  'options.prompt.reset': 'Reset draft',
  'options.prompt.empty': 'Enter a prompt before saving.',
  'options.prompt.saveFailed': 'Prompt was not saved: {message}',
  'options.prompt.generateTitle': 'Template generator',
  'options.prompt.generateHint':
    'These choices only build a draft and are independent from the main target language. Generating replaces the draft; your saved prompt stays unchanged until you save.',
  'options.prompt.sourceLang': 'Source language',
  'options.prompt.targetLang': 'Target language',
  'options.prompt.generate': 'Generate draft',
  'options.prompt.autoDetect': 'Auto-detect',

  'options.streaming.title': 'Streaming translation',
  'options.streaming.label': 'Show completed translations',
  'options.streaming.enabled': 'On',
  'options.streaming.disabled': 'Off',
  'options.streaming.hint':
    'Streams translations in the background and shows each completed line. Falls back to a single response if streaming fails.',
  'options.streaming.onlyProviders':
    'Used with OpenAI-compatible, Ollama and CTranslate2 providers.',
  'options.streaming.ctranslate2Note':
    'CTranslate2 returns one completed translation. No partial words are streamed.',

  'options.connection.description':
    'Check that the selected provider is reachable.',
  'options.connection.test': 'Test connection',
  'options.connection.testing': 'Testing...',
  'options.connection.never': 'Not tested yet',
  'options.connection.neverHint':
    'Run a test to verify the provider, endpoint and credentials.',
  'options.connection.lastTested': 'Last tested: {time}',
  'options.connection.details': 'Details, history and reset',
  'options.connection.lastError': 'Last test details',
  'options.connection.history': 'Recent test results',
  'options.connection.noHistory': 'No test history yet.',
  'options.connection.copyUrl': 'Copy base URL',
  'options.connection.copied': 'Copied to clipboard',
  'options.connection.copyFailed': 'Could not copy the URL.',
  'options.connection.reset': 'Reset connection settings',
  'options.connection.resetConfirm':
    'Reset the provider connection settings to their defaults? Your target language is kept.',
  'options.connection.resetDone': 'Connection settings were reset.',
  'options.connection.resetFailed': 'Could not reset settings: {message}',
  'options.connection.openOllama': 'Open Ollama',
  'options.connection.ollamaRemedy':
    'The Ollama connection failed. The setup remedy matches the reported problem.',
  'options.connection.showRemedy': 'Show Ollama remedy',
  'options.connection.ctranslate2Remedy':
    'The local CTranslate2 server connection failed.',
  'options.connection.otherProvider': 'The last test used {provider}.',
  'options.connection.latency': 'Latency',

  'options.diagnostics.status.connected': 'Connected',
  'options.diagnostics.status.loading': 'Loading',
  'options.diagnostics.status.cors_blocked': 'CORS blocked',
  'options.diagnostics.status.unreachable': 'Unreachable',
  'options.diagnostics.status.auth_error': 'Auth error',
  'options.diagnostics.status.not_found': 'Not found',
  'options.diagnostics.status.model_mismatch': 'Model mismatch',
  'options.diagnostics.status.timeout': 'Timeout',
  'options.diagnostics.status.unknown': 'Unknown',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.retry': 'Reload',
  'common.copyFailed': 'Could not copy.',
  'options.diagnostics.hint.connected':
    'The provider is reachable and translation can run.',
  'options.diagnostics.hint.loading':
    'The server is starting or the model is still loading. Wait and test again.',
  'options.diagnostics.hint.cors_blocked':
    'Ollama blocked the request. Restart it with the OLLAMA_ORIGINS setting shown in the Ollama setup.',
  'options.diagnostics.hint.unreachable':
    'The server is not running or the URL is wrong. Start it and test again.',
  'options.diagnostics.hint.auth_error':
    'Authentication failed. Check the API key and the endpoint permissions.',
  'options.diagnostics.hint.not_found':
    'The endpoint was not found. Check that the base URL is correct and ends with /v1 when required.',
  'options.diagnostics.hint.model_mismatch':
    'The running server has a different model loaded. Restart it with the selected model, or update the provider model name.',
  'options.diagnostics.hint.timeout':
    'The server did not respond in time. Check that it is running and responsive.',
  'options.diagnostics.hint.unknown':
    'The test returned an unexpected result. See the error details.',
  'options.diagnostics.ctranslate2.hint.connected':
    'The local CTranslate2 server is ready and the selected model is loaded.',
  'options.diagnostics.ctranslate2.hint.loading':
    'The server is starting or the model is still loading. Wait and test again.',
  'options.diagnostics.ctranslate2.hint.cors_blocked':
    'The extension request was blocked. The local server only allows Chrome extension origins; restart it and test again.',
  'options.diagnostics.ctranslate2.hint.unreachable':
    'The local server is not reachable. Start it with ct2-nllb-server serve and check the server URL.',
  'options.diagnostics.ctranslate2.hint.auth_error':
    'The local server rejected the request. Check the server console for details.',
  'options.diagnostics.ctranslate2.hint.not_found':
    'The server loaded a different model. Prepare and start the model selected here, or update Model name.',
  'options.diagnostics.ctranslate2.hint.model_mismatch':
    'The server is running a different model. Restart it with the selected model, or update the provider Model name.',
  'options.diagnostics.ctranslate2.hint.timeout':
    'The 5 second health check timed out. A CPU model may still be loading; wait and test again.',
  'options.diagnostics.ctranslate2.hint.unknown':
    'The server returned an unexpected health response. Check /health and the server console.',

  'options.sites.description':
    'Choose where subtitles are detected on each site.',
  'options.sites.presetsTitle': 'Site presets',
  'options.sites.presetsHint':
    'Add a saved site for a supported streaming service.',
  'options.sites.presetLabel': 'Site preset',
  'options.sites.presetPlaceholder': 'Select a site preset',
  'options.sites.presetAdd': 'Add preset',
  'options.sites.autoDetect': 'Auto-detect subtitles',
  'options.sites.autoDetectHint':
    'Scans the active tab for subtitle elements. Turn captions on first.',
  'options.sites.autoPickTitle': 'Pick a candidate',
  'options.sites.autoPickHint': 'Select a candidate to use for this site.',
  'options.sites.savedTitle': 'Saved sites',
  'options.sites.savedHint':
    'Selectors save automatically. Expand a site to edit or test its CSS selector.',
  'options.sites.selectorDetails': 'CSS selector and testing',
  'options.sites.domainLabel': 'Site domain or URL',
  'options.sites.domainPlaceholder': 'https://www.example.com',
  'options.sites.selectorLabel': 'CSS selector',
  'options.sites.selectorPlaceholder':
    'CSS selector (for example, .player-timedtext-text-container)',
  'options.sites.empty':
    'No saved sites yet. Add a preset or a custom site.',
  'options.sites.fallbackSelectors':
    'This preset also provides {count} fallback selector(s).',
  'options.sites.test': 'Test selector',
  'options.sites.testing': 'Testing...',
  'options.sites.delete': 'Delete',
  'options.sites.add': 'Add site',
  'options.sites.newSite': 'New site',
  'options.sites.noSelector': 'No selector set',
  'options.sites.testNoTab':
    'No active tab found. Open the target site first.',
  'options.sites.domainRequired':
    'Enter a site domain before testing the selector.',
  'options.sites.testNoTabOpen':
    'No open tab for {domain}. Open the target site first.',
  'options.sites.testRestricted':
    'This page cannot be tested ({url}). Open a normal website tab, such as the streaming site.',
  'options.sites.testNoPermission':
    'Missing host permission for {url}. Reload the extension after updating host permissions.',
  'options.sites.testResult': 'Found {count} element(s).',
  'options.sites.testNone':
    'No elements found. The selector may be wrong or subtitles are off.',
  'options.sites.autoFound':
    'Found {count} candidate(s). The best match was applied.',
  'options.sites.autoNone':
    'No subtitle-like text found. Make sure captions are ON in the player.',
  'options.sites.autoNoneHint':
    'Captions may be inside an iframe or shadow DOM. Auto-detect scans both.',
  'options.sites.presetApplied': 'Preset added for {site}.',
  'options.sites.autoApplied': 'Candidate applied.',
  'options.footer.version': 'Version {version}',
  'options.footer.project': 'Project on GitHub',

  'options.ctranslate2Setup.title': 'CTranslate2 setup',
  'options.ctranslate2Setup.intro':
    'The local server runs separately from Chrome. Prepare the model once, start the server, then test the connection.',
  'options.ctranslate2Setup.diagnosticFailed':
    'CTranslate2 connection test failed',
  'options.ctranslate2Setup.endpoint': 'Server URL',
  'options.ctranslate2Setup.loadedModel': 'Loaded model name',
  'options.ctranslate2Setup.commands':
    'Setup commands (Python 3.11)',
  'options.ctranslate2Setup.copyCommands': 'Copy commands',
  'options.ctranslate2Setup.copied': 'Commands copied',
  'options.ctranslate2Setup.openDocs': 'Open setup guide',
  'options.ctranslate2Setup.externalNote':
    'CTranslate2, Python environments and downloaded models stay outside the extension and are not packaged with it.',
  'options.ctranslate2Setup.loadFailed':
    'Could not load CTranslate2 server settings: {message}',
  'options.ctranslate2Setup.modelDirectory.label': 'Model directory',
  'options.ctranslate2Setup.modelDirectory.hint':
    'Manual path to the prepared model folder. Leave it empty to let the native launcher find the prepared model that matches the selected provider model in the install models folder. Legacy ./server/models paths are resolved by folder name. It must contain model-metadata.json, the model files and tokenizer/.',
  'options.ctranslate2Setup.models.label': 'Prepared models',
  'options.ctranslate2Setup.models.hint':
    'Detected in the install models folder by the native launcher. Selecting a model sets its folder and the provider model name.',
  'options.ctranslate2Setup.models.placeholder': 'Choose a prepared model',
  'options.ctranslate2Setup.models.refresh': 'Refresh models',
  'options.ctranslate2Setup.models.loadFailed':
    'Could not list prepared models: {message}',
  'options.ctranslate2Setup.models.selectFailed':
    'Could not update the provider model: {message}',
  'options.ctranslate2Setup.models.hostOutdated':
    'The installed native launcher is v{version}, but model listing requires v{required}. Run scripts/install-ct2-server.bat (Windows) or ./scripts/install-ct2-server.sh again, then refresh / restart the browser.',
  'options.ctranslate2Setup.device.label': 'Device',
  'options.ctranslate2Setup.device.hint':
    'Changing the device resets compute type to its suggested value. The server validates hardware support at startup.',
  'options.ctranslate2Setup.device.cpu': 'CPU',
  'options.ctranslate2Setup.device.cuda': 'CUDA',
  'options.ctranslate2Setup.computeType.label': 'Compute type',
  'options.ctranslate2Setup.computeType.hint':
    'CLI compute type. The server validates it against the selected hardware.',
  'options.ctranslate2Setup.shell.label': 'Command shell',
  'options.ctranslate2Setup.shell.hint':
    'Only changes quoting and generated command syntax.',
  'options.ctranslate2Setup.shell.powershell': 'PowerShell',
  'options.ctranslate2Setup.shell.bash': 'Bash',
  'options.ctranslate2Setup.advanced.title': 'Advanced startup',
  'options.ctranslate2Setup.advanced.hint':
    'Host, port and log level are only applied by restarting the server.',
  'options.ctranslate2Setup.host.label': 'Host',
  'options.ctranslate2Setup.port.label': 'Port',
  'options.ctranslate2Setup.logLevel.label': 'Log level',
  'options.ctranslate2Setup.save.saving': 'Saving startup settings...',
  'options.ctranslate2Setup.save.saved': 'Startup settings saved',
  'options.ctranslate2Setup.save.error':
    'Could not save startup settings: {message}',
  'options.ctranslate2Setup.validation.modelDirectoryRequired':
    'Enter a model directory.',
  'options.ctranslate2Setup.validation.unsafe':
    'Remove NUL or newline characters.',
  'options.ctranslate2Setup.validation.portInvalid':
    'Enter a whole-number port.',
  'options.ctranslate2Setup.validation.portRange':
    'Use a port between 1 and 65535.',
  'options.ctranslate2Setup.validation.invalid': 'Choose a supported value.',
  'options.ctranslate2Setup.validation.modelNameRequired':
    'Set a non-empty provider model name before preparing a model.',
  'options.ctranslate2Setup.commands.installTitle': '1. First install',
  'options.ctranslate2Setup.commands.installDescription':
    'Run from the repository root with Python 3.11; create the virtual environment and install server conversion dependencies.',
  'options.ctranslate2Setup.commands.repoRoot':
    'The install block assumes the terminal is at the repository root.',
  'options.ctranslate2Setup.commands.prepareTitle': '2. Prepare model',
  'options.ctranslate2Setup.commands.prepareDescription':
    'Converts the provider model into the selected model directory. The folder must already contain the prepared metadata and tokenizer layout.',
  'options.ctranslate2Setup.commands.prepareNoOverwrite':
    'This command never adds --overwrite.',
  'options.ctranslate2Setup.commands.startTitle': '3. Start server',
  'options.ctranslate2Setup.commands.startDescription':
    'Starts one local Uvicorn worker with the selected startup options.',
  'options.ctranslate2Setup.commands.startVenv':
    'Activate the virtual environment before running this command. Restart the server after changing any startup option.',
  'options.ctranslate2Setup.commands.invalidSettings':
    'Fix invalid settings to generate this command.',
  'options.ctranslate2Setup.commands.selectModelFirst':
    'Select a prepared model directory to generate this command.',
  'options.ctranslate2Setup.baseUrl.title': 'Translation address',
  'options.ctranslate2Setup.baseUrl.generated':
    'Generated from host and port',
  'options.ctranslate2Setup.baseUrl.active':
    'Active provider Base URL',
  'options.ctranslate2Setup.baseUrl.differs':
    'The generated address differs from the active Base URL. Use the button to apply it explicitly.',
  'options.ctranslate2Setup.baseUrl.apply':
    'Use this address for translation',
  'options.ctranslate2Setup.baseUrl.applied':
    'Translation Base URL updated.',
  'options.ctranslate2Setup.baseUrl.applyFailed':
    'Could not update translation Base URL: {message}',
  'options.ctranslate2Setup.baseUrl.test': 'Test connection',
  'options.ctranslate2Setup.baseUrl.testing': 'Testing...',
  'options.ctranslate2Setup.baseUrl.testTarget': 'Test target: {url}',
  'options.ctranslate2Setup.baseUrl.restartRequired':
    'Startup settings do not reconfigure a running server. Restart it to apply host or port changes.',
  'options.ctranslate2Setup.health.title': 'Running server',
  'options.ctranslate2Setup.health.selectedModel':
    'Selected provider model',
  'options.ctranslate2Setup.health.loadedModel':
    'Loaded model (server response)',
  'options.ctranslate2Setup.health.modelMismatchTitle':
    'Server model mismatch',
  'options.ctranslate2Setup.health.modelDirectory':
    'Loaded model folder name (server response)',
  'options.ctranslate2Setup.health.device': 'Running device',
  'options.ctranslate2Setup.health.computeType': 'Running compute type',
  'options.ctranslate2Setup.health.family': 'Model family',
  'options.ctranslate2Setup.health.languagePairs': 'Language pairs',
  'options.ctranslate2Setup.health.lastChecked': 'Last checked',
  'options.ctranslate2Setup.health.notReported': 'Not reported',
  'options.ctranslate2Setup.health.notReportedOldServer':
    'This server does not report model_dir (older health schema).',
  'options.ctranslate2Setup.health.neverTested':
    'Run Test connection to read the running server settings.',
  'options.ctranslate2Setup.health.restartNeeded': 'Restart required',
  'options.ctranslate2Setup.health.restartDetail':
    'Requested device/compute type: {requested}. Running: {reported}.',
  'options.ctranslate2Setup.native.title': 'One-click local server',
  'options.ctranslate2Setup.native.description':
    'Uses the installed native launcher to start or stop the local CTranslate2 server with these startup settings.',
  'options.ctranslate2Setup.native.state.checking':
    'Checking native launcher...',
  'options.ctranslate2Setup.native.state.unavailable':
    'Native launcher not installed',
  'options.ctranslate2Setup.native.state.stopped': 'Server stopped',
  'options.ctranslate2Setup.native.state.running': 'Server running',
  'options.ctranslate2Setup.native.state.external_running':
    'Server running externally',
  'options.ctranslate2Setup.native.state.starting': 'Starting server...',
  'options.ctranslate2Setup.native.state.stopping': 'Stopping server...',
  'options.ctranslate2Setup.native.state.error': 'Launcher error',
  'options.ctranslate2Setup.native.start': 'Start server',
  'options.ctranslate2Setup.native.starting': 'Starting...',
  'options.ctranslate2Setup.native.stop': 'Stop server',
  'options.ctranslate2Setup.native.stopping': 'Stopping...',
  'options.ctranslate2Setup.native.refresh': 'Refresh status',
  'options.ctranslate2Setup.native.startedTesting':
    'Server started. Testing connection...',
  'options.ctranslate2Setup.native.startedApply':
    'Server started at {url}. Apply this address for translation before testing.',
  'options.ctranslate2Setup.native.stopped': 'Server stopped.',
  'options.ctranslate2Setup.native.error': 'Launcher error: {message}',
  'options.ctranslate2Setup.native.externalHint':
    'This server was started outside the launcher. Stop server can stop it when it is a recognized CT2 server process; otherwise stop it from its terminal.',
  'options.ctranslate2Setup.native.externalAlreadyRunning':
    'A server is already running outside the launcher; it was not started or managed.',
  'options.ctranslate2Setup.native.timeoutHint':
    'The server may still be starting. Click Refresh status before trying again.',
  'options.ctranslate2Setup.native.invalidExtensionId':
    'This is not a valid Chromium extension ID. Native messaging requires a 32-character ID in the range a-p.',
  'options.ctranslate2Setup.native.managedHint':
    'Started and managed by the native launcher.',
  'options.ctranslate2Setup.native.restartNote':
    'Start and stop only affect the running process; startup settings remain saved separately.',
  'options.ctranslate2Setup.native.installTitle':
    'Install native launcher (one time)',
  'options.ctranslate2Setup.native.installDescription':
    'Chrome cannot start operating-system processes directly. Install the small native launcher once for this extension ID.',
  'options.ctranslate2Setup.native.extensionId': 'Extension ID',
  'options.ctranslate2Setup.native.copyExtensionId': 'Copy extension ID',
  'options.ctranslate2Setup.native.installCommand': 'Install command',
  'options.ctranslate2Setup.native.installAfter':
    'Run this from the repository root with the server virtual environment active, then click Refresh status.',
  'options.ctranslate2Setup.native.restartChrome':
    'Restart Chrome if the launcher is not detected.',
  'options.ctranslate2Setup.oneClick.title': 'One-click installation',
  'options.ctranslate2Setup.oneClick.description':
    'Downloads the installer script for this extension version from GitHub and runs it. It creates a shared environment, models and native launcher under %LOCALAPPDATA%\\UniversalSubtitleTranslator (or the platform equivalent), registers Chrome and Edge, and prepares the selected model when it is valid. Review the source link before running it.',
  'options.ctranslate2Setup.oneClick.reviewSource':
    'Review the installer source',
  'options.ctranslate2Setup.oneClick.restartHint':
    'After it finishes, fully quit and reopen the browser, then click Refresh status.',
  'options.ctranslate2Setup.oneClick.manualToggle': 'Manual installation',
  'options.ctranslate2Setup.oneClick.extensionIdMismatch':
    'This extension is not loaded with the built-in manifest key, so its ID differs from the installer default. Reload the unpacked extension from this manifest, or pass the current ID explicitly.',

  'options.ollamaSetup.title': 'Ollama setup',
  'options.ollamaSetup.intro':
    'Ollama runs locally and is reached directly. Make sure it is running, then detect it.',
  'options.ollamaSetup.detect': 'Detect Ollama',
  'options.ollamaSetup.detecting': 'Detecting...',
  'options.ollamaSetup.running': 'Ollama is running',
  'options.ollamaSetup.notRunning': 'Ollama is not reachable',
  'options.ollamaSetup.connectionFailed': 'Ollama connection test failed',
  'options.ollamaSetup.installHint':
    'Install Ollama from https://ollama.com and run ollama serve in a terminal.',
  'options.ollamaSetup.version': 'Version',
  'options.ollamaSetup.modelsTitle': 'Installed models',
  'options.ollamaSetup.noModels':
    'No models installed yet. Pull one below.',
  'options.ollamaSetup.useModel': 'Set as active',
  'options.ollamaSetup.activeModel': 'Active model',
  'options.ollamaSetup.modelSet': 'Active model set to {model}.',
  'options.ollamaSetup.pullTitle': 'Pull a model',
  'options.ollamaSetup.pullModelLabel': 'Model to pull',
  'options.ollamaSetup.pullPlaceholder':
    'Model name (for example, qwen2:0.5b)',
  'options.ollamaSetup.pullButton': 'Pull',
  'options.ollamaSetup.pulling': 'Pulling...',
  'options.ollamaSetup.pullProgress': 'Pulling: {status}',
  'options.ollamaSetup.pullDone': 'Model {model} is ready.',
  'options.ollamaSetup.pullFailed': 'Pull failed: {message}',
  'options.ollamaSetup.recommendTitle': 'Popular models for translation',
  'options.ollamaSetup.recommendHint':
    'Select a model name to fill the field.',
  'options.ollamaSetup.errorConnect':
    'Cannot reach Ollama. Default URL: {url}',
  'options.ollamaSetup.errorCors':
    'Ollama blocked the request. Restart it with OLLAMA_ORIGINS set to allow this extension.',
  'options.ollamaSetup.corsFixTitle':
    'Allow this extension in Ollama (CORS)',
  'options.ollamaSetup.corsFixHint':
    'Ollama rejects browser extension requests by default. Restart it with the OLLAMA_ORIGINS environment variable:',
  'options.ollamaSetup.corsCmd.macos':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsCmd.linux':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsCmd.windows':
    'setx OLLAMA_ORIGINS "chrome-extension://*"',
  'options.ollamaSetup.corsPermCmd.macos':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsPermCmd.linux': 'OLLAMA_ORIGINS="*" ollama serve',
  'options.ollamaSetup.corsPermCmd.windows': 'setx OLLAMA_ORIGINS "*"',
  'options.ollamaSetup.corsAltTitle': 'Quick alternatives',
  'options.ollamaSetup.corsAltHint':
    'If the environment variable does not work:',
  'options.ollamaSetup.corsRestartHint':
    'Restart the Ollama service after setting the environment variable.',
  'options.ollamaSetup.corsWindowsHint':
    'On Windows, run setx in an administrator terminal, then open a new terminal.',
  'options.ollamaSetup.corsServiceHint':
    'If Ollama runs as a system service, edit its environment with systemctl edit ollama.',
  'options.ollamaSetup.startTitle': 'Start Ollama',
  'options.ollamaSetup.startHint':
    'Ollama is not running. Chrome extensions cannot start system processes. Run the command below in a terminal, or open the Ollama app.',
  'options.ollamaSetup.setupCommands': 'Setup commands',
  'options.ollamaSetup.copyCommand': 'Copy command',
  'options.ollamaSetup.copied': 'Copied to clipboard',
  'options.ollamaSetup.openDownload': 'Download Ollama',
  'options.ollamaSetup.openDocs': 'Setup guide',
  'options.ollamaSetup.openApp': 'Open Ollama app',
  'options.ollamaSetup.cmd.macos': 'ollama serve',
  'options.ollamaSetup.cmd.linux': 'ollama serve',
  'options.ollamaSetup.cmd.windows': 'ollama serve',
  'options.ollamaSetup.useDirect': 'Direct connection',
  'options.ollamaSetup.useDirectHint':
    'The extension talks to Ollama over http://localhost. No HTTPS proxy is needed.',

  'popup.brand': 'Universal Subtitle Translator',
  'popup.openSettings': 'Open settings',
  'popup.status.never': 'Not tested',
  'popup.status.tooltip': 'Open connection settings',
  'popup.translationEnabled': 'Translation enabled',
  'popup.translationEnabledHint':
    'Turn subtitle translation on or off for supported sites.',
  'popup.label.showOriginal': 'Show original subtitle',
  'popup.hint.showOriginal':
    'Hides only the original row shown by the extension; translation is not affected.',
  'popup.appearance.title': 'Appearance',
  'popup.group.background': 'Background',
  'popup.group.original': 'Original subtitles',
  'popup.group.translation': 'Translation',
  'popup.label.bgColor': 'Background color',
  'popup.label.bgOpacity': 'Background opacity',
  'popup.label.originSize': 'Font size',
  'popup.label.originColor': 'Text color',
  'popup.label.originWeight': 'Font weight',
  'popup.label.translatedSize': 'Font size',
  'popup.label.translatedColor': 'Text color',
  'popup.label.translatedWeight': 'Font weight',
  'popup.value.px': '{value} px',
  'popup.value.percent': '{value}%',
  'popup.color.choose': 'Choose color',
  'popup.color.custom': 'Custom color',
  'popup.color.transparent': 'Transparent',
  'popup.weight.normal': 'Normal',
  'popup.weight.bold': 'Bold',
  'popup.autosave': 'Changes save automatically.',
  'popup.saveError': 'Could not save: {message}',
  'popup.loadError': 'Could not load settings: {message}',
  'popup.reset.button': 'Reset appearance',
  'popup.reset.confirm':
    'Reset subtitle appearance to defaults? Translation on/off will not change.',
  'popup.reset.ok': 'Reset',
  'popup.reset.cancel': 'Cancel',
  'popup.switch.on': 'On',
  'popup.switch.off': 'Off',

  'panel.title': 'Dev Tools Panel',
  'panel.waiting': 'waiting...',

  'options.autoDetection.title': 'Automatic Subtitle Detection',
  'options.autoDetection.description':
    'Turn the extension on and play a video. The extension finds the active subtitle source by itself; no site setup, CSS selector or candidate selection is needed.',
  'options.autoDetection.source': 'Source',
  'options.autoDetection.score': 'Confidence',
  'options.autoDetection.diagnostics': 'Diagnostics',
  'options.autoDetection.diagnosticsHint':
    'Read-only details. Detection cannot be forced to a different source here.',
  'options.autoDetection.legacyNote':
    'Old site selector records are kept in storage for reference only; they do not force a source.',
  'detection.phase.disabled': 'Translation off',
  'detection.phase.searching': 'Looking for a video',
  'detection.phase.verifying': 'Verifying subtitle source',
  'detection.phase.connected': 'Connected to subtitles',
  'detection.phase.waiting': 'Waiting for the next subtitle line',
  'detection.phase.suspended': 'Paused while the page is hidden',
  'detection.phase.unavailable': 'No readable subtitles found; captions may be off',
  'detection.source.text-track': 'Native text track',
  'detection.source.player-dom': 'Verified player captions',
  'detection.source.generic-dom': 'On-screen subtitles',
  'detection.reason.connected': 'Translating the active subtitle source.',
  'detection.reason.videoNotFound': 'No visible video on this page yet.',
  'detection.reason.videoOffscreen': 'The video is outside the visible area.',
  'detection.reason.frameUnknown': 'Waiting for the parent frame to confirm visibility.',
  'detection.reason.subtitleNotFound': 'No subtitle-looking text found yet.',
  'detection.reason.noReadable':
    'No source could be verified while the video is playing. Captions may be off.',
  'detection.reason.lowConfidence': 'A candidate was found but confidence is still low.',
  'detection.reason.ambiguous':
    'Two independent candidates are too close to choose safely.',
  'detection.reason.insufficient':
    'Watching for more subtitle changes before translating.',
  'detection.reason.waitingText': 'A candidate is present but currently has no text.',
  'detection.reason.waitingLine': 'Connected; waiting for the next line.',
  'detection.reason.awaitingGrant': 'Source verified; waiting for tab authorization.',
  'detection.reason.sourceLost': 'The previous source disappeared; searching again.',
  'detection.reason.pageHidden': 'Detection is suspended while the tab is hidden.',
  'detection.reason.extensionDisabled': 'Translation is disabled in the popup.',
  'detection.reason.noFrame': 'No content script has reported from this tab yet.',
  'detection.reason.switching': 'Switching to a better subtitle source.',
  'detection.reason.disabled': 'Detection is off.',
  'popup.detection.title': 'Subtitle detection',
  'popup.detection.source': 'Source',
}

const tr: Dict = {
  'options.page.title': 'Ayarlar',
  'options.page.description':
    'Universal Subtitle Translator için çeviri ayarları.',
  'options.autosave.pageNote':
    'Değişiklikler otomatik kaydedilir. Özel çeviri isteminin kendi Kaydet düğmesi vardır.',
  'options.autosave.saving': 'Kaydediliyor...',
  'options.autosave.saved': 'Kaydedildi',
  'options.autosave.error': 'Kaydedilemedi: {message}',
  'options.loadError': 'Ayarlar yüklenemedi: {message}',

  'options.section.general': 'Genel',
  'options.section.translation': 'Çeviri',
  'options.section.connection': 'Bağlantı',
  'options.section.sites': 'Altyaz? alg?lama',
  'options.general.language': 'Arayüz dili',
  'options.general.languageHint': 'Değişiklikler hemen uygulanır.',

  'options.translation.description':
    'Altyazı çevirisinde kullanılacak hizmeti ve dili seçin.',
  'options.provider.label': 'Sağlayıcı',
  'options.provider.hint': 'Altyazıları çevirmek için kullanılan hizmet.',
  'options.provider.openaiCompatible': 'OpenAI Uyumlu API',
  'options.provider.ollama': 'Ollama (Yerel)',
  'options.provider.ctranslate2': 'CTranslate2 (Yerel)',
  'options.provider.googleTranslate': 'Google Translate (Ücretsiz)',
  'options.provider.deepl': 'DeepL',
  'options.provider.short.openaiCompatible': 'OpenAI uyumlu API',
  'options.provider.short.ollama': 'Ollama',
  'options.provider.short.ctranslate2': 'CTranslate2',
  'options.provider.short.googleTranslate': 'Google Translate',
  'options.provider.short.deepl': 'DeepL',
  'options.providerDesc.openaiCompatible':
    'OpenAI, DeepSeek veya GLM gibi OpenAI uyumlu herhangi bir API.',
  'options.providerDesc.ollama':
    'Yerel bir Ollama sunucusu. API anahtarı gerekmez.',
  'options.providerDesc.ctranslate2':
    'Yerel bir CTranslate2 NLLB sunucusu. API anahtarı gerekmez; sunucu ve model eklenti dışında çalışır.',
  'options.providerDesc.googleTranslate':
    'Google Translate ücretsiz uç noktası. API anahtarı gerekmez.',
  'options.providerDesc.deepl':
    'DeepL API. API anahtarı gerekir; ücretsiz veya Pro uç noktası anahtardan otomatik seçilir.',
  'options.provider.presetLabel': 'Hizmet ön ayarı',
  'options.provider.presetHint':
    'Yaygın bir OpenAI uyumlu hizmet için bağlantı bilgilerini doldurur.',
  'options.provider.preset.openai': 'OpenAI',
  'options.provider.preset.deepseek': 'DeepSeek',
  'options.provider.preset.glm': 'GLM (Zhipu)',
  'options.provider.preset.custom': 'Özel',
  'options.targetLang.label': 'Hedef dil',
  'options.targetLang.hint':
    'Google Translate ve CTranslate2 tarafından kullanılır; özel istem yazarken de referanstır.',
  'options.sourceLang.label': 'Kaynak dil',
  'options.sourceLang.hint':
    'CTranslate2 için elle seçilen NLLB kaynak dili. Otomatik algılanmaz.',
  'options.sourceLang.hintDeepL':
    'Otomatik seçildiğinde kaynak dili DeepL algılar; yalnızca algılama güvenilmezse dil seçin.',
  'options.sourceLang.auto': 'Otomatik (algıla)',
  'options.modelName.label': 'Model adı',
  'options.modelName.placeholder': 'Model adı girin (örneğin, {model})',
  'options.apiKey.label': 'API anahtarı',
  'options.apiKey.placeholder': 'API anahtarınızı girin',
  'options.apiKey.hint': 'Bu tarayıcıda yerel olarak saklanır.',
  'options.baseUrl.label': 'Temel URL',
  'options.baseUrl.placeholder.openaiCompatible': 'https://api.openai.com/v1',
  'options.baseUrl.placeholder.ollama': 'http://localhost:11434/v1',
  'options.baseUrl.placeholder.ctranslate2': 'http://127.0.0.1:8000',
  'options.baseUrl.placeholder.google':
    'https://translate.googleapis.com/translate_a',
  'options.baseUrl.googleFixed':
    'Google Translate sabit bir uç nokta kullanır.',
  'options.baseUrl.deeplFixed':
    'DeepL sabit bir uç nokta kullanır; ücretsiz veya Pro sunucu API anahtarından seçilir.',
  'options.translation.googleNote':
    'Google Translate API anahtarı gerektirmez. Model, özel istem ve akış ayarları bu sağlayıcıda kullanılmaz.',
  'options.deepl.planLabel': 'DeepL planı',
  'options.deepl.planHint':
    'Free ve Pro anahtarları farklı uç noktalar kullanır; her plan kendi anahtarını saklar.',
  'options.deepl.planFree': 'Free',
  'options.deepl.planPro': 'Pro',
  'options.deepl.freeKeyLabel': 'DeepL API Free anahtarı',
  'options.deepl.proKeyLabel': 'DeepL API Pro anahtarı',
  'options.deepl.keyHint':
    'deepl.com/pro-api adresinden anahtar oluşturun. Ücretsiz anahtarlar ":fx" ile biter.',
  'options.deepl.planMismatchFree':
    'Bu anahtar Free anahtarına benzemiyor (":fx" soneki yok). Planı Pro yapın veya bir Free anahtarı girin.',
  'options.deepl.planMismatchPro':
    'Bu anahtar Free anahtarına benziyor. Planı Free yapın.',
  'options.deepl.keyNote':
    'DeepL API anahtarları yalnızca bu tarayıcıda saklanır ve DeepL dışında hiçbir yere gönderilmez.',
  'options.deepl.enterKey':
    'Çeviriyi etkinleştirmek için seçili DeepL planının API anahtarını girin.',
  'options.deepl.error.freeKeyMissing':
    '🔑 DeepL Free API anahtarı girilmemiş. Ayarlar → DeepL bölümünden ekleyin.',
  'options.deepl.error.proKeyMissing':
    '🔑 DeepL Pro API anahtarı girilmemiş. Ayarlar → DeepL bölümünden ekleyin.',

  'options.prompt.title': 'Özel istem',
  'options.prompt.description':
    'OpenAI uyumlu ve Ollama çevirisinde kullanılır. Bu alan yalnızca İstemi kaydet düğmesine bastığınızda kaydedilir.',
  'options.prompt.draftLabel': 'İstem şablonu',
  'options.prompt.placeholder':
    'Aşağıdaki <İngilizce> metni <Çinceye> çevir ve çevirileri @@@ ile ayır',
  'options.prompt.unsaved': 'Kaydedilmemiş değişiklikler',
  'options.prompt.saved': 'İstem kaydedildi',
  'options.prompt.save': 'İstemi kaydet',
  'options.prompt.saving': 'Kaydediliyor...',
  'options.prompt.reset': 'Taslağı sıfırla',
  'options.prompt.empty': 'Kaydetmeden önce bir istem girin.',
  'options.prompt.saveFailed': 'İstem kaydedilemedi: {message}',
  'options.prompt.generateTitle': 'Şablon oluşturucu',
  'options.prompt.generateHint':
    'Bu seçimler yalnızca bir taslak oluşturur ve ana hedef dilden bağımsızdır. Oluşturma taslağı değiştirir; kaydedilmiş isteminiz siz kaydedene kadar değişmez.',
  'options.prompt.sourceLang': 'Kaynak dil',
  'options.prompt.targetLang': 'Hedef dil',
  'options.prompt.generate': 'Taslak oluştur',
  'options.prompt.autoDetect': 'Otomatik algıla',

  'options.streaming.title': 'Akış çevirisi',
  'options.streaming.label': 'Tamamlanan çevirileri göster',
  'options.streaming.enabled': 'Açık',
  'options.streaming.disabled': 'Kapalı',
  'options.streaming.hint':
    'Çeviriyi arka planda akıtır ve tamamlanan satırı gösterir. Akış başarısız olursa tek yanıta döner.',
  'options.streaming.onlyProviders':
    'OpenAI uyumlu, Ollama ve CTranslate2 sağlayıcılarıyla kullanılır.',
  'options.streaming.ctranslate2Note':
    'CTranslate2 tek bir tamamlanmış çeviri döndürür. Kelime kelime akış yapılmaz.',

  'options.connection.description':
    'Seçili sağlayıcının erişilebilir olduğunu kontrol edin.',
  'options.connection.test': 'Bağlantıyı test et',
  'options.connection.testing': 'Test ediliyor...',
  'options.connection.never': 'Henüz test edilmedi',
  'options.connection.neverHint':
    'Sağlayıcıyı, uç noktayı ve kimlik bilgilerini doğrulamak için bir test çalıştırın.',
  'options.connection.lastTested': 'Son test: {time}',
  'options.connection.details': 'Ayrıntılar, geçmiş ve sıfırlama',
  'options.connection.lastError': 'Son test ayrıntıları',
  'options.connection.history': 'Son test sonuçları',
  'options.connection.noHistory': 'Henüz test geçmişi yok.',
  'options.connection.copyUrl': 'Temel URL’yi kopyala',
  'options.connection.copied': 'Panoya kopyalandı',
  'options.connection.copyFailed': 'URL kopyalanamadı.',
  'options.connection.reset': 'Bağlantı ayarlarını sıfırla',
  'options.connection.resetConfirm':
    'Sağlayıcı bağlantı ayarları varsayılana sıfırlansın mı? Hedef diliniz korunur.',
  'options.connection.resetDone': 'Bağlantı ayarları sıfırlandı.',
  'options.connection.resetFailed': 'Ayarlar sıfırlanamadı: {message}',
  'options.connection.openOllama': 'Ollama’yı aç',
  'options.connection.ollamaRemedy':
    'Ollama bağlantısı başarısız oldu. Kurulum çözümü bildirilen sorunla eşleşiyor.',
  'options.connection.showRemedy': 'Ollama çözümünü göster',
  'options.connection.ctranslate2Remedy':
    'Yerel CTranslate2 sunucusu bağlantısı başarısız oldu.',
  'options.connection.otherProvider': 'Son test {provider} için yapıldı.',
  'options.connection.latency': 'Gecikme',

  'options.diagnostics.status.connected': 'Bağlı',
  'options.diagnostics.status.loading': 'Yükleniyor',
  'options.diagnostics.status.cors_blocked': 'CORS engellendi',
  'options.diagnostics.status.unreachable': 'Erişilemiyor',
  'options.diagnostics.status.auth_error': 'Kimlik doğrulama hatası',
  'options.diagnostics.status.not_found': 'Bulunamadı',
  'options.diagnostics.status.model_mismatch': 'Model uyuşmazlığı',
  'options.diagnostics.status.timeout': 'Zaman aşımı',
  'options.diagnostics.status.unknown': 'Bilinmiyor',
  'common.confirm': 'Onayla',
  'common.cancel': 'İptal',
  'common.retry': 'Yeniden yükle',
  'common.copyFailed': 'Kopyalanamadı.',
  'options.diagnostics.hint.connected':
    'Sağlayıcıya erişilebiliyor ve çeviri çalışabilir.',
  'options.diagnostics.hint.loading':
    'Sunucu başlatılıyor veya model hâlâ yükleniyor. Bekleyip tekrar test edin.',
  'options.diagnostics.hint.cors_blocked':
    'Ollama isteği engelledi. Ollama kurulumunda gösterilen OLLAMA_ORIGINS ayarıyla yeniden başlatın.',
  'options.diagnostics.hint.unreachable':
    'Sunucu çalışmıyor veya URL yanlış. Başlatıp tekrar test edin.',
  'options.diagnostics.hint.auth_error':
    'Kimlik doğrulama başarısız. API anahtarını ve uç nokta izinlerini kontrol edin.',
  'options.diagnostics.hint.not_found':
    'Uç nokta bulunamadı. Temel URL’nin doğru olduğunu ve gerektiğinde /v1 ile bittiğini kontrol edin.',
  'options.diagnostics.hint.model_mismatch':
    'Çalışan sunucuda farklı bir model yüklü. Sunucuyu seçili modelle yeniden başlatın veya sağlayıcı model adını güncelleyin.',
  'options.diagnostics.hint.timeout':
    'Sunucu zamanında yanıt vermedi. Çalıştığını ve yanıt verdiğini kontrol edin.',
  'options.diagnostics.hint.unknown':
    'Test beklenmeyen bir sonuç döndürdü. Hata ayrıntılarına bakın.',
  'options.diagnostics.ctranslate2.hint.connected':
    'Yerel CTranslate2 sunucusu hazır ve seçili model yüklü.',
  'options.diagnostics.ctranslate2.hint.loading':
    'Sunucu başlatılıyor veya model hâlâ yükleniyor. Bekleyip tekrar test edin.',
  'options.diagnostics.ctranslate2.hint.cors_blocked':
    'Eklenti isteği engellendi. Yerel sunucu yalnızca Chrome eklenti kaynaklarına izin verir; yeniden başlatıp tekrar test edin.',
  'options.diagnostics.ctranslate2.hint.unreachable':
    'Yerel sunucuya erişilemiyor. ct2-nllb-server serve ile başlatın ve sunucu URL’sini kontrol edin.',
  'options.diagnostics.ctranslate2.hint.auth_error':
    'Yerel sunucu isteği reddetti. Ayrıntılar için sunucu konsoluna bakın.',
  'options.diagnostics.ctranslate2.hint.not_found':
    'Sunucuda farklı bir model yüklü. Burada seçili modeli hazırlayıp başlatın veya Model adını güncelleyin.',
  'options.diagnostics.ctranslate2.hint.model_mismatch':
    'Sunucu farklı bir model çalıştırıyor. Sunucuyu seçili modelle yeniden başlatın veya sağlayıcı Model adını güncelleyin.',
  'options.diagnostics.ctranslate2.hint.timeout':
    '5 saniyelik sağlık kontrolü zaman aşımına uğradı. CPU modeli hâlâ yükleniyor olabilir; bekleyip tekrar test edin.',
  'options.diagnostics.ctranslate2.hint.unknown':
    'Sunucu beklenmeyen bir sağlık yanıtı döndürdü. /health ve sunucu konsolunu kontrol edin.',

  'options.sites.description':
    'Altyazıların her sitede nerede algılanacağını seçin.',
  'options.sites.presetsTitle': 'Site hazır ayarları',
  'options.sites.presetsHint':
    'Desteklenen bir yayın hizmeti için kayıtlı site ekleyin.',
  'options.sites.presetLabel': 'Site ön ayarı',
  'options.sites.presetPlaceholder': 'Bir site ön ayarı seçin',
  'options.sites.presetAdd': 'Ön ayar ekle',
  'options.sites.autoDetect': 'Altyazıları otomatik algıla',
  'options.sites.autoDetectHint':
    'Etkin sekmede altyazı öğelerini tarar. Önce altyazıları açın.',
  'options.sites.autoPickTitle': 'Aday seç',
  'options.sites.autoPickHint':
    'Bu site için kullanmak üzere bir aday seçin.',
  'options.sites.savedTitle': 'Kayıtlı siteler',
  'options.sites.savedHint':
    'Seçiciler otomatik kaydedilir. CSS seçicisini düzenlemek veya test etmek için bir siteyi genişletin.',
  'options.sites.selectorDetails': 'CSS seçicisi ve test',
  'options.sites.domainLabel': 'Site alan adı veya URL’si',
  'options.sites.domainPlaceholder': 'https://www.ornek.com',
  'options.sites.selectorLabel': 'CSS seçici',
  'options.sites.selectorPlaceholder':
    'CSS seçici (örneğin, .player-timedtext-text-container)',
  'options.sites.empty':
    'Henüz kayıtlı site yok. Bir ön ayar veya özel site ekleyin.',
  'options.sites.fallbackSelectors':
    'Bu ön ayar ayrıca {count} yedek seçici sağlar.',
  'options.sites.test': 'Seçiciyi test et',
  'options.sites.testing': 'Test ediliyor...',
  'options.sites.delete': 'Sil',
  'options.sites.add': 'Site ekle',
  'options.sites.newSite': 'Yeni site',
  'options.sites.noSelector': 'Seçici ayarlanmadı',
  'options.sites.testNoTab':
    'Etkin sekme bulunamadı. Önce hedef siteyi açın.',
  'options.sites.domainRequired':
    'Seçiciyi test etmeden önce bir site alan adı girin.',
  'options.sites.testNoTabOpen':
    '{domain} için açık sekme yok. Önce hedef siteyi açın.',
  'options.sites.testRestricted':
    'Bu sayfa test edilemez ({url}). Yayın sitesi gibi normal bir web sitesi sekmesi açın.',
  'options.sites.testNoPermission':
    '{url} için ana makine izni yok. Ana makine izinlerini güncelledikten sonra eklentiyi yeniden yükleyin.',
  'options.sites.testResult': '{count} öğe bulundu.',
  'options.sites.testNone':
    'Öğe bulunamadı. Seçici yanlış olabilir veya altyazılar kapalı olabilir.',
  'options.sites.autoFound':
    '{count} aday bulundu. En iyi eşleşme uygulandı.',
  'options.sites.autoNone':
    'Altyazı benzeri metin bulunamadı. Oyuncuda altyazıların AÇIK olduğundan emin olun.',
  'options.sites.autoNoneHint':
    'Altyazılar bir iframe veya gölge DOM içinde olabilir. Otomatik algılama ikisini de tarar.',
  'options.sites.presetApplied': '{site} için ön ayar eklendi.',
  'options.sites.autoApplied': 'Aday uygulandı.',
  'options.footer.version': 'Sürüm {version}',
  'options.footer.project': 'GitHub’da proje',

  'options.ctranslate2Setup.title': 'CTranslate2 kurulumu',
  'options.ctranslate2Setup.intro':
    'Yerel sunucu Chrome’dan ayrı çalışır. Modeli bir kez hazırlayın, sunucuyu başlatın ve bağlantıyı test edin.',
  'options.ctranslate2Setup.diagnosticFailed':
    'CTranslate2 bağlantı testi başarısız',
  'options.ctranslate2Setup.endpoint': 'Sunucu URL’si',
  'options.ctranslate2Setup.loadedModel': 'Yüklü model adı',
  'options.ctranslate2Setup.commands':
    'Kurulum komutları (Python 3.11)',
  'options.ctranslate2Setup.copyCommands': 'Komutları kopyala',
  'options.ctranslate2Setup.copied': 'Komutlar kopyalandı',
  'options.ctranslate2Setup.openDocs': 'Kurulum rehberini aç',
  'options.ctranslate2Setup.externalNote':
    'CTranslate2, Python ortamları ve indirilen modeller eklenti dışında kalır ve eklentiyle paketlenmez.',
  'options.ctranslate2Setup.loadFailed':
    'CTranslate2 sunucu ayarları yüklenemedi: {message}',
  'options.ctranslate2Setup.modelDirectory.label': 'Model dizini',
  'options.ctranslate2Setup.modelDirectory.hint':
    'Hazırlanmış model klasörünün elle girilen yolu. Boş bırakırsanız native launcher, seçili sağlayıcı modeliyle eşleşen hazır modeli kurulum models klasöründe bulur. Eski ./server/models yolları klasör adına göre çözülür. Klasörde model-metadata.json, model dosyaları ve tokenizer/ bulunmalıdır.',
  'options.ctranslate2Setup.models.label': 'Hazır modeller',
  'options.ctranslate2Setup.models.hint':
    'Native launcher tarafından kurulum models klasöründe bulunur. Bir model seçmek klasörünü ve sağlayıcı model adını ayarlar.',
  'options.ctranslate2Setup.models.placeholder': 'Hazır bir model seçin',
  'options.ctranslate2Setup.models.refresh': 'Modelleri yenile',
  'options.ctranslate2Setup.models.loadFailed':
    'Hazır modeller listelenemedi: {message}',
  'options.ctranslate2Setup.models.selectFailed':
    'Sağlayıcı modeli güncellenemedi: {message}',
  'options.ctranslate2Setup.models.hostOutdated':
    'Kurulu native launcher v{version}, ancak model listeleme v{required} gerektiriyor. scripts/install-ct2-server.bat (Windows) veya ./scripts/install-ct2-server.sh komutunu yeniden çalıştırın, sonra yenileyin / tarayıcıyı yeniden başlatın.',
  'options.ctranslate2Setup.device.label': 'Aygıt',
  'options.ctranslate2Setup.device.hint':
    'Aygıt değiştirildiğinde hesaplama türü önerilen değere sıfırlanır. Sunucu donanım desteğini başlangıçta doğrular.',
  'options.ctranslate2Setup.device.cpu': 'CPU',
  'options.ctranslate2Setup.device.cuda': 'CUDA',
  'options.ctranslate2Setup.computeType.label': 'Hesaplama türü',
  'options.ctranslate2Setup.computeType.hint':
    'CLI hesaplama türü. Sunucu seçilen donanıma göre doğrular.',
  'options.ctranslate2Setup.shell.label': 'Komut kabuğu',
  'options.ctranslate2Setup.shell.hint':
    'Yalnızca tırnaklama ve üretilen komut sözdizimini değiştirir.',
  'options.ctranslate2Setup.shell.powershell': 'PowerShell',
  'options.ctranslate2Setup.shell.bash': 'Bash',
  'options.ctranslate2Setup.advanced.title': 'Gelişmiş başlangıç',
  'options.ctranslate2Setup.advanced.hint':
    'Host, port ve günlük düzeyi yalnızca sunucu yeniden başlatılarak uygulanır.',
  'options.ctranslate2Setup.host.label': 'Ana makine',
  'options.ctranslate2Setup.port.label': 'Port',
  'options.ctranslate2Setup.logLevel.label': 'Günlük düzeyi',
  'options.ctranslate2Setup.save.saving':
    'Başlangıç ayarları kaydediliyor...',
  'options.ctranslate2Setup.save.saved':
    'Başlangıç ayarları kaydedildi',
  'options.ctranslate2Setup.save.error':
    'Başlangıç ayarları kaydedilemedi: {message}',
  'options.ctranslate2Setup.validation.modelDirectoryRequired':
    'Bir model dizini girin.',
  'options.ctranslate2Setup.validation.unsafe':
    'NUL veya satır sonu karakterlerini kaldırın.',
  'options.ctranslate2Setup.validation.portInvalid':
    'Tam sayı bir port girin.',
  'options.ctranslate2Setup.validation.portRange':
    '1 ile 65535 arasında bir port kullanın.',
  'options.ctranslate2Setup.validation.invalid':
    'Desteklenen bir değer seçin.',
  'options.ctranslate2Setup.validation.modelNameRequired':
    'Model hazırlamadan önce boş olmayan bir sağlayıcı model adı ayarlayın.',
  'options.ctranslate2Setup.commands.installTitle': '1. İlk kurulum',
  'options.ctranslate2Setup.commands.installDescription':
    'Depo kökünden Python 3.11 ile çalıştırın; sanal ortamı oluşturun ve sunucu dönüştürme bağımlılıklarını kurun.',
  'options.ctranslate2Setup.commands.repoRoot':
    'Kurulum bloğu terminalin depo kökünde olduğunu varsayar.',
  'options.ctranslate2Setup.commands.prepareTitle': '2. Modeli hazırla',
  'options.ctranslate2Setup.commands.prepareDescription':
    'Sağlayıcı modelini seçili model dizinine dönüştürür. Klasör önceden hazırlanmış meta veri ve tokenizer düzenini içermelidir.',
  'options.ctranslate2Setup.commands.prepareNoOverwrite':
    'Bu komut hiçbir zaman --overwrite eklemez.',
  'options.ctranslate2Setup.commands.startTitle': '3. Sunucuyu başlat',
  'options.ctranslate2Setup.commands.startDescription':
    'Seçili başlangıç seçenekleriyle tek bir yerel Uvicorn çalışanı başlatır.',
  'options.ctranslate2Setup.commands.startVenv':
    'Bu komutu çalıştırmadan önce sanal ortamı etkinleştirin. Herhangi bir başlangıç seçeneğini değiştirdikten sonra sunucuyu yeniden başlatın.',
  'options.ctranslate2Setup.commands.invalidSettings':
    'Bu komutu üretmek için geçersiz ayarları düzeltin.',
  'options.ctranslate2Setup.commands.selectModelFirst':
    'Bu komutu üretmek için hazır bir model dizini seçin.',
  'options.ctranslate2Setup.baseUrl.title': 'Çeviri adresi',
  'options.ctranslate2Setup.baseUrl.generated':
    'Host ve porttan üretildi',
  'options.ctranslate2Setup.baseUrl.active':
    'Etkin sağlayıcı Temel URL’si',
  'options.ctranslate2Setup.baseUrl.differs':
    'Üretilen adres etkin Temel URL’den farklı. Açıkça uygulamak için düğmeyi kullanın.',
  'options.ctranslate2Setup.baseUrl.apply':
    'Bu adresi çeviri için kullan',
  'options.ctranslate2Setup.baseUrl.applied':
    'Çeviri Temel URL’si güncellendi.',
  'options.ctranslate2Setup.baseUrl.applyFailed':
    'Çeviri Temel URL’si güncellenemedi: {message}',
  'options.ctranslate2Setup.baseUrl.test': 'Bağlantıyı test et',
  'options.ctranslate2Setup.baseUrl.testing': 'Test ediliyor...',
  'options.ctranslate2Setup.baseUrl.testTarget': 'Test hedefi: {url}',
  'options.ctranslate2Setup.baseUrl.restartRequired':
    'Başlangıç ayarları çalışan sunucuyu yeniden yapılandırmaz. Host veya port değişikliklerini uygulamak için sunucuyu yeniden başlatın.',
  'options.ctranslate2Setup.health.title': 'Çalışan sunucu',
  'options.ctranslate2Setup.health.selectedModel':
    'Seçili sağlayıcı modeli',
  'options.ctranslate2Setup.health.loadedModel':
    'Yüklü model (sunucu yanıtı)',
  'options.ctranslate2Setup.health.modelMismatchTitle':
    'Sunucu modeli uyuşmuyor',
  'options.ctranslate2Setup.health.modelDirectory':
    'Yüklü model klasör adı (sunucu yanıtı)',
  'options.ctranslate2Setup.health.device': 'Çalışan aygıt',
  'options.ctranslate2Setup.health.computeType':
    'Çalışan hesaplama türü',
  'options.ctranslate2Setup.health.family': 'Model ailesi',
  'options.ctranslate2Setup.health.languagePairs': 'Dil çiftleri',
  'options.ctranslate2Setup.health.lastChecked': 'Son kontrol',
  'options.ctranslate2Setup.health.notReported': 'Bildirilmedi',
  'options.ctranslate2Setup.health.notReportedOldServer':
    'Bu sunucu model_dir bildirmiyor (eski sağlık şeması).',
  'options.ctranslate2Setup.health.neverTested':
    'Çalışan sunucu ayarlarını okumak için Bağlantıyı test et’i çalıştırın.',
  'options.ctranslate2Setup.health.restartNeeded':
    'Yeniden başlatma gerekli',
  'options.ctranslate2Setup.health.restartDetail':
    'İstenen aygıt/hesaplama türü: {requested}. Çalışan: {reported}.',
  'options.ctranslate2Setup.native.title': 'Tek tıkla yerel sunucu',
  'options.ctranslate2Setup.native.description':
    'Yüklü native launcher ile yerel CTranslate2 sunucusunu bu başlangıç ayarlarıyla başlatır veya durdurur.',
  'options.ctranslate2Setup.native.state.checking':
    'Native launcher kontrol ediliyor...',
  'options.ctranslate2Setup.native.state.unavailable':
    'Native launcher yüklü değil',
  'options.ctranslate2Setup.native.state.stopped': 'Sunucu durduruldu',
  'options.ctranslate2Setup.native.state.running': 'Sunucu çalışıyor',
  'options.ctranslate2Setup.native.state.external_running':
    'Sunucu harici olarak çalışıyor',
  'options.ctranslate2Setup.native.state.starting':
    'Sunucu başlatılıyor...',
  'options.ctranslate2Setup.native.state.stopping':
    'Sunucu durduruluyor...',
  'options.ctranslate2Setup.native.state.error': 'Launcher hatası',
  'options.ctranslate2Setup.native.start': 'Sunucuyu başlat',
  'options.ctranslate2Setup.native.starting': 'Başlatılıyor...',
  'options.ctranslate2Setup.native.stop': 'Sunucuyu durdur',
  'options.ctranslate2Setup.native.stopping': 'Durduruluyor...',
  'options.ctranslate2Setup.native.refresh': 'Durumu yenile',
  'options.ctranslate2Setup.native.startedTesting':
    'Sunucu başlatıldı. Bağlantı test ediliyor...',
  'options.ctranslate2Setup.native.startedApply':
    'Sunucu {url} adresinde başlatıldı. Test etmeden önce bu adresi çeviri için uygulayın.',
  'options.ctranslate2Setup.native.stopped': 'Sunucu durduruldu.',
  'options.ctranslate2Setup.native.error': 'Launcher hatası: {message}',
  'options.ctranslate2Setup.native.externalHint':
    'Bu sunucu launcher dışında başlatılmış. Tanınan bir CT2 sunucu süreciyse Sunucuyu durdur onu durdurabilir; değilse kendi terminalinden durdurun.',
  'options.ctranslate2Setup.native.externalAlreadyRunning':
    'Sunucu launcher dışında zaten çalışıyor; launcher tarafından başlatılmadı veya yönetilmiyor.',
  'options.ctranslate2Setup.native.timeoutHint':
    'Sunucu hâlâ başlatılıyor olabilir. Tekrar denemeden önce Durumu yenile’ye tıklayın.',
  'options.ctranslate2Setup.native.invalidExtensionId':
    'Bu geçerli bir Chromium extension ID değil. Native messaging, a-p aralığında 32 karakterlik bir ID gerektirir.',
  'options.ctranslate2Setup.native.managedHint':
    'Native launcher tarafından başlatıldı ve yönetiliyor.',
  'options.ctranslate2Setup.native.restartNote':
    'Başlatma ve durdurma yalnızca çalışan süreci etkiler; başlangıç ayarları ayrı olarak kayıtlı kalır.',
  'options.ctranslate2Setup.native.installTitle':
    'Native launcher kurulumu (tek sefer)',
  'options.ctranslate2Setup.native.installDescription':
    'Chrome işletim sistemi süreçlerini doğrudan başlatamaz. Bu extension ID için küçük native launcher’ı bir kez kurun.',
  'options.ctranslate2Setup.native.extensionId': 'Extension ID',
  'options.ctranslate2Setup.native.copyExtensionId': 'Extension ID’yi kopyala',
  'options.ctranslate2Setup.native.installCommand': 'Kurulum komutu',
  'options.ctranslate2Setup.native.installAfter':
    'Bunu depo kökünden, sunucu sanal ortamı etkinken çalıştırın ve Durumu yenile’ye tıklayın.',
  'options.ctranslate2Setup.native.restartChrome':
    'Launcher algılanmazsa Chrome’u yeniden başlatın.',
  'options.ctranslate2Setup.oneClick.title': 'Tek tıkla kurulum',
  'options.ctranslate2Setup.oneClick.description':
    'Bu eklenti sürümünün installer betiğini GitHub’dan indirip çalıştırır. Ortamı, modelleri ve native launcher’ı %LOCALAPPDATA%\\UniversalSubtitleTranslator altında (veya platform eşdeğerinde) kurar, Chrome ile Edge’i kaydeder ve seçili model geçerliyse onu hazırlar. Çalıştırmadan önce kaynak bağlantısını inceleyin.',
  'options.ctranslate2Setup.oneClick.reviewSource':
    'Installer kaynağını inceleyin',
  'options.ctranslate2Setup.oneClick.restartHint':
    'Kurulum bitince tarayıcıyı tamamen kapatıp yeniden açın, ardından Durumu yenile’ye tıklayın.',
  'options.ctranslate2Setup.oneClick.manualToggle': 'Manuel kurulum',
  'options.ctranslate2Setup.oneClick.extensionIdMismatch':
    'Bu eklenti yerleşik manifest anahtarıyla yüklenmemiş, bu yüzden ID kurulum varsayılanından farklı. Eklentiyi bu manifestten yeniden yükleyin veya geçerli ID’yi açıkça verin.',

  'options.ollamaSetup.title': 'Ollama kurulumu',
  'options.ollamaSetup.intro':
    'Ollama yerel olarak çalışır ve doğrudan erişilir. Çalıştığından emin olun, sonra algılayın.',
  'options.ollamaSetup.detect': 'Ollama’yı algıla',
  'options.ollamaSetup.detecting': 'Algılanıyor...',
  'options.ollamaSetup.running': 'Ollama çalışıyor',
  'options.ollamaSetup.notRunning': 'Ollama’ya erişilemiyor',
  'options.ollamaSetup.connectionFailed': 'Ollama bağlantı testi başarısız',
  'options.ollamaSetup.installHint':
    'Ollama’yı https://ollama.com adresinden kurun ve terminalde ollama serve çalıştırın.',
  'options.ollamaSetup.version': 'Sürüm',
  'options.ollamaSetup.modelsTitle': 'Yüklü modeller',
  'options.ollamaSetup.noModels':
    'Henüz model yüklenmedi. Aşağıdan bir model çekin.',
  'options.ollamaSetup.useModel': 'Aktif yap',
  'options.ollamaSetup.activeModel': 'Aktif model',
  'options.ollamaSetup.modelSet': 'Aktif model {model} olarak ayarlandı.',
  'options.ollamaSetup.pullTitle': 'Model çek',
  'options.ollamaSetup.pullModelLabel': 'Çekilecek model',
  'options.ollamaSetup.pullPlaceholder': 'Model adı (örneğin, qwen2:0.5b)',
  'options.ollamaSetup.pullButton': 'Çek',
  'options.ollamaSetup.pulling': 'Çekiliyor...',
  'options.ollamaSetup.pullProgress': 'Çekiliyor: {status}',
  'options.ollamaSetup.pullDone': '{model} modeli hazır.',
  'options.ollamaSetup.pullFailed': 'Çekme başarısız: {message}',
  'options.ollamaSetup.recommendTitle': 'Çeviri için popüler modeller',
  'options.ollamaSetup.recommendHint': 'Alanı doldurmak için bir model adı seçin.',
  'options.ollamaSetup.errorConnect':
    'Ollama’ya erişilemiyor. Varsayılan URL: {url}',
  'options.ollamaSetup.errorCors':
    'Ollama isteği engelledi. Bu eklentiye izin vermek için OLLAMA_ORIGINS ayarıyla yeniden başlatın.',
  'options.ollamaSetup.corsFixTitle':
    'Bu eklentiye Ollama’da izin ver (CORS)',
  'options.ollamaSetup.corsFixHint':
    'Ollama varsayılan olarak tarayıcı eklentisi isteklerini reddeder. OLLAMA_ORIGINS ortam değişkeniyle yeniden başlatın:',
  'options.ollamaSetup.corsCmd.macos':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsCmd.linux':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsCmd.windows':
    'setx OLLAMA_ORIGINS "chrome-extension://*"',
  'options.ollamaSetup.corsPermCmd.macos':
    'OLLAMA_ORIGINS="chrome-extension://*" ollama serve',
  'options.ollamaSetup.corsPermCmd.linux': 'OLLAMA_ORIGINS="*" ollama serve',
  'options.ollamaSetup.corsPermCmd.windows': 'setx OLLAMA_ORIGINS "*"',
  'options.ollamaSetup.corsAltTitle': 'Hızlı alternatifler',
  'options.ollamaSetup.corsAltHint':
    'Ortam değişkeni işe yaramazsa:',
  'options.ollamaSetup.corsRestartHint':
    'Ortam değişkenini ayarladıktan sonra Ollama hizmetini yeniden başlatın.',
  'options.ollamaSetup.corsWindowsHint':
    'Windows’ta setx komutunu yönetici terminalinde çalıştırın, sonra yeni bir terminal açın.',
  'options.ollamaSetup.corsServiceHint':
    'Ollama bir sistem hizmeti olarak çalışıyorsa ortamını systemctl edit ollama ile düzenleyin.',
  'options.ollamaSetup.startTitle': 'Ollama’yı başlat',
  'options.ollamaSetup.startHint':
    'Ollama çalışmıyor. Chrome eklentileri sistem süreçlerini başlatamaz. Aşağıdaki komutu terminalde çalıştırın veya Ollama uygulamasını açın.',
  'options.ollamaSetup.setupCommands': 'Kurulum komutları',
  'options.ollamaSetup.copyCommand': 'Komutu kopyala',
  'options.ollamaSetup.copied': 'Panoya kopyalandı',
  'options.ollamaSetup.openDownload': 'Ollama’yı indir',
  'options.ollamaSetup.openDocs': 'Kurulum rehberi',
  'options.ollamaSetup.openApp': 'Ollama uygulamasını aç',
  'options.ollamaSetup.cmd.macos': 'ollama serve',
  'options.ollamaSetup.cmd.linux': 'ollama serve',
  'options.ollamaSetup.cmd.windows': 'ollama serve',
  'options.ollamaSetup.useDirect': 'Doğrudan bağlantı',
  'options.ollamaSetup.useDirectHint':
    'Eklenti Ollama’ya http://localhost üzerinden bağlanır. HTTPS proxy gerekmez.',

  'popup.brand': 'Universal Subtitle Translator',
  'popup.openSettings': 'Ayarları aç',
  'popup.status.never': 'Test edilmedi',
  'popup.status.tooltip': 'Bağlantı ayarlarını aç',
  'popup.translationEnabled': 'Çeviri etkin',
  'popup.translationEnabledHint':
    'Desteklenen sitelerde altyazı çevirisini açın veya kapatın.',
  'popup.label.showOriginal': 'Orijinal altyazıyı göster',
  'popup.hint.showOriginal':
    'Yalnızca eklentinin gösterdiği orijinal satırı gizler; çeviri etkilenmez.',
  'popup.appearance.title': 'Görünüm',
  'popup.group.background': 'Arka plan',
  'popup.group.original': 'Orijinal altyazılar',
  'popup.group.translation': 'Çeviri',
  'popup.label.bgColor': 'Arka plan rengi',
  'popup.label.bgOpacity': 'Arka plan saydamlığı',
  'popup.label.originSize': 'Yazı boyutu',
  'popup.label.originColor': 'Metin rengi',
  'popup.label.originWeight': 'Yazı kalınlığı',
  'popup.label.translatedSize': 'Yazı boyutu',
  'popup.label.translatedColor': 'Metin rengi',
  'popup.label.translatedWeight': 'Yazı kalınlığı',
  'popup.value.px': '{value} px',
  'popup.value.percent': '%{value}',
  'popup.color.choose': 'Renk seç',
  'popup.color.custom': 'Özel renk',
  'popup.color.transparent': 'Saydam',
  'popup.weight.normal': 'Normal',
  'popup.weight.bold': 'Kalın',
  'popup.autosave': 'Değişiklikler otomatik kaydedilir.',
  'popup.saveError': 'Kaydedilemedi: {message}',
  'popup.loadError': 'Ayarlar yüklenemedi: {message}',
  'popup.reset.button': 'Görünümü sıfırla',
  'popup.reset.confirm':
    'Altyazı görünümü varsayılana sıfırlansın mı? Çevirinin açık/kapalı durumu değişmez.',
  'popup.reset.ok': 'Sıfırla',
  'popup.reset.cancel': 'İptal',
  'popup.switch.on': 'Açık',
  'popup.switch.off': 'Kapalı',

  'panel.title': 'Geliştirici Paneli',
  'panel.waiting': 'bekleniyor...',

  'options.autoDetection.title': 'Otomatik Altyazı Algılama',
  'options.autoDetection.description':
    'Eklentiyi açıp video izleyin. Eklenti etkin altyazı kaynağını kendisi bulur; site ekleme, CSS seçicisi yazma veya aday seçme gerekmez.',
  'options.autoDetection.source': 'Kaynak',
  'options.autoDetection.score': 'Güven',
  'options.autoDetection.diagnostics': 'Tanılama',
  'options.autoDetection.diagnosticsHint':
    'Salt okunur ayrıntılar. Algılama burada farklı bir kaynağa zorlanamaz.',
  'options.autoDetection.legacyNote':
    'Eski site seçici kayıtları yalnızca başvuru için depoda tutulur; kaynağı zorlamaz.',
  'detection.phase.disabled': 'Çeviri kapalı',
  'detection.phase.searching': 'Video aranıyor',
  'detection.phase.verifying': 'Altyazı kaynağı doğrulanıyor',
  'detection.phase.connected': 'Altyazıya bağlandı',
  'detection.phase.waiting': 'Yeni altyazı satırı bekleniyor',
  'detection.phase.suspended': 'Sayfa gizliyken duraklatıldı',
  'detection.phase.unavailable':
    'Okunabilir altyazı bulunamadı; altyazı kapalı olabilir',
  'detection.source.text-track': 'Yerel metin kanalı',
  'detection.source.player-dom': 'Doğrulanmış oynatıcı altyazısı',
  'detection.source.generic-dom': 'Ekrandaki altyazı',
  'detection.reason.connected': 'Etkin altyazı kaynağı çevriliyor.',
  'detection.reason.videoNotFound': 'Bu sayfada henüz görünür video yok.',
  'detection.reason.videoOffscreen': 'Video görünür alanın dışında.',
  'detection.reason.frameUnknown':
    'Üst frame görünürlüğü doğrulaması bekleniyor.',
  'detection.reason.subtitleNotFound': 'Henüz altyazı benzeri metin bulunamadı.',
  'detection.reason.noReadable':
    'Video oynarken kaynak doğrulanamadı. Altyazı kapalı olabilir.',
  'detection.reason.lowConfidence':
    'Bir aday bulundu ancak güven puanı hâlâ düşük.',
  'detection.reason.ambiguous':
    'İki bağımsız aday güvenle seçilemeyecek kadar yakın.',
  'detection.reason.insufficient':
    'Çeviriden önce daha fazla altyazı değişimi gözleniyor.',
  'detection.reason.waitingText': 'Aday var ancak şu an metni yok.',
  'detection.reason.waitingLine': 'Bağlandı; yeni satır bekleniyor.',
  'detection.reason.awaitingGrant': 'Kaynak doğrulandı; sekme yetkisi bekleniyor.',
  'detection.reason.sourceLost': 'Önceki kaynak kayboldu; yeniden aranıyor.',
  'detection.reason.pageHidden': 'Sekme gizliyken algılama duraklatıldı.',
  'detection.reason.extensionDisabled': 'Çeviri popup üzerinden kapatılmış.',
  'detection.reason.noFrame': 'Bu sekmeden henüz content script bildirmedi.',
  'detection.reason.switching': 'Daha iyi bir altyazı kaynağına geçiliyor.',
  'detection.reason.disabled': 'Algılama kapalı.',
  'popup.detection.title': 'Altyazı algılama',
  'popup.detection.source': 'Kaynak',
}

export const dictionaries: Record<Lang, Dict> = { en, tr }

export function detectLang(): Lang {
  const browser = (navigator.language || 'en').toLowerCase()
  if (browser.startsWith('tr')) return 'tr'
  if (browser.startsWith('zh')) return 'en'
  return 'en'
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'tr'
}

export async function getStoredLang(): Promise<Lang> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['language'], (r) => {
      if (chrome.runtime.lastError) {
        resolve(detectLang())
        return
      }
      resolve(isLang(r?.language) ? r.language : detectLang())
    })
  })
}

export function setStoredLang(lang: Lang): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ language: lang }, () => {
      chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()
    })
  })
}

export function interpolate(template: string, vars: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  )
}

export function makeT(lang: Lang) {
  const dict = dictionaries[lang] ?? dictionaries.en
  return (key: string | undefined, vars?: Record<string, string>): string => {
    if (!key) return ''
    const tmpl = dict[key] ?? dictionaries.en[key] ?? key
    return vars ? interpolate(tmpl, vars) : tmpl
  }
}
