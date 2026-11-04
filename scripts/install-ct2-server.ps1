$DefaultRef = 'v3.8.0'
$Ct2ScriptRoot = $PSScriptRoot

# Bootstrap: no param() block, so this file works both from disk and through
# `irm <url> | iex`. Arguments are parsed manually and passed to the function.
$ErrorActionPreference = 'Stop'

function Write-Usage {
    @"
Usage: scripts/install-ct2-server.ps1 [options]

Creates a repository-independent installation under
%LOCALAPPDATA%\UniversalSubtitleTranslator (venv\, models\, native-host\).

Options:
  -Model <id>          Prepare this Hugging Face model without prompting.
  -SkipModel           Do not ask about or prepare a model.
  -Browser <target>    chrome, edge or all (default: all).
  -Force               Rebuild the native host executable.
  -Repair              Reinstall every step even when it looks complete.
  -OverwriteModel      Replace an existing prepared model directory.
  -InstallRoot <dir>   Override the installation root.
  -ModelsFrom <dir>    Copy prepared models from this folder.
  -Source <dir>        Use a local repository or server folder.
  -Ref <ref>           Git tag or branch for the remote source (default: $DefaultRef).
  -Help                Show this help.

Remote usage:
  irm https://raw.githubusercontent.com/realyasster/translator/$DefaultRef/scripts/install-ct2-server.ps1 | iex
  & ([scriptblock]::Create((irm <same-url>))) -Model facebook/nllb-200-distilled-600M
"@ | Write-Host
}

function Convert-Ct2Arguments {
    param([object[]]$Values)
    $parameters = @{}
    $index = 0
    while ($index -lt $Values.Count) {
        $name = ([string]$Values[$index]).TrimStart('-').ToLowerInvariant()
        switch ($name) {
            'model' {
                if ($index + 1 -ge $Values.Count) { throw '-Model requires a value.' }
                $parameters.Model = [string]$Values[$index + 1]
                $index += 2
            }
            'browser' {
                if ($index + 1 -ge $Values.Count) { throw '-Browser requires a value.' }
                $parameters.Browser = [string]$Values[$index + 1]
                $index += 2
            }
            'installroot' {
                if ($index + 1 -ge $Values.Count) { throw '-InstallRoot requires a value.' }
                $parameters.InstallRoot = [string]$Values[$index + 1]
                $index += 2
            }
            'modelsfrom' {
                if ($index + 1 -ge $Values.Count) { throw '-ModelsFrom requires a value.' }
                $parameters.ModelsFrom = [string]$Values[$index + 1]
                $index += 2
            }
            'source' {
                if ($index + 1 -ge $Values.Count) { throw '-Source requires a value.' }
                $parameters.Source = [string]$Values[$index + 1]
                $index += 2
            }
            'ref' {
                if ($index + 1 -ge $Values.Count) { throw '-Ref requires a value.' }
                $parameters.Ref = [string]$Values[$index + 1]
                $index += 2
            }
            'skipmodel' { $parameters.SkipModel = $true; $index++ }
            'force' { $parameters.Force = $true; $index++ }
            'repair' { $parameters.Repair = $true; $index++ }
            'overwritemodel' { $parameters.OverwriteModel = $true; $index++ }
            'help' { $parameters.Help = $true; $index++ }
            'h' { $parameters.Help = $true; $index++ }
            default { throw "Unknown argument: $($Values[$index])" }
        }
    }
    return $parameters
}

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host "==> $Text" -ForegroundColor Cyan
}

function Get-PythonLauncher {
    $candidates = @(
        @{ Exe = 'py'; Arguments = @('-3.11') },
        @{ Exe = 'python'; Arguments = @() },
        @{ Exe = 'python3.11'; Arguments = @() }
    )
    foreach ($candidate in $candidates) {
        if (-not (Get-Command $candidate.Exe -ErrorAction SilentlyContinue)) {
            continue
        }
        try {
            $output = & $candidate.Exe @($candidate.Arguments + @('--version')) 2>&1
        } catch {
            continue
        }
        if ($LASTEXITCODE -ne 0) { continue }
        $text = ($output | Out-String).Trim()
        if ($text -match 'Python\s+(\d+)\.(\d+)') {
            $major = [int]$Matches[1]
            $minor = [int]$Matches[2]
            if ($major -gt 3 -or ($major -eq 3 -and $minor -ge 11)) {
                return $candidate
            }
        }
    }
    throw @'
Python 3.11 or newer was not found.
Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"),
then run this script again.
'@
}

