# Normas e referências do Conselho Fiscal (InfoCCB)

Base normativa local para a skill `siga-automation`, baixada do curso **Conselho Fiscal** no InfoCCB (`course/view.php?id=28`).

## Propriedade intelectual (obrigatório)

Os materiais do InfoCCB (PDF, XLSX, DOCX e OCR integral) são **propriedade intelectual da CCB**.

| Versionar no Git | Nunca versionar |
| --- | --- |
| `specs/*` (checklist, lista estruturada, periodicidade) | `fonte-infoccb/*.{pdf,xlsx,docx}` |
| `fonte-infoccb/manifest.json` + `fonte-infoccb/README.md` | `_extracted/**` (texto OCR dos PDFs) |
| este `README.md` | sessão `works/.infoccb_session/` |

Cada analista/agente **baixa automaticamente** as fontes para a máquina local (pasta ignorada pelo Git). Sem autenticação InfoCCB não há cópia dos binários.

## Como o agente deve usar

1. **Catálogo ERP (lançamento):** `config/lista-item-verificacao.json` — fonte de verdade do `codigo` inteiro para `inserir-item`.
2. **Lista de ocorrências InfoCCB (enquadramento textual):** `docs/normas/specs/lista-ocorrencias.json` — rótulos oficiais (`1.1`, `6.2`, `29.09`…) e descrições por aplicação (CO, Tesouraria, Voluntário, etc.).
3. **Checklist operacional CO:** `docs/normas/specs/checklist-casa-oracao.md` (matriz §8 alinhada ao `SKILL.md` §4b).
4. **Periodicidade por departamento:** `docs/normas/specs/periodicidade-verificacao.md`.
5. **PDFs/XLSX originais (só local):** `docs/normas/fonte-infoccb/` — inventário em `manifest.json`; ficheiros gerados pelo download, **fora do Git**.
6. **Texto extraído (só local):** `docs/normas/_extracted/*.txt` — regenerável; **fora do Git**.

Fluxo típico ao achar uma incongruidade:

```
achado no PDF/JSON
  → localizar rótulo/descrição em lista-ocorrencias (ou checklist)
  → cruzar com nomeExibicao no lista-item-verificacao.json
  → propor codigo ERP + observação
  → só lançar após confirmação do analista
```

Escopo mensal da skill (verificação `CASA DE ORAÇÃO`) = **Parte 1** do Roteiro CF (PDF local `fonte-infoccb/05-roteiro-…`, §§1–24 + 14.8; síntese no `SKILL.md` §4b e no checklist). Parte 2 (departamentos da Administração) fica fora, salvo pedido explícito.

## Árvore

| Caminho | Conteúdo | Git |
| --- | --- | --- |
| `fonte-infoccb/manifest.json` | Inventário Moodle / nomes de ficheiro | sim |
| `fonte-infoccb/*.{pdf,xlsx,docx}` | Binários oficiais InfoCCB | **não** |
| `specs/` | Material estruturado para o agente | sim |
| `_extracted/` | Texto OCR/extraído | **não** |

## Pipeline de download e manutenção (`infoccb-*`)

Não fazem parte do fluxo mensal de auditoria CO. Executar **após clone** (ou quando as normas mudarem), com sessão InfoCCB autenticada:

| Script | Função |
| --- | --- |
| `scripts/infoccb-fetch-cf-docs.mjs` | Inventário + download dos anexos do curso CF → `fonte-infoccb/` |
| `scripts/infoccb-cdp-download.mjs` | Download via Chrome CDP (sessão já autenticada) |
| `scripts/infoccb-save-cdp-b64.mjs` | Auxiliar de gravação a partir de payload CDP |
| `scripts/infoccb-relaunch-chrome-cdp.ps1` | Relança Chrome com porta de debug |
| `scripts/infoccb-extract-text.mjs` | Extrai texto dos PDFs → `_extracted/*.txt` (local) |
| `scripts/infoccb-extract-xlsx.mjs` | Extrai a lista de ocorrências do XLSX (local) |
| `scripts/infoccb-build-ocorrencias-json.mjs` | Regenera `specs/lista-ocorrencias.json` (+ MD CO) — **este** pode ir ao Git |

Sessão InfoCCB: browser Cursor via Intranet/SSO ou perfil Playwright em `works/.infoccb_session/` (já ignorado).

## Setup local (resumo)

1. Autenticar no InfoCCB (Intranet/SSO).
2. `node scripts/infoccb-fetch-cf-docs.mjs` (ou fluxo CDP) — grava PDFs só na máquina.
3. (Opcional) `node scripts/infoccb-extract-text.mjs` + `infoccb-extract-xlsx.mjs`.
4. Se a lista de ocorrências mudou: `node scripts/infoccb-build-ocorrencias-json.mjs` e commit **apenas** de `specs/`.
5. Confirmar com `git status` que **nenhum** `.pdf` / `.xlsx` / `.docx` de `fonte-infoccb/` aparece para commit.
