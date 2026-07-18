param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$OutputDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "dist\WebGISPortable"),
  [switch]$IncludeLocalConfig,
  [switch]$SkipRuntimeSetup
)

$ErrorActionPreference = "Stop"
$setupScript = Join-Path $ProjectRoot "tools\setup_portable_python.ps1"
$portablePython = Join-Path $ProjectRoot "runtime\python\python.exe"

if (-not $SkipRuntimeSetup -and -not (Test-Path $portablePython)) {
  & powershell -ExecutionPolicy Bypass -File $setupScript -ProjectRoot $ProjectRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path $portablePython)) {
  throw "Portable Python was not found. Run tools\setup_portable_python.ps1 first."
}

if (Test-Path $OutputDir) {
  Remove-Item -LiteralPath $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$items = @("python", "webgis", "runtime", "tools", "requirements.txt", "README.md")
foreach ($item in $items) {
  $source = Join-Path $ProjectRoot $item
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $OutputDir $item) -Recurse -Force
  }
}

$launcher = Get-ChildItem -LiteralPath $ProjectRoot -Filter "*WebGIS.bat" | Select-Object -First 1
if ($launcher) {
  Copy-Item -LiteralPath $launcher.FullName -Destination (Join-Path $OutputDir $launcher.Name) -Force
} else {
  throw "WebGIS launcher BAT was not found."
}

Remove-Item -LiteralPath (Join-Path $OutputDir "runtime\downloads") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $OutputDir ".runtime") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $OutputDir "__pycache__") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $OutputDir "python\__pycache__") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $OutputDir "webgis\data\complaints.geojson") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $OutputDir "webgis\data\complaints.js") -Force -ErrorAction SilentlyContinue

if (-not $IncludeLocalConfig) {
  Remove-Item -LiteralPath (Join-Path $OutputDir "webgis\config.local.js") -Force -ErrorAction SilentlyContinue
}

$zipPath = "$OutputDir.zip"
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Compress-Archive -LiteralPath $OutputDir -DestinationPath $zipPath -Force
Write-Host "Portable package created: $zipPath"