function Assert-Python311([string]$Executable) {
    $output = & $Executable --version 2>&1
    $text = ($output | Out-String).Trim()
    if ($text -notmatch 'Python\s+(\d+)\.(\d+)') {
        throw "Could not read the Python version from '$Executable'."
    }
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 11)) {
        throw "The existing venv uses $text. Remove '$script:VenvRoot' and run this script again with Python 3.11+."
    }
}

function Get-PreparedModels([string]$ModelsPath) {
    $output = & $script:VenvPython -m ct2_nllb_server list-models --json --models-root $ModelsPath
    if ($LASTEXITCODE -ne 0) {
        return @()
    }
    try {
        $payload = ($output -join "`n") | ConvertFrom-Json
        return @($payload.models)
    } catch {
        return @()
    }
}

function Get-Ct2SourceFingerprint([string]$ServerPath) {
    $entries = New-Object System.Collections.Generic.List[string]
    $targets = @(
        (Join-Path $ServerPath 'src'),
        (Join-Path $ServerPath 'pyproject.toml'),
        (Join-Path $ServerPath 'native_host_entry.py')
    )
    foreach ($target in $targets) {
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            $name = [System.IO.Path]::GetFileName($target)
            $entries.Add("$name|$((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)")
            continue
        }
        if (-not (Test-Path -LiteralPath $target)) { continue }
        $files = @(Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in @('.py', '.pyi') } |
            Sort-Object FullName)
        foreach ($file in $files) {
            if ($file.FullName -match '[\\/]__pycache__[\\/]') { continue }
            $relative = $file.FullName.Substring($ServerPath.Length).TrimStart('\', '/')
            $entries.Add("$relative|$((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash)")
        }
    }
    $text = ($entries | Sort-Object) -join "`n"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $digest = ([System.BitConverter]::ToString(
        $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))
    ) -replace '-', '').ToLowerInvariant()
    return 'local-' + $digest.Substring(0, 12)
}

