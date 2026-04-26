<#!
  Sincroniza a pasta do repositório `.agents` para o destino (por defeito C:\CCB\CF),
  excluindo `works`, `node_modules` e `.siga_session` (alinhado ao instalador / release).

  Uso (na raiz do repositório clonado):
    .\scripts\install-dot-agents-to-ccb.ps1
    .\scripts\install-dot-agents-to-ccb.ps1 -TargetRoot "D:\outro\CF"
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string] $SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string] $TargetRoot = "C:\CCB\CF"
)

$ErrorActionPreference = "Stop"
$src = Join-Path $SourceRoot ".agents"
$dst = Join-Path $TargetRoot ".agents"

if (-not (Test-Path -LiteralPath $src)) {
  throw "Origem inexistente: $src  (espera-se a raiz do git com subpasta .agents)"
}

$parent = Split-Path -Parent $dst
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

# /E subpastas, /XD exclui diretórios com esses nomes em qualquer nível relativo (comportamento robocopy)
# $LASTEXITCODE: 0-7 = sucesso; >= 8 falha
$args = @(
  $src, $dst,
  "/E",
  "/XD", "works", "node_modules", ".siga_session",
  "/NFL", "/NDL", "/NJH"
)

if ($WhatIfPreference) {
  Write-Host "WhatIf: robocopy $($args -join ' ')"
  return
}

robocopy @args
$code = $LASTEXITCODE
if ($code -ge 8) {
  throw "robocopy terminou com código $code (erro a partir de 8)"
}

Write-Host "Concluído: $src -> $dst  (código robocopy $code; 0-7 = sucesso)"