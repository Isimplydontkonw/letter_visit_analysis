param(
  [string]$PythonVersion = "3.11.9",
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$runtimeDir = Join-Path $ProjectRoot "runtime"
$pythonDir = Join-Path $runtimeDir "python"
$downloadsDir = Join-Path $runtimeDir "downloads"
$pythonExe = Join-Path $pythonDir "python.exe"
$requirements = Join-Path $ProjectRoot "requirements.txt"

if ($Force -and (Test-Path $pythonDir)) {
  Remove-Item -LiteralPath $pythonDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $pythonDir, $downloadsDir | Out-Null

$zipName = "python-$PythonVersion-embed-amd64.zip"
$zipPath = Join-Path $downloadsDir $zipName
$zipUrl = "https://www.python.org/ftp/python/$PythonVersion/$zipName"
$getPipPath = Join-Path $downloadsDir "get-pip.py"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"

if (-not (Test-Path $pythonExe)) {
  if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading $zipUrl"
    try {
      Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    } catch {
      Write-Host "Download failed: $zipUrl"
      Write-Host "Manual fallback: download the zip to $zipPath and run this script again."
      throw
    }
  }

  Write-Host "Extracting portable Python to $pythonDir"
  Expand-Archive -LiteralPath $zipPath -DestinationPath $pythonDir -Force
}

$pthFile = Get-ChildItem -LiteralPath $pythonDir -Filter "python*._pth" | Select-Object -First 1
if ($pthFile) {
  $pthText = Get-Content -Raw -Encoding ASCII -LiteralPath $pthFile.FullName
  if ($pthText -match "#import site") {
    $pthText = $pthText -replace "#import site", "import site"
    Set-Content -LiteralPath $pthFile.FullName -Value $pthText -Encoding ASCII
  }
}

$oldErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $pythonExe -m pip --version *> $null
$pipCheckExitCode = $LASTEXITCODE
$ErrorActionPreference = $oldErrorActionPreference
if ($pipCheckExitCode -ne 0) {
  if (-not (Test-Path $getPipPath)) {
    Write-Host "Downloading get-pip.py"
    try {
      Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath
    } catch {
      Write-Host "Download failed: $getPipUrl"
      Write-Host "Manual fallback: download get-pip.py to $getPipPath and run this script again."
      throw
    }
  }

  Write-Host "Installing pip"
  & $pythonExe $getPipPath
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Installing project dependencies"
& $pythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $pythonExe -m pip install -r $requirements
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Coordinate conversion uses coord_convert when available, otherwise built-in fallback formulas are used."

& $pythonExe -c "import pandas, openpyxl; print('portable python ready')"
exit $LASTEXITCODE





