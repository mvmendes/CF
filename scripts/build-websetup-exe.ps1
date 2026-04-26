<#
  Compila CF-Agents-WebSetup.ps1 num .exe pequeno (PS2EXE).
  O utilizador final executa o .exe: descarrega o último release do GitHub e instala em C:\CCB\CF.

  Pré-requisito (uma vez):
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
    Install-Module ps2exe -Scope CurrentUser -Force

  Uso:
    .\scripts\build-websetup-exe.ps1
#>
[CmdletBinding()]
param(
  [string] $OutputDir = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "dist\installer")
)

$ErrorActionPreference = "Stop"
if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  throw "Instale: Install-Module ps2exe -Scope CurrentUser -Force"
}
Import-Module ps2exe -Force

$src = Join-Path $PSScriptRoot "installer\CF-Agents-WebSetup.ps1"
if (-not (Test-Path -LiteralPath $src)) {
  throw "Falta: $src"
}
if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$out = Join-Path $OutputDir "CF-Agents-WebSetup.exe"
Invoke-ps2exe -inputFile $src -outputFile $out -requireAdmin -noConsole `
  -title "Instalador CF Agents" `
  -description "Instala skills e automação CF em C:\CCB\CF" `
  -longDescription "Descarrega o pacote .agents do último release no GitHub."

$verF = Join-Path (Join-Path $PSScriptRoot "installer") "node-embedded.txt"
if (Test-Path -LiteralPath $verF) {
  Copy-Item -LiteralPath $verF -Destination (Join-Path $OutputDir "node-embedded.txt") -Force
  Write-Host "Copiado: node-embedded.txt (versão do Node embutida) -> $OutputDir"
}

Write-Host "Gerado: $out"
Write-Host "Distribua só este .exe a utilizadores com Internet; o offline completo use build-offline-installer.ps1"