function Get-Ct2Doctor {
    if (-not (Test-Path $script:VenvPython)) { return $null }
    $output = & $script:VenvPython -m ct2_nllb_server doctor --json --install-root $script:InstallRoot
    if ($LASTEXITCODE -ne 0) { return $null }
    try {
        return ($output -join "`n") | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Test-Ct2Model([string]$ModelId) {
    $output = & $script:VenvPython -m ct2_nllb_server check-model $ModelId --json
    $exitCode = $LASTEXITCODE
    $payload = $null
    try {
        $payload = ($output -join "`n") | ConvertFrom-Json
    } catch {
        $payload = $null
    }
    if (-not $payload) {
        return [pscustomobject]@{
            Ok = $false
            Message = "Model doğrulanamadı (çıkış kodu $exitCode)."
            Suggestions = @()
        }
    }
    $suggestions = @()
    if ($payload.suggestions) { $suggestions = @($payload.suggestions) }
    return [pscustomobject]@{
        Ok = [bool]$payload.ok
        Message = [string]$payload.message
        Suggestions = $suggestions
    }
}

function Invoke-ModelPreparation([string]$ModelId, [bool]$InteractiveStep) {
    $segment = ($ModelId -split '/')[-1]
    $existing = Join-Path $script:ModelsRoot $segment
    if ((Test-Path (Join-Path $existing 'model-metadata.json')) -and -not $script:OverwriteModel) {
        Write-Host "Model already prepared, skipping: $existing"
        return $true
    }
    while ($true) {
        $check = Test-Ct2Model $ModelId
        if (-not $check.Ok) {
            Write-Host $check.Message -ForegroundColor Yellow
            if ($check.Suggestions.Count -gt 0) {
                Write-Host ("Şunu mu demek istediniz: " + ($check.Suggestions -join ', '))
            }
            if (-not $InteractiveStep) { return $false }
            $choice = Read-Host '[D] Başka model gir  [S] Atla (Enter)'
            if ($choice -match '^[Dd]$') {
                $next = Read-Host 'Hugging Face model id (boş = menüye dön)'
                if ([string]::IsNullOrWhiteSpace($next)) { return $false }
                $ModelId = $next
                continue
            }
            return $false
        }
        try {
            $directory = Invoke-PrepareModel $ModelId
            Write-Host "Hazır: $directory"
            return $true
        } catch {
            Write-Host "Model hazırlanamadı: $($_.Exception.Message)" -ForegroundColor Yellow
            if (-not $InteractiveStep) { return $false }
            $choice = Read-Host '[T] Tekrar dene  [D] Başka model gir  [S] Atla (Enter)'
            if ($choice -match '^[Tt]$') { continue }
            if ($choice -match '^[Dd]$') {
                $next = Read-Host 'Hugging Face model id (boş = menüye dön)'
                if ([string]::IsNullOrWhiteSpace($next)) { return $false }
                $ModelId = $next
                continue
            }
            return $false
        }
    }
}

function Invoke-PrepareModel([string]$ModelId) {
    $segment = ($ModelId -split '/')[-1]
    $directory = Join-Path $script:ModelsRoot $segment
    $metadata = Join-Path $directory 'model-metadata.json'
    if ((Test-Path $metadata) -and -not $script:OverwriteModel) {
        Write-Host "Model already prepared, skipping: $directory"
        return $directory
    }
    Write-Step "Preparing model: $ModelId"
    $arguments = @(
        'prepare-model',
        '--model', $ModelId,
        '--family', 'auto',
        '--output', $directory
    )
    if ($script:OverwriteModel) { $arguments += '--overwrite' }
    & $script:VenvPython -m ct2_nllb_server @arguments | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Model preparation failed (exit code $LASTEXITCODE)."
    }
    return $directory
}

function Select-SearchResult {
    $query = Read-Host 'Hugging Face arama sözcüğü (boş = menüye dön)'
    if ([string]::IsNullOrWhiteSpace($query)) { return $null }
    $output = & $script:VenvPython -m ct2_nllb_server search-models $query --json
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Arama başarısız oldu.' -ForegroundColor Yellow
        return $null
    }
    try {
        $results = @((($output -join "`n") | ConvertFrom-Json))
    } catch {
        Write-Host 'Arama sonucu okunamadı.' -ForegroundColor Yellow
        return $null
    }
    if ($results.Count -eq 0) {
        Write-Host 'Desteklenen çeviri modeli bulunamadı.' -ForegroundColor Yellow
        return $null
    }
    $index = 0
    foreach ($result in $results) {
        $index++
        Write-Host (" [{0}] {1}  ({2})" -f $index, $result.id, $result.family)
    }
    $choice = Read-Host 'Numara seç (boş = menüye dön)'
    if ([string]::IsNullOrWhiteSpace($choice) -or $choice -notmatch '^\d+$') {
        return $null
    }
    $selected = [int]$choice
    if ($selected -lt 1 -or $selected -gt $results.Count) {
        Write-Host 'Geçersiz seçim.' -ForegroundColor Yellow
        return $null
    }
    return $results[$selected - 1].id
}

function Read-ModelSelection {
    $prepared = @(Get-PreparedModels $script:ModelsRoot)
    while ($true) {
        Write-Host ''
        Write-Host 'Model hazırlığı:'
        $index = 0
        foreach ($item in $prepared) {
            $index++
            $state = if ($item.valid) { 'hazır' } else { $item.problem }
            Write-Host ("  [{0}] {1}  ({2}, {3})" -f $index, $item.name, $item.family, $state)
        }
        Write-Host '  [D] Yeni model indir (HF model id gir)'
        Write-Host '  [A] Hugging Face''te çeviri modeli ara'
        Write-Host '  [S] Atla (varsayılan, Enter)'
        $choice = Read-Host 'Seçim'
        if ([string]::IsNullOrWhiteSpace($choice) -or $choice -match '^[Ss]$') {
            return $null
        }
        if ($choice -match '^\d+$') {
            $selected = [int]$choice
            if ($selected -ge 1 -and $selected -le $prepared.Count) {
                $item = $prepared[$selected - 1]
                if (-not $item.valid) {
                    Write-Host "Bu klasör kullanılamıyor: $($item.problem)" -ForegroundColor Yellow
                    continue
                }
                Write-Host "Seçili model: $($item.model_id)"
                Write-Host "Dizin: $($item.directory)"
                return $item.model_id
            }
            Write-Host 'Geçersiz seçim.' -ForegroundColor Yellow
            continue
        }
        if ($choice -match '^[Dd]$') {
            $modelId = Read-Host 'Hugging Face model id (boş = menüye dön)'
            if ([string]::IsNullOrWhiteSpace($modelId)) { continue }
            if (Invoke-ModelPreparation -ModelId $modelId -InteractiveStep $true) {
                Write-Host "Seçili model: $modelId"
                return $modelId
            }
            continue
        }
        if ($choice -match '^[Aa]$') {
            $modelId = Select-SearchResult
            if (-not $modelId) { continue }
            if (Invoke-ModelPreparation -ModelId $modelId -InteractiveStep $true) {
                Write-Host "Seçili model: $modelId"
                return $modelId
            }
            continue
        }
        Write-Host 'Geçersiz seçim.' -ForegroundColor Yellow
    }
}

