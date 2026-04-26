<#
  Gera o EXE offline (Inno Setup): empacota .agents (sem works, node_modules, .siga_session)
  e compila CF-Agents-Setup-<versão>.exe para dist\installer\

  Pré-requisito: Inno Setup 6 — https://jrsoftware.org/isdl.php
  Típico: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

  Uso (na raiz do repositório):
    .\scripts\build-offline-installer.ps1
    .\scripts\build-offline-installer.ps1 -Version "1.0.0"
#>
[CmdletBinding()]
param(
  [string] $Version = "",
  [string] $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"
if (-not $Version) {
  Push-Location $RepoRoot
  try {
    $Version = (git describe --tags --always 2>$null)
    if (-not $Version) { $Version = "0.0.0-dev" }
  } finally {
    Pop-Location
  }
}

$nodeVersionFile = Join-Path $RepoRoot "scripts\installer\node-embedded.txt"
$NodeVersion = (Get-Content -LiteralPath $nodeVersionFile -Raw).Trim()
if (-not $NodeVersion) { throw "Ficheiro vazio: $nodeVersionFile" }

$srcAgents = Join-Path $RepoRoot ".agents"
$stageBase = Join-Path $RepoRoot "scripts\installer\staging"
$stageAgents = Join-Path $stageBase ".agents"
$nodeDest = Join-Path $stageBase "node"
$cacheDir = Join-Path $RepoRoot "scripts\installer\cache"

if (-not (Test-Path -LiteralPath $srcAgents)) {
  throw "Não existe: $srcAgents"
}

if (Test-Path -LiteralPath $stageBase) {
  Remove-Item -LiteralPath $stageBase -Recurse -Force
}
New-Item -ItemType Directory -Path $cacheDir -Force -ErrorAction SilentlyContinue | Out-Null
New-Item -ItemType Directory -Path $stageBase -Force | Out-Null

# Node.js (win-x64 LTS) — alinhado com .agents\skills\siga-automation\package.json (engines.node >= 20)
$zipName = "node-v$NodeVersion-win-x64.zip"
$zipUrl = "https://nodejs.org/dist/v$NodeVersion/$zipName"
$zipPath = Join-Path $cacheDir $zipName
if (-not (Test-Path -LiteralPath $zipPath)) {
  Write-Host "A descarregar Node.js $NodeVersion (win-x64) de nodejs.org..."
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
}
$extBase = Join-Path $env:TEMP "cf-node-extract-$NodeVersion"
if (Test-Path -LiteralPath $extBase) { Remove-Item -LiteralPath $extBase -Recurse -Force }
New-Item -ItemType Directory -Path $extBase -Force | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $extBase
$sub = Get-ChildItem -LiteralPath $extBase -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $sub) { throw "Arquivo $zipName sem pasta de raiz (win-x64)." }
if (-not (Test-Path (Join-Path $sub.FullName "node.exe"))) { throw "node.exe não encontrado no zip." }
New-Item -ItemType Directory -Path $nodeDest -Force | Out-Null
Copy-Item -Path (Join-Path $sub.FullName "*") -Destination $nodeDest -Recurse -Force
Remove-Item -LiteralPath $extBase -Recurse -Force

New-Item -ItemType Directory -Path $stageAgents -Force | Out-Null

& robocopy $srcAgents $stageAgents /E /XD works node_modules .siga_session /NFL /NDL /NJH
if ($LASTEXITCODE -ge 8) { throw "robocopy staging falhou: $LASTEXITCODE" }

$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $iscc) {
  throw "ISCC.exe não encontrado. Instale Inno Setup 6 e volte a tentar."
}

$iss = Join-Path $RepoRoot "scripts\installer\CF-Agents-Offline.iss"
$dist = Join-Path $RepoRoot "dist\installer"
if (-not (Test-Path -LiteralPath $dist)) {
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
}

& $iscc "/DMyAppVersion=$Version" $iss
if ($LASTEXITCODE -ne 0) {
  throw "Compilação Inno falhou (código $LASTEXITCODE)."
}

$out = Join-Path $dist "CF-Agents-Setup-$Version.exe"
if (Test-Path -LiteralPath $out) {
  Write-Host "OK: $out"
} else {
  Get-ChildItem $dist -Filter "*.exe" | ForEach-Object { Write-Host "Gerado: $($_.FullName)" }
}
