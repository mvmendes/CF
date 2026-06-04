#Requires -Version 5.1
<#
.SYNOPSIS
  Torna o repositório CF público, restringe push em main ao mantenedor e
  exige PR com revisão de code owners (mvmendes ou jamanoel).

.DESCRIPTION
  Executar na raiz do clone, com gh autenticado como mvmendes:
    .\scripts\apply-github-collaboration-policy.ps1

  Idempotente: pode ser reexecutado após ajustes manuais no GitHub.
#>
param(
  [string] $Repo = "mvmendes/CF",
  [string] $Branch = "main",
  [string] $Maintainer = "mvmendes",
  [string] $Reviewer = "jamanoel"
)

$ErrorActionPreference = "Stop"

function Require-Gh {
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) não encontrado. Instale e execute: gh auth login"
  }
  gh auth status 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "gh não autenticado. Execute: gh auth login" }
}

Require-Gh

Write-Host "==> Repositório público: $Repo"
gh repo edit $Repo --visibility public --accept-visibility-change-consequences
if ($LASTEXITCODE -ne 0) { throw "Falha ao tornar o repositório público" }

Write-Host "==> Colaborador $Reviewer : permissão read (PR / revisão; sem push em main)"
$perm = gh api "repos/$Repo/collaborators/$Reviewer/permission" --jq .permission 2>$null
if ($perm -eq "write" -or $perm -eq "admin" -or $perm -eq "maintain") {
  gh api -X DELETE "repos/$Repo/collaborators/$Reviewer" 2>&1 | Out-Null
  Start-Sleep -Seconds 1
}
gh api -X PUT "repos/$Repo/collaborators/$Reviewer" -f permission=pull 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Convite para $Reviewer pode estar pendente. Peça para aceitar em github.com/$Repo/invitations com role Read."
}
else {
  Write-Host "    (Se $Reviewer tinha Write, foi reconvidado com Read — aceitar convite no GitHub.)"
}

# Repositórios pessoais não suportam "restrictions" (push por utilizador) na API.
# Escrita direta: só o owner ($Maintainer). Colaboradores com permission=pull abrem PR.
# merge em main: exige aprovação de code owner (CODEOWNERS).
$protectionJson = @"
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
"@

Write-Host "==> Proteção da branch $Branch (PR + CODEOWNERS; @$Maintainer pode contornar como admin)"
$tmp = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tmp, $protectionJson, [System.Text.UTF8Encoding]::new($false))
  gh api -X PUT "repos/$Repo/branches/$Branch/protection" --input $tmp
  if ($LASTEXITCODE -ne 0) {
    Write-Warning @"
Falha na API. Configure em GitHub → Settings → Branches → '$Branch':
  - Require a pull request before merging
  - Require approval from code owners
  - Do not include administrators (para @$Maintainer poder push direto se desejado)
"@
  }
}
finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Concluído."
Write-Host "  - Repo público: https://github.com/$Repo"
Write-Host "  - Push direto: owner @$Maintainer; colaboradores só via PR (permission=pull)"
Write-Host "  - PRs: revisão obrigatória de code owner (@$Maintainer ou @$Reviewer)"
Write-Host "  - Colaboradores: contribuem por branch/PR; preflight local: node scripts/siga-tools.mjs preflight"
