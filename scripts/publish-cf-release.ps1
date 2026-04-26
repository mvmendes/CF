#Requires -Version 5.1
<#
  Sincroniza o Git (main), opção de commit, gera a tag (v*), compila o instalador offline
  e, após o GitHub Actions criar o release com o zip, anexa o .exe (ISCC) ao mesmo release.

  Pré-requisitos:
  - Repositório clonado; remote origin com GitHub; branch main alinhada ao fluxo.
  - GitHub CLI: winget install GitHub.cli  —  e `gh auth login`
  - Inno Setup 6 (ISCC) para o build, como em build-offline-installer.ps1

  O workflow .github/workflows/publish-dot-agents-on-tag.yml cria o release e cf-agents-v*.zip
  ao fazer push da tag. Este script adiciona CF-Agents-Setup-X.Y.Z.exe com `gh release upload`.

  Uso (na raiz do repositório):
    .\scripts\publish-cf-release.ps1 -Version 1.0.1
    .\scripts\publish-cf-release.ps1 -Version v1.0.1 -CommitMessage "Ajusta instalador" -TagMessage "Lançamento 1.0.1"
  Se a variavel GITHUB_TOKEN no ambiente estiver invalida, o gh pode falhar no upload. Remova na sessao:
    Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue; gh auth status
  Teste sem alterar o remoto:
    .\scripts\publish-cf-release.ps1 -Version 1.0.1 -DryRun
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Version,
  [string] $RepoRoot = "",
  [string] $CommitMessage = "",
  [string] $TagMessage = "",
  [switch] $SkipSync,
  [switch] $SkipBuild,
  [switch] $NoUpload,
  [switch] $AllowDirty,
  [switch] $DryRun,
  [int] $WaitReleaseTimeoutSec = 900,
  [int] $WaitPollSec = 5
)

$ErrorActionPreference = "Stop"

function Get-RepositoryRoot {
  if ($RepoRoot) { return (Resolve-Path -LiteralPath $RepoRoot).Path }
  if ($PSScriptRoot) { return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
  if ($PSCommandPath) { return (Resolve-Path (Join-Path (Split-Path -Parent $PSCommandPath) "..")).Path }
  (Resolve-Path (Get-Location).Path).Path
}

function Get-SemverAndTag {
  param([string] $V)
  $V = $V.Trim()
  if ($V.StartsWith("v", [System.StringComparison]::OrdinalIgnoreCase)) {
    $V = $V.Substring(1)
  }
  if ($V -notmatch "^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$") {
    throw "Versão inválida: use X.Y.Z (ex: 1.0.1). Recebido: $V"
  }
  return $V
}

$RepoRoot = Get-RepositoryRoot
$semVer = (Get-SemverAndTag $Version)
# Sem array do return (ambíguo em atribuicao) — tag sempre a partir de semVer
$tagName = "v$semVer"
if ([string]::IsNullOrWhiteSpace($TagMessage)) {
  $TagMessage = "Release $tagName"
}
$buildScript = Join-Path $RepoRoot "scripts\build-offline-installer.ps1"
$exeName = "CF-Agents-Setup-$semVer.exe"
$exePath = Join-Path $RepoRoot "dist\installer\$exeName"

$null = Get-Command git -ErrorAction Stop
$null = Get-Command gh -ErrorAction Stop

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
  throw "Não é um repositório Git: $RepoRoot"
}

$remoteUrl = (git -C $RepoRoot remote get-url origin 2>$null)
if (-not $remoteUrl) {
  throw "Defina o remote 'origin' apontando para o GitHub."
}
Write-Host "Repositório: $RepoRoot"
Write-Host "Tag:         ${tagName}  (Inno/Setup: $semVer)"

$ghStatus = ""
try { $ghStatus = (& gh auth status 2>&1 | Out-String) } catch { $ghStatus = $_.ToString() }
# Cursor/CI muitas vezes define GITHUB_TOKEN; se for invalida, o gh mostra aviso. Remover na sessao deixa a conta (keyring) actuar.
$tokenInvalidaNoAmbiente = $env:GITHUB_TOKEN -and ($ghStatus -match "The token in GITHUB_TOKEN is invalid" -or $ghStatus -match "Failed to log in to github.com using token \(GITHUB_TOKEN\)")

if ($DryRun) {
  Write-Host ""
  Write-Host "=== DRY-RUN: nada e enviado, sem build, tag ou push ===" -ForegroundColor Cyan
  $here = (Get-Location).Path
  Push-Location $RepoRoot
  try {
    if ($ghStatus) { $ghStatus.Trim() -split "`n" | ForEach-Object { if ($_.Trim()) { Write-Host "  [gh] $_" } } }
    if ($tokenInvalidaNoAmbiente) {
      Write-Warning "Remova o env GITHUB_TOKEN nesta janela para o gh activar a conta (keyring):  Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue`n  Caso contrario, 'gh release upload' pode falhar."
    }
    $st = (git status --porcelain 2>$null)
    if ($st) {
      Write-Warning "Working tree nao vazio. Sem -CommitMessage ou -AllowDirty o script real interrompe. Estado:"
      $st -split "`n" | ForEach-Object { if ($_.Trim()) { Write-Host "  $_" } }
    } else {
      Write-Host "  [git] working tree limpo."
    }
    Write-Host "  Ficheiro .exe: $exePath (existe: $(Test-Path -LiteralPath $exePath))"
  } finally {
    Set-Location $here
  }
  Write-Host ""
  Write-Host "Resumo: fetch/pull main -> (commit?) -> build offline -> git tag -a $tagName -> push main (se a frente) -> push tag (workflow + zip) -> aguarda release -> gh release upload (exe)" -ForegroundColor Cyan
  return
}