function Get-Ct2ArchiveUrl([string]$RefValue) {
    if ($RefValue -match '^v\d') {
        return "https://github.com/realyasster/translator/archive/refs/tags/$RefValue.zip"
    }
    return "https://github.com/realyasster/translator/archive/refs/heads/$RefValue.zip"
}

function Get-Ct2Archive([string]$RefValue, [string]$Destination) {
    $references = @($RefValue)
    if ($RefValue -ne 'main') { $references += 'main' }
    foreach ($reference in $references) {
        $url = Get-Ct2ArchiveUrl $reference
        $archive = Join-Path $Destination ("translator-" + ($reference -replace '[^A-Za-z0-9._-]', '_') + '.zip')
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Write-Host "Downloading $url"
                $null = Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing
                return $archive
            } catch {
                if ($attempt -eq 3) { break }
                Start-Sleep -Seconds 2
            }
        }
        if ($reference -ne 'main') {
            Write-Warning "Tag '$reference' could not be downloaded; falling back to main."
        }
    }
    throw "Could not download the installer source archive."
}

function Resolve-Ct2ServerSource {
    param(
        [string]$Source,
        [string]$RefValue,
        [string]$ScriptRoot
    )
    if ($Source) {
        $sourcePath = (Resolve-Path $Source).Path
        if (Test-Path (Join-Path $sourcePath 'server')) {
            return [pscustomobject]@{
                RepoRoot = $sourcePath
                ServerPath = Join-Path $sourcePath 'server'
                TempRoot = $null
            }
        }
        if (Test-Path (Join-Path $sourcePath 'src\ct2_nllb_server')) {
            return [pscustomobject]@{
                RepoRoot = Split-Path $sourcePath -Parent
                ServerPath = $sourcePath
                TempRoot = $null
            }
        }
        throw "-Source must point to a repository root or its server folder: $sourcePath"
    }
    if ($ScriptRoot) {
        $repo = Resolve-Path (Join-Path $ScriptRoot '..') -ErrorAction SilentlyContinue
        if ($repo -and (Test-Path (Join-Path $repo 'server'))) {
            return [pscustomobject]@{
                RepoRoot = $repo.Path
                ServerPath = Join-Path $repo.Path 'server'
                TempRoot = $null
            }
        }
    }
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ust-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
    try {
        $reference = if ($RefValue) { $RefValue } else { $DefaultRef }
        $archive = Get-Ct2Archive -RefValue $reference -Destination $tempRoot
        Expand-Archive -Path $archive -DestinationPath $tempRoot -Force
        $extracted = Get-ChildItem -Path $tempRoot -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName 'server') } |
            Select-Object -First 1
        if (-not $extracted) {
            throw "The downloaded archive does not contain a server folder."
        }
        return [pscustomobject]@{
            RepoRoot = $extracted.FullName
            ServerPath = Join-Path $extracted.FullName 'server'
            TempRoot = $tempRoot
        }
    } catch {
        Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
        throw
    }
}

