<#
  Gera o EXE offline (Inno Setup): empacota .agents (sem works, node_modules, .siga_session)
  e compila CF-Agents-Setup-<versão>.exe para dist\installer\

  Pré-requisito: Inno Setup 6 — https://jrsoftware.org/isdl.php
  Típico: "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"

  Uso (na raiz do repositório):
    .\scripts\build-offline-installer.ps1
    .\scripts\build-offline-installer.ps1 -Version "1.0.0"
    .\scripts\build-offline-installer.ps1 -IsccPath "C:\Caminho\Inno Setup 6\ISCC.exe"
  Procura ainda CF_ISCC / INNO_SETUP_ISCC (caminho completo do ISCC.exe), PATH e
  pastas "Inno Setup*" em Program Files.

  Se não tiver o Inno: winget install -e --id JRSoftware.InnoSetup -h
#>
[CmdletBinding()]
param(
  [string] $Version = "",
  [string] $RepoRoot = "",
  [string] $IsccPath = ""
)

$ErrorActionPreference = "Stop"
if (-not $RepoRoot) {
  if ($PSScriptRoot) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  } else {
    $def = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Definition }
    $base = Split-Path -Parent -LiteralPath $def
    if ($base) { $RepoRoot = (Resolve-Path (Join-Path $base "..")).Path }
    if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Get-Location).Path).Path }
  }
}
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

function Get-IsccForDir {
  param([string] $D)
  if ([string]::IsNullOrWhiteSpace($D)) { return $null }
  $D = $D.Trim().TrimEnd("\")
  $C = Join-Path $D "ISCC.exe"
  if (Test-Path -LiteralPath $C) { return (Resolve-Path -LiteralPath $C).Path }
  return $null
}

# Registos de desinstalacao: InstallLocation, UninstallString (caminho do unins*.exe)
function Get-IsccFromInnoUninstallRegistry {
  $roots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($ru in $roots) {
    if (-not (Test-Path -LiteralPath $ru)) { continue }
    $keys = Get-ChildItem -LiteralPath $ru -ErrorAction SilentlyContinue
    foreach ($k in $keys) {
      $p = $null
      try { $p = Get-ItemProperty -LiteralPath $k.PSPath } catch { continue }
      if (-not $p.DisplayName) { continue }
      if ($p.DisplayName -notlike "*Inno Setup*") { continue }
      if ($p.InstallLocation) {
        $loc = $p.InstallLocation
        if ($loc -is [Array]) { $loc = $loc[0] }
        $x = Get-IsccForDir ([string] $loc)
        if ($x) { return $x }
      }
      $u = if ($p.QuietUninstallString) { $p.QuietUninstallString } else { $p.UninstallString }
      if ($u -and ($u -match '"([^\"]+\\)[Uu]nins[0-9A-Za-z.]*.exe"')) {
        $d = $Matches[1].TrimEnd("\")
        $x = Get-IsccForDir $d
        if ($x) { return $x }
      }
    }
  }
  return $null
}

# Pastas cujo nome comeca por "Inno" em Program Files e Local\Programs
function Get-IsccShallowScan {
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, (Join-Path $env:LOCALAPPDATA "Programs"))) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    $innoDirs = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Inno*" }
    foreach ($d in $innoDirs) {
      $x = Get-IsccForDir $d.FullName
      if ($x) { return $x }
      $sub = Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Inno*" }
      foreach ($s in $sub) {
        $x2 = Get-IsccForDir $s.FullName
        if ($x2) { return $x2 }
      }
    }
  }
  return $null
}