if ($tokenInvalidaNoAmbiente) {
  throw "GITHUB_TOKEN no ambiente esta invalido. Abra o PowerShell, corra:`n" +
  "  Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue`n" +
  "  gh auth status`n" +
  "e volte a executar o script. (Tambem: Definir variaveis de ambiente do Windows e limpar GITHUB_TOKEN se estiver a sem validade.)"
}
if ($LASTEXITCODE -ne 0) {
  throw "gh auth status (exit $LASTEXITCODE). Corra: gh auth login`n" + $ghStatus
}

Push-Location $RepoRoot
try {
  if (-not $SkipSync) {
    Write-Host "A sincronizar: fetch + checkout main + pull (fast-forward)..."
    & git fetch origin
    if ($LASTEXITCODE -ne 0) { throw "git fetch falhou." }
    $current = (git rev-parse --abbrev-ref HEAD 2>$null)
    if ($current -ne "main") {
      Write-Warning "Branch atual: $current. A mudar para main."
      & git checkout main
      if ($LASTEXITCODE -ne 0) { throw "git checkout main falhou. Resolva e volte a correr." }
    }
    & git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) {
      throw "git pull --ff-only falhou. Integre ou resolva conflitos com main antes de publicar."
    }
  }

  $status = (git status --porcelain 2>$null)
  if ($status) {
    if ($CommitMessage) {
      Write-Host "A criar commit (working tree com alterações)..."
      & git add -A
      & git commit -m $CommitMessage
      if ($LASTEXITCODE -ne 0) { throw "git commit falhou." }
    } elseif (-not $AllowDirty) {
      throw "Working tree com alterações. Guarde, faça commit, ou use -CommitMessage '...' ou -AllowDirty (aviso: a tag aponta só para o commit anterior ao que ainda não commitou; não recomendado)."
    } else {
      Write-Warning "Working tree sujo. A tag aponta para o último commit. Use -CommitMessage se quiser incluir alterações atuais."
    }
  }

  & git show-ref --verify --quiet "refs/tags/$tagName" 2>$null
  if ($LASTEXITCODE -eq 0) {
    throw "A tag $tagName já existe localmente. Apague com: git tag -d $tagName"
  }
  $rmt = (& git ls-remote --tags origin "refs/tags/$tagName" 2>$null)
  if ($rmt) {
    throw "A tag $tagName já existe no remoto. Apague com: git push --delete origin $tagName"
  }

  if (-not $SkipBuild) {
    Write-Host "A compilar instalador: $buildScript -Version $semVer"
    & $buildScript -Version $semVer -RepoRoot $RepoRoot
  }

  if (-not (Test-Path -LiteralPath $exePath)) {
    throw "Falta o executável. Esperado: $exePath. Corra sem -SkipBuild ou compile manualmente."
  }
  $exeInfo = Get-Item -LiteralPath $exePath
  Write-Host "Ficheiro: $($exeInfo.FullName) ($([math]::Round($exeInfo.Length/1MB,2)) MB)"

  & git tag -a $tagName -m $TagMessage
  if ($LASTEXITCODE -ne 0) { throw "git tag falhou." }

  $ahead = (git rev-list --count "origin/main..HEAD" 2>$null)
  if ($ahead -and [int][string]$ahead -gt 0) {
    & git push origin main
    if ($LASTEXITCODE -ne 0) { throw "git push origin main falhou." }
  }

  & git push origin $tagName
  if ($LASTEXITCODE -ne 0) {
    throw "git push da tag falhou. Se a tag já existir no remoto, trate o conflito manualmente."
  }

  if ($NoUpload) {
    Write-Host "Concluído (-NoUpload). Para anexar o .exe depois: gh release upload $tagName `"$exePath`" --clobber"
    return
  }

  Write-Host "A aguardar o GitHub Actions criar o release para $tagName (até $WaitReleaseTimeoutSec s)..."
  $deadline = (Get-Date).AddSeconds($WaitReleaseTimeoutSec)
  $ok = $false
  while ((Get-Date) -lt $deadline) {
    & gh release view $tagName 2>$null
    if ($LASTEXITCODE -eq 0) { $ok = $true; break }
    Start-Sleep -Seconds $WaitPollSec
    Write-Host "  (aguarda workflow / release...)"
  }
  if (-not $ok) {
    throw "Timeout: o release $tagName ainda não apareceu. Verifique Ações no GitHub e depois: gh release upload $tagName `"$exePath`" --clobber"
  }

  Write-Host "A anexar o instalador ao release $tagName..."
  & gh release upload $tagName $exePath --clobber
  if ($LASTEXITCODE -ne 0) {
    throw "gh release upload falhou. Tente: gh release upload $tagName `"$exePath`" --clobber"
  }

  Write-Host "Feito. Release $tagName : zip cf-agents-$tagName.zip (CI) + $exeName (anexado)."
}
finally {
  Pop-Location
}
