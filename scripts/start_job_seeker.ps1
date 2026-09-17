param(
    [ValidateSet("all", "boss", "zhaopin", "job51")]
    [string]$Platform = "all",
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
try {
    chcp 65001 | Out-Null
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    $OutputEncoding = [Text.Encoding]::UTF8
} catch {
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BossUrl = "https://www.zhipin.com/web/geek/jobs"
$ZhaopinDefaultUrl = "https://www.zhaopin.com/recommend"
$Job51DefaultUrl = "https://we.51job.com/pc/search"
$OpenCooldownSeconds = 60

function Write-Info {
    param([string]$Message)
    Write-Host "[Job Seeker] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[Job Seeker] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "[Job Seeker] $Message" -ForegroundColor Red
}

function Pause-And-Exit {
    param([int]$Code)
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit $Code
}

function Get-ConfigValue {
    param(
        [object]$Config,
        [string]$Name,
        [object]$Default
    )
    if ($null -eq $Config) {
        return $Default
    }
    $property = $Config.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value -or "$($property.Value)" -eq "") {
        return $Default
    }
    return $property.Value
}

function Test-TcpPort {
    param([int]$Port)
    $client = New-Object Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Test-JobSeekerHealth {
    param([int]$Port)
    try {
        $result = Invoke-RestMethod -Uri "http://127.0.0.1:${Port}/health" -Method Get -TimeoutSec 2
        return [bool]$result.ok
    } catch {
        return $false
    }
}

function Test-OllamaAvailable {
    param([string]$HostUrl)
    $ollamaTagsUrl = $HostUrl.TrimEnd("/") + "/api/tags"
    try {
        Invoke-RestMethod -Uri $ollamaTagsUrl -Method Get -TimeoutSec 2 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-OpenCooldown {
    param([string]$Name)
    $cacheDir = Join-Path $ProjectRoot "data\cache"
    $stampPath = Join-Path $cacheDir "browser_open_$Name.stamp"
    try {
        if (-not (Test-Path -LiteralPath $cacheDir)) {
            New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
        }
        if (Test-Path -LiteralPath $stampPath) {
            $age = (Get-Date) - (Get-Item -LiteralPath $stampPath).LastWriteTime
            if ($age.TotalSeconds -lt $OpenCooldownSeconds) {
                return $false
            }
        }
        Set-Content -LiteralPath $stampPath -Value ([DateTimeOffset]::Now.ToUnixTimeSeconds()) -Encoding UTF8
    } catch {
        return $true
    }
    return $true
}

function Test-ConfigFlag {
    param(
        [object]$Value,
        [bool]$Default
    )
    if ($null -eq $Value) {
        return $Default
    }
    if ($Value -is [bool]) {
        return $Value
    }
    $text = "$Value".Trim().ToLower()
    if ($text -eq "") {
        return $Default
    }
    return $text -in @("true", "1", "yes", "on")
}

function Get-PlatformUrl {
    param(
        [string]$Name,
        [object]$Config
    )
    if ($Name -eq "boss") {
        return $BossUrl
    }
    $configured = Get-ConfigValue $Config "${Name}_job_urls" $null
    if ($configured) {
        $first = [string](@($configured)[0])
        if ($first) {
            return $first
        }
    }
    if ($Name -eq "zhaopin") {
        return $ZhaopinDefaultUrl
    }
    if ($Name -eq "job51") {
        return $Job51DefaultUrl
    }
    return $null
}

function Open-StartupPages {
    param(
        [int]$Port,
        [string]$SelectedPlatform
    )
    $targets = @($SelectedPlatform)
    if ($SelectedPlatform -eq "all") {
        $targets = @($script:enabledPlatforms)
    }
    if ($targets.Count -eq 0) {
        Write-Warn "No platform is enabled in data\config.json; no jobs page was opened."
        return
    }
    foreach ($target in $targets) {
        $url = Get-PlatformUrl $target $script:config
        if (-not $url) {
            continue
        }
        if (-not (Test-OpenCooldown "${target}_search")) {
            Write-Warn "$target jobs page was opened recently; skipping duplicate open."
            continue
        }
        Write-Info "Opening $target jobs page: $url"
        Start-Process $url | Out-Null
    }
}

Set-Location $ProjectRoot
Write-Info "Project root: $ProjectRoot"

$requirementsPath = Join-Path $ProjectRoot "requirements.txt"
if (-not (Test-Path -LiteralPath $requirementsPath)) {
    Write-Fail "requirements.txt was not found. Please run this launcher from the Job Seeker project root."
    Pause-And-Exit 1
}

$venvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonExe = $venvPython
    Write-Info "Using virtualenv Python: $pythonExe"
} else {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $pythonCommand) {
        Write-Fail "Python was not found. Install Python 3.10+ and then run: python -m venv .venv"
        Pause-And-Exit 1
    }
    $pythonExe = $pythonCommand.Source
    Write-Warn ".venv was not found. Using system Python: $pythonExe"
    Write-Warn "Recommended setup: python -m venv .venv; .\.venv\Scripts\activate; pip install -r requirements.txt"
}

Write-Info "Checking Python dependencies..."
$dependencyCheckPath = Join-Path $ProjectRoot "scripts\check_deps.py"
if (-not (Test-Path -LiteralPath $dependencyCheckPath)) {
    Write-Fail "Dependency check script was not found: $dependencyCheckPath"
    Pause-And-Exit 1
}
$dependencyOutput = & $pythonExe $dependencyCheckPath 2>&1
if ($LASTEXITCODE -ne 0) {
    if ($dependencyOutput) {
        $dependencyOutput | ForEach-Object { Write-Fail "$_" }
    }
    Write-Fail "Python dependencies are incomplete. Run: pip install -r requirements.txt"
    Pause-And-Exit 1
}

$configPath = Join-Path $ProjectRoot "data\config.json"
$config = $null
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warn "Failed to read data/config.json. Using default port 33333."
    }
}