function Invoke-Ct2Installer {
    [CmdletBinding()]
    param(
        [string]$Model,
        [switch]$SkipModel,
        [ValidateSet('chrome', 'edge', 'all')]
        [string]$Browser = 'all',
        [switch]$Force,
        [switch]$Repair,
        [switch]$OverwriteModel,
        [string]$InstallRoot,
        [string]$ModelsFrom,
        [string]$Source,
        [string]$Ref
    )

    $ErrorActionPreference = 'Stop'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    } catch {
        # Older hosts may not support changing the protocol; Invoke-WebRequest
        # then uses the host default.
    }
    $ProgressPreference = 'SilentlyContinue'

    $originalLocation = Get-Location
    $location = Resolve-Ct2ServerSource -Source $Source -RefValue $Ref -ScriptRoot $Ct2ScriptRoot
    $tempRoot = $location.TempRoot
    try {
        $repoRoot = $location.RepoRoot
        $serverPath = $location.ServerPath
        Set-Location $repoRoot

        if ($InstallRoot) {
            $installRoot = [System.IO.Path]::GetFullPath($InstallRoot)
        } else {
            $installRoot = Join-Path $env:LOCALAPPDATA 'UniversalSubtitleTranslator'
        }
        $script:VenvRoot = Join-Path $installRoot 'venv'
        $script:VenvPython = Join-Path $script:VenvRoot 'Scripts\python.exe'
        $script:ModelsRoot = Join-Path $installRoot 'models'
        $script:OverwriteModel = [bool]$OverwriteModel
        New-Item -ItemType Directory -Force -Path $installRoot, $script:ModelsRoot | Out-Null

        Write-Step "Install root: $installRoot"
        Write-Step "Server source: $serverPath"
        $python = Get-PythonLauncher
        Write-Host ("Python launcher: {0} {1}" -f $python.Exe, ($python.Arguments -join ' '))

        if (-not (Test-Path $script:VenvPython)) {
            Write-Step 'Creating the Python virtual environment'
            & $python.Exe @($python.Arguments + @('-m', 'venv', $script:VenvRoot))
            if ($LASTEXITCODE -ne 0) {
                throw "Could not create the venv (exit code $LASTEXITCODE)."
            }
        } else {
            Write-Host "Using the existing virtual environment: $script:VenvPython"
        }
        Assert-Python311 $script:VenvPython

        $script:InstallRoot = $installRoot
        $interactiveSession = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
        # The ref identifies the installed source. Without an explicit -Ref,
        # the content fingerprint changes whenever the checkout (or the
        # downloaded release) changes, so a repeated run only skips when the
        # installed server really is current.
        $desiredRef = if ($Ref) { $Ref } else { Get-Ct2SourceFingerprint $serverPath }
        $repairAll = [bool]$Force -or [bool]$Repair

        $doctor = $null
        if (-not $repairAll) { $doctor = Get-Ct2Doctor }

        $serverReady = $false
        if ($doctor -and $doctor.serverVersion -and $doctor.installState) {
            $serverReady = [string]$doctor.installState.ref -eq $desiredRef
        }
        if ($serverReady) {
            Write-Host '[ok] Sunucu zaten kurulu (atlandı)' -ForegroundColor Green
        } else {
            Write-Step 'Installing server dependencies (convert + native extras)'
            & $script:VenvPython -m pip install --upgrade pip
            if ($LASTEXITCODE -ne 0) {
                throw "pip upgrade failed (exit code $LASTEXITCODE)."
            }
            & $script:VenvPython -m pip install --upgrade "$serverPath[convert,native]"
            if ($LASTEXITCODE -ne 0) {
                throw "Dependency installation failed (exit code $LASTEXITCODE)."
            }
            # The freshly installed package may know a newer host version.
            $doctor = Get-Ct2Doctor
        }

        $targetBrowsers = if ($Browser -eq 'all') { @('chrome', 'edge') } else { @($Browser) }
        $hostReady = $false
        if ($doctor -and $doctor.host.upToDate) {
            $hostReady = $true
            foreach ($target in $targetBrowsers) {
                if (-not $doctor.browsers.$target) { $hostReady = $false }
            }
        }
        if ($hostReady -and -not $repairAll) {
            Write-Host '[ok] Native launcher güncel (atlandı)' -ForegroundColor Green
        } else {
            Write-Step "Registering the native launcher (browser: $Browser)"
            $hostArguments = @(
                'install-native-host',
                '--browser', $Browser,
                '--repo-root', $repoRoot,
                '--force-if-outdated'
            )
            if ($Force) { $hostArguments += '--force' }
            $hostExe = Join-Path $script:VenvRoot 'Scripts\ct2-nllb-server.exe'
            if (Test-Path $hostExe) {
                & $hostExe @hostArguments
            } else {
                & $script:VenvPython -m ct2_nllb_server @hostArguments
            }
            if ($LASTEXITCODE -ne 0) {
                throw "Native launcher registration failed (exit code $LASTEXITCODE)."
            }
        }

        & $script:VenvPython -m ct2_nllb_server record-install --ref $desiredRef --install-root $installRoot | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning 'Could not record the install state; the next run may repeat setup steps.'
        }

        $sourceModels = if ($ModelsFrom) {
            [System.IO.Path]::GetFullPath($ModelsFrom)
        } else {
            Join-Path $repoRoot 'server\models'
        }
        if ((Test-Path $sourceModels) -and ($sourceModels -ne $script:ModelsRoot)) {
            $oldModels = @(Get-PreparedModels $sourceModels | Where-Object { $_.valid })
            if ($oldModels.Count -gt 0) {
                $copy = 'E'
                if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
                    $copy = Read-Host ("{0} içinde {1} hazır model bulundu. Kuruluma kopyalansın mı? [E/h]" -f $sourceModels, $oldModels.Count)
                }
                if ($copy -notmatch '^[HhNn]$') {
                    foreach ($item in $oldModels) {
                        $target = Join-Path $script:ModelsRoot $item.name
                        if (-not (Test-Path $target)) {
                            Write-Host "Copying model: $($item.name)"
                            Copy-Item -Path $item.directory -Destination $target -Recurse
                        }
                    }
                }
            }
        }

        $selectedModelId = $null
        $modelStepFailed = $false
        if ($Model) {
            if (Invoke-ModelPreparation -ModelId $Model -InteractiveStep $interactiveSession) {
                $selectedModelId = $Model
            } else {
                $modelStepFailed = $true
            }
        } elseif ($SkipModel) {
            Write-Host 'Model adımı atlandı (-SkipModel).'
        } elseif ($interactiveSession) {
            $selectedModelId = Read-ModelSelection
            if (-not $selectedModelId) {
                Write-Host 'Model adımı atlandı.'
            }
        } else {
            Write-Host 'Etkileşimli olmayan oturum: model adımı atlandı.'
        }

        Write-Step 'Installation complete'
        Write-Host "Install root:     $installRoot"
        Write-Host "Virtual env:      $script:VenvRoot"
        Write-Host "Models:           $script:ModelsRoot"
        Write-Host "Native host:      $(Join-Path $installRoot 'native-host')"
        if ($selectedModelId) {
            Write-Host "Selected model:   $selectedModelId"
            Write-Host ("In Options -> CTranslate2, select the model name '{0}'." -f $selectedModelId)
        }
        if ($modelStepFailed -and $interactiveSession) {
            Write-Host 'Model hazırlanamadı; daha sonra bu scripti tekrar çalıştırın veya karttan seçin.' -ForegroundColor Yellow
        }
        Write-Host ''
        Write-Host 'Next steps:'
        Write-Host '  1. Close Chrome/Edge completely (all windows, including background apps).'
        Write-Host '  2. Reopen the browser and reload the extension once.'
        Write-Host '  3. Open extension Options -> CTranslate2 -> Start server.'
    } finally {
        Set-Location $originalLocation
        if ($tempRoot -and (Test-Path $tempRoot)) {
            Remove-Item -Recurse -Force $tempRoot -ErrorAction SilentlyContinue
        }
    }
    if ($modelStepFailed -and -not $interactiveSession) {
        # `exit` would close the caller's PowerShell window when this file runs
        # through `irm ... | iex`; only a file execution may return an exit code.
        if ($Ct2ScriptRoot) {
            exit 1
        }
        $global:LASTEXITCODE = 1
        Write-Error 'Model hazırlanamadı; kurulum tamamlandı (çıkış kodu 1).' -ErrorAction Stop
    }
}

if ($env:CT2_INSTALL_LIB_ONLY -eq '1') { return }

$Ct2Parameters = Convert-Ct2Arguments -Values @($args)
if ($Ct2Parameters.ContainsKey('Help')) {
    Write-Usage
} else {
    Invoke-Ct2Installer @Ct2Parameters
}
