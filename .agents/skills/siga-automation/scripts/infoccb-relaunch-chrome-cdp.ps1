# Relança o Chrome do usuário com remote debugging para o Playwright da skill anexar a sessão.
# Uso (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts/infoccb-relaunch-chrome-cdp.ps1
#
# ATENÇÃO: fecha todas as janelas do Chrome e reabre com o mesmo perfil.

$ErrorActionPreference = "Stop"
$chromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromeExe)) {
  $chromeExe = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chromeExe)) {
  Write-Error "Chrome não encontrado."
  exit 1
}

$userData = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
Write-Host "[InfoCCB] Encerrando Chrome para reabrir com --remote-debugging-port=9222 ..."
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$args = @(
  "--remote-debugging-port=9222",
  "--remote-allow-origins=*",
  "--user-data-dir=$userData",
  "--profile-directory=Default",
  "--restore-last-session",
  "https://peadccb.congregacao.org.br/course/view.php?id=28#section-2"
)

Write-Host "[InfoCCB] Iniciando Chrome com CDP em 9222..."
Start-Process -FilePath $chromeExe -ArgumentList $args
Start-Sleep -Seconds 4

try {
  $ver = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 5
  Write-Host "[InfoCCB] CDP OK:" $ver.Browser
  Write-Host "[InfoCCB] Agora rode: node scripts/infoccb-fetch-cf-docs.mjs download"
} catch {
  Write-Error "CDP não respondeu em 9222. $($_.Exception.Message)"
  exit 1
}
