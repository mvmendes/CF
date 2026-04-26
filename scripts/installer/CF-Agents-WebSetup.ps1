#Requires -Version 5.1
<#
  Instalador "leve": descarrega o último cf-agents-*.zip do GitHub Release
  e copia o conteúdo .agents para C:\CCB\CF. (Não usa /MIR — não apaga works existente.)

  Compilar .exe (módulo ps2exe):
    Install-Module ps2exe -Scope CurrentUser -Force
    Import-Module ps2exe
    Invoke-ps2exe -inputFile CF-Agents-WebSetup.ps1 -outputFile CF-Agents-WebSetup.exe -requireAdmin
#>
[CmdletBinding()]
param(
  [string] $TargetRoot = "C:\CCB\CF",
  [string] $GitHubOwner = "mvmendes",
  [string] $GitHubRepo = "CF"
)

$ErrorActionPreference = "Stop"

function Get-NodeEmbeddedVersion {
  $fallback = "20.19.0"
  $candidates = @()
  if ($PSCommandPath) { $candidates += (Join-Path (Split-Path -Parent $PSCommandPath) "node-embedded.txt") }
  if ($PSScriptRoot) { $candidates += (Join-Path $PSScriptRoot "node-embedded.txt") }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c)) {
      $v = (Get-Content -LiteralPath $c -Raw -ErrorAction SilentlyContinue).Trim()
      if ($v) { return $v }
    }
  }
  return $fallback
}

function Install-EmbeddedNodeTo {
  param(
    [string] $TargetRoot,
    [string] $NodeVersion
  )
  $url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
  $t = Join-Path $env:TEMP "cf-ws-node-$NodeVersion"
  if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force }
  $tZip = Join-Path $t "node-win-x64.zip"
  $tEx = Join-Path $t "extracted"
  New-Item -ItemType Directory -Path (Split-Path -Parent $tZip) -Force | Out-Null
  Invoke-WebRequest -Uri $url -OutFile $tZip -UseBasicParsing
  [System.IO.Compression.ZipFile]::ExtractToDirectory($tZip, $tEx)
  $inner = Get-ChildItem -LiteralPath $tEx -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $inner) { throw "O pacote Node (win-x64) extraído não contém a pasta raiz esperada." }
  if (-not (Test-Path (Join-Path $inner.FullName "node.exe"))) { throw "node.exe não encontrado após extração do Node $NodeVersion." }
  $dest = Join-Path $TargetRoot "node"
  if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  Copy-Item -Path (Join-Path $inner.FullName "*") -Destination $dest -Recurse -Force
  Remove-Item -LiteralPath $t -Recurse -Force
  $npath = (Resolve-Path -LiteralPath $dest).Path.TrimEnd('\')
  $old = [Environment]::GetEnvironmentVariable("Path", "Machine")
  if ($null -eq $old) { $old = "" }
  $segs = @($old -split ";" | ForEach-Object { $_.Trim().TrimEnd('\') } | Where-Object { $_ })
  $already = $false
  foreach ($s in $segs) { if ($s -ieq $npath) { $already = $true; break } }
  if (-not $already) {
    if ($old -eq "") { [Environment]::SetEnvironmentVariable("Path", $npath, "Machine") }
    else { [Environment]::SetEnvironmentVariable("Path", ($npath + ";" + $old), "Machine") }
  }
}

$NodeVersion = Get-NodeEmbeddedVersion
$api = "https://api.github.com/repos/$GitHubOwner/$GitHubRepo/releases/latest"

Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  $rel = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "CF-Agents-WebSetup" }
} catch {
  throw "Não foi possível obter o último release em $api. Verifique a rede e o nome do repositório. Erro: $_"
}

$zipAsset = $rel.assets | Where-Object { $_.name -like "cf-agents-*.zip" } | Select-Object -First 1
if (-not $zipAsset) {
  throw "Nenhum ficheiro cf-agents-*.zip no último release. Publique com o workflow de tags (v*)."
}

$tempRoot = Join-Path $env:TEMP "cf-agents-ws-$(New-Guid)"
$zipPath = Join-Path $tempRoot $zipAsset.name
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  Invoke-WebRequest -Uri $zipAsset.browser_download_url -OutFile $zipPath -UseBasicParsing
  $extract = Join-Path $tempRoot "extract"
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extract)

  $candidates = @(
    (Join-Path $extract ".agents"),
    (Join-Path $extract "agents")
  )
  $src = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $src) {
    $first = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
    if ($first -and (Test-Path (Join-Path $first.FullName ".agents"))) {
      $src = Join-Path $first.FullName ".agents"
    }
  }
  if (-not $src -or -not (Test-Path -LiteralPath $src)) {
    throw "Estrutura inesperada no zip. Espere-se uma pasta .agents na raiz do arquivo."
  }

  $dst = Join-Path $TargetRoot ".agents"
  $par = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $par)) { New-Item -ItemType Directory -Path $par -Force | Out-Null }

  $robocopyArgs = @($src, $dst, "/E", "/XD", "works", "node_modules", ".siga_session", "/NFL", "/NDL", "/NJH")
  & robocopy @robocopyArgs
  $code = $LASTEXITCODE
  if ($code -ge 8) { throw "robocopy falhou (código $code)." }

  Write-Host "A instalar Node.js $NodeVersion (win-x64) em $TargetRoot\node ..."
  Install-EmbeddedNodeTo -TargetRoot $TargetRoot -NodeVersion $NodeVersion

} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

$msg = "CF Agents ($($rel.tag_name)) copiado para:`n$TargetRoot\.agents`n`n" +
  "Node.js $NodeVersion incluído em $TargetRoot\node (início do PATH de sistema; abra um terminal novo se `node' não for reconhecido de imediato).`n`n" +
  "Em skills\siga-automation execute npm install. Para o SIGA, rode login no CLI se aplicável."
try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  [System.Windows.Forms.MessageBox]::Show($msg, "CF Agents", "OK", "Information") | Out-Null
} catch {
  Write-Host $msg
}