function Get-InnoIScc {
  [CmdletBinding()] param(
    [string] $Override = ""
  )
  if ($Override -and (Test-Path -LiteralPath $Override)) { return (Resolve-Path -LiteralPath $Override).Path }
  foreach ($e in @($env:CF_ISCC, $env:INNO_SETUP_ISCC, $env:InnoISCC, $env:INNO_ISCC)) {
    if ($e -and (Test-Path -LiteralPath $e)) { return (Resolve-Path -LiteralPath $e).Path }
  }
  # @() e obrigatorio: 1 so resultado de Where vira [string] e $str[0] = primeiro caractere ("C" de C:\...).
  $defaults = @(
    @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
      (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  )
  if ($defaults.Count -gt 0) { return $defaults[0] }
  $r = Get-IsccShallowScan
  if ($r) { return $r }
  $r = Get-IsccFromInnoUninstallRegistry
  if ($r) { return $r }
  $cmd = Get-Command iscc -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Path -and (Test-Path -LiteralPath $cmd.Path)) { return $cmd.Path }
  $where = & $env:ComSpec /c "where iscc 2>nul" 2>$null
  if ($where) {
    $first = ($where -split "\r?\n" | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -First 1)
    if ($first -and (Test-Path -LiteralPath $first)) { return $first }
  }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
    $ds = Get-ChildItem -LiteralPath $root -Directory -Filter "Inno Setup*" -ErrorAction SilentlyContinue
    foreach ($dir in $ds) {
      $p = Join-Path $dir.FullName "ISCC.exe"
      if (Test-Path -LiteralPath $p) { return (Resolve-Path -LiteralPath $p).Path }
    }
  }
  $wgRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path -LiteralPath $wgRoot) {
    $innoWg = Get-ChildItem -LiteralPath $wgRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "inno" }
    foreach ($w in $innoWg) {
      $hit = Get-ChildItem -LiteralPath $w.FullName -Recurse -Filter "ISCC.exe" -ErrorAction SilentlyContinue -Depth 7 |
        Select-Object -First 1
      if ($hit) { return $hit.FullName }
    }
  }
  return $null
}

$iscc = Get-InnoIScc -Override $IsccPath
if ($iscc -is [Array]) { $iscc = $iscc[0] }
if ($iscc) { $iscc = $iscc.ToString().Trim() }
if ($iscc -and ($iscc.Length -ge 1) -and ($iscc[0] -eq [char]0xFEFF)) { $iscc = $iscc.TrimStart([char]0xFEFF) }

if (-not $iscc) {
  $msg = -join @(
    "ISCC.exe (Inno Setup 6) nao foi encontrado. (Procurou Program Files, AppData\Local\Programs, WinGet\Packages, PATH, registo Uninstall, pastas Inno*.)", [Environment]::NewLine, [Environment]::NewLine,
    "1) Reinstale: winget install -e --id JRSoftware.InnoSetup --force -h", [Environment]::NewLine,
    "   Ou: https://jrsoftware.org/isdl.php (o instalador oficial inclui ISCC na pasta de instalacao).", [Environment]::NewLine,
    "2) Procurar ISCC.exe (PowerShell):", [Environment]::NewLine,
    "   Get-ChildItem 'C:\Program Files','C:\Program Files (x86)',(Join-Path `$env:LOCALAPPDATA 'Programs') -Recurse -Filter ISCC.exe -ErrorAction SilentlyContinue -Depth 8 | Select-Object -First 3 FullName", [Environment]::NewLine,
    "3) Com o caminho: .\scripts\build-offline-installer.ps1 -IsccPath '...ISCC.exe' -Version '1.0.1'", [Environment]::NewLine
  )
  throw $msg
}
if ($iscc.Length -lt 8 -or $iscc -notlike "*ISCC.exe" -or -not (Test-Path -LiteralPath $iscc)) {
  throw "Caminho ISCC invalido: '$iscc' (caminho completo para ISCC.exe esperado)."
}
Write-Host "A utilizar: $($iscc)"

$iss = Join-Path $RepoRoot "scripts\installer\CF-Agents-Offline.iss"
$dist = Join-Path $RepoRoot "dist\installer"
if (-not (Test-Path -LiteralPath $dist)) {
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
}

# Start-Process evita o operador & a partir a um caminho C:\ com espacos.
$issFull = (Resolve-Path -LiteralPath $iss).Path
$ps = Start-Process -FilePath $iscc -ArgumentList @("/DMyAppVersion=$Version", $issFull) -NoNewWindow -PassThru -Wait
$out = Join-Path $dist "CF-Agents-Setup-$Version.exe"
$code = if ($ps.ExitCode) { $ps.ExitCode } else { 0 }
# ISCC 6 pode devolver 1 com "Successful compile" (ex.: aviso de ArchitecturesInstallIn64BitMode=x64).
$exeExiste = Test-Path -LiteralPath $out
if ($code -eq 0) {
  if (-not $exeExiste) { throw "ISCC (codigo 0) sem $out" }
} elseif ($code -eq 1 -and $exeExiste) {
  Write-Warning "ISCC devolveu 1; o ficheiro Setup foi gerado. (Frequentemente avisos, nao erros fatais.)"
} else {
  throw "Compilacao Inno falhou (codigo $code). Ver mensagens do ISCC acima."
}
if (Test-Path -LiteralPath $out) {
  Write-Host "OK: $out"
} else {
  Get-ChildItem $dist -Filter "*.exe" | ForEach-Object { Write-Host "Gerado: $($_.FullName)" }
}