$port = [int](Get-ConfigValue $config "server_port" 33333)
$provider = [string](Get-ConfigValue $config "model_provider" "ollama")
$ollamaHost = [string](Get-ConfigValue $config "ollama_host" "http://127.0.0.1:11434")
$openaiKey = [string](Get-ConfigValue $config "openai_api_key" "")

$script:enabledPlatforms = @()
foreach ($platformName in @("boss", "zhaopin", "job51")) {
    if (Test-ConfigFlag (Get-ConfigValue $config "${platformName}_enabled" $null) $true) {
        $script:enabledPlatforms += $platformName
    }
}
if ($Platform -eq "all") {
    if ($script:enabledPlatforms.Count -gt 0) {
        Write-Info "Enabled platforms: $($script:enabledPlatforms -join ', ')"
    } else {
        Write-Warn "No platform is enabled in data\config.json. Run the CLI and use config to enable at least one platform."
    }
} elseif ($script:enabledPlatforms -notcontains $Platform) {
    Write-Warn "$Platform is disabled in data\config.json; it will stay disabled until you enable it in the CLI."
}

if (Test-TcpPort $port) {
    if (Test-JobSeekerHealth $port) {
        Write-Warn "Job Seeker is already running on port $port. This launcher will not start another backend."
        if (-not $NoOpen) {
            Open-StartupPages $port $Platform
        }
        Pause-And-Exit 0
    }
    Write-Fail "Port $port is occupied by another program. Close it or change server_port in data/config.json."
    Pause-And-Exit 1
}

$ollamaAvailable = $false
if ($provider -eq "ollama") {
    $ollamaAvailable = Test-OllamaAvailable $ollamaHost
}

if ($provider -eq "ollama" -and $ollamaAvailable) {
    Write-Info "Ollama is reachable: $ollamaHost"
}

if ($provider -eq "ollama" -and -not $ollamaAvailable) {
    Write-Warn "Ollama is not reachable: $ollamaHost. The service will still start, but model calls may fail."
}

if ($provider -eq "openai" -and $openaiKey) {
    Write-Info "OpenAI API Key is configured."
}

if ($provider -eq "openai" -and -not $openaiKey) {
    Write-Warn "Provider is OpenAI, but API Key is missing. Run config in the CLI."
}

Write-Info "Starting Job Seeker CLI..."
$mainPy = Join-Path $ProjectRoot "main.py"
$env:JOB_SEEKER_ENTRY_PLATFORM = $Platform
& $pythonExe $mainPy
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    Pause-And-Exit $exitCode
}

exit 0
