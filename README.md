# CF — repositório de agents e automação SIGA

Este repositório concentra a skill **siga-automation** (auditoria do Conselho Fiscal no SIGA), ficheiros partilhados em `.agents`, e scripts de instalação, build de instalador e publicação de releases.

---

## Arquitetura (visão geral)

```mermaid
flowchart TB
  subgraph repo["Repositório CF (git)"]
    agents[".agents/"]
    scripts["scripts/ (PowerShell)"]
    gha[".github/workflows/"]
  end

  subgraph skill[".agents/skills/siga-automation/"]
    cli["scripts/siga-tools.mjs\n(CLI)"]
    ctrl["controllers/siga-controller.mjs"]
    lib["lib: siga-api, siga-browser,\nsiga-scraper, render-pdf-png"]
    cfg["config/*.json","SKILL.md"]
    works["works/ (dados, sessão,\nPDFs) — fora do zip de release"]
  end

  agents --> skill
  cli --> ctrl
  ctrl --> lib
  cfg --> ctrl
  cli --> works
```

- **Entrada do utilizador (ou agente):** `node scripts/siga-tools.mjs <comando> [argumentos]` a partir do diretório da skill, ou a partir do caminho onde a skill for instalada (p.ex. `C:\CCB\CF\.agents\skills\siga-automation`).
- **Núcleo lógico:** `SigaController` orquestra login (Playwright, sessão persistida), chamadas API REST, scraping quando necessário, e geração de ficheiros em `works/`.
- **Dados fora de controlo de versão local:** a pasta `works/` (competências, JSON de fechamento, PDFs, `historico.json`, `works/.siga_session/`) **não** entra no pacote de release/instalador — só código e `config/`.
- **Conhecimento de domínio para a IA:** ficheiro canónico [`.agents/skills/siga-automation/SKILL.md`](.agents/skills/siga-automation/SKILL.md) (fluxos, regras 07.01, catálogo ERP, etc.).

**Dependências técnicas (skill):** Node.js **>= 20**, `npm install` na pasta da skill; Playwright, `pdfjs-dist`, `@napi-rs/canvas` (ver `package.json`).

---

## Deploy e distribuição

| Destino | O que acontece |
|--------|-----------------|
| **GitHub Release** (tag `v*`) | O [workflow `publish-dot-agents-on-tag.yml`](.github/workflows/publish-dot-agents-on-tag.yml) gera o zip `cf-agents-<tag>.zip` (conteúdo de `.agents` **sem** `works`, `node_modules`, `.siga_session`) e cria a release. A tag **tem** de estar no histórico de `main`. |
| **Build local (Windows) — EXE completo** | `.\scripts\build-offline-installer.ps1` — Inno Setup + Node embutido; saída em `dist\installer\CF-Agents-Setup-<versão>.exe`. |
| **Instalador leve (Web)** | `build-websetup-exe.ps1` + `CF-Agents-WebSetup.ps1` (descarrega o zip do release e instala; inclui Node via zip oficial). |
| **Cópia manual a partir de clone** | `.\scripts\install-dot-agents-to-ccb.ps1` — `robocopy` de `.agents` → `C:\CCB\CF` (ou outro alvo), com as mesmas exclusões. |
| **Fim a fim (tag + build + upload do EXE no release)** | `.\scripts\publish-cf-release.ps1` — sincroniza `main`, opcional `git commit`, compila o instalador, empurra a tag e, após o workflow criar a release, anexa o `.exe` com `gh release upload` (ver comentário no script e [LEIA-ME em `scripts/installer/`](scripts/installer/LEIA-ME.txt)). |

**Atualização em máquina já instalada:** o instalador Inno usa o mesmo `AppId` e o mesmo `C:\CCB\CF`. As versões posteriores **substituem** ficheiros em `.agents\` e `node\` nesse destino; **não** há desinstalador (Programas e funcionalidades) porque a instalação está com `Uninstallable=no` no [`.iss`](scripts/installer/CF-Agents-Offline.iss).

---

## Funcionamento da skill (siga-automation)

1. **Sessão:** o `login` abre o Chromium (Playwright) para autenticar; o estado fica em `works/.siga_session/`. A API valida a sessão sem destruir o contexto a cada passo, quando possível.
2. **Catálogo ERP de itens de verificação:** sincronização para `config/lista-item-verificacao.json` (Conselho Fiscal, departamento 24, por omissão) — automática no arranque de certos fluxos ou manual com `sincronizar-lista-itens`.
3. **Ciclo de auditoria (resumido):** mapear CO + competência → `extrair-dados` (ou fluxos alinhados) → análise (agente) sobre JSON/PDFs em `works/` → parecer (`Task-*.md`) → `inserir-item` / `atualizar-item` / `excluir-item` com autorização → `fechar-verificacao` e `baixar-relatorio` quando adequado.  
4. O detalhe operacional, critérios visuais e mapeamento **nomeExibicao → codigo** está no **SKILL.md**, não esgotado neste README.

---

## Comandos do CLI (`siga-tools.mjs`) — referência

Todos os resultados de sucesso são impressos em **JSON** no stdout (salvo o fluxo de erros, também JSON). A flag comum **opcional** é `--visivel=true` para abrir o browser visível, onde o comando a suporta.

| Comando | Argumentos | Descrição |
|--------|------------|------------|
| `login` | (opcional) `--visivel=true` | Abre o fluxo de login; persiste a sessão em `works/.siga_session/`. |
| `sincronizar-lista-itens` | `[codigoDepartamento]` (defeito: 24) | Descarrega o catálogo de itens de verificação do ERP e grava `config/lista-item-verificacao.json`. Pode levar o mesmo `codigo` + `--visivel`. |
| `listar-verificacoes` | `<setor> <competencia>` | Lista verificações pendentes. Sincroniza o catálogo no início. |
| `iniciar-verificacao` | `<id> <dataInicioDD/MM/AAAA>` | Coloca a verificação *em andamento* com a data indicada. |
| `extrair-dados` | `<id> <localidade> <competencia>` | Troca de unidade, guias, anexos (GED/SOAP conforme `SKILL.md`); gera a árvore em `works/<localidade>/<competencia>/` e metadados. Sincroniza o catálogo no início. |
| `validar-voluntarios` | `<localidade> <competencia>` | Valida padrões nos dados de voluntários já extraídos. |
| `inserir-item` | `<idVerificacao> <codigoItem> <data> <nDoc> <observacao>` + opcionalmente `--visivel=true` | Insere apontamento; o **codigo** é o inteiro do ERP (ver JSON), não o rótulo tipo `29.09`. |
| `atualizar-item` | `<codigoApontamento> <idVerificacao> <codigoItem> <data> <nDoc> <observacao...> [true\|false]` | Edita apontamento. Se a **última** palavra for `true` ou `false`, trata de **reincidência**; o resto é observação. |
| `excluir-item` | `<codigoApontamento> <idVerificacao>` | Remove o apontamento. |
| `fechar-verificacao` | `<id>` | Submete a verificação (fechamento pelo auditor). |
| `baixar-relatorio` | `<id> <localidade> <competencia> [urlCustomizada]` | Descarrega o PDF do relatório de auditoria, com nomenclatura amigável. |
| `atualizar-historico` | `<coHistorico> <competencia>` | Atualiza ficheiro de histórico em `works/`. |
| `listar-historico` | (sem args) | Lista o conteúdo do histórico. |
| `render-pdf-png` | `<caminhoPdf> [pastaSaida]` | Renderiza PDF em PNGs por página (análise visual de digitalizações). Requer Node 20+ e dependências nativas. |

**Exemplos mínimos** (a partir do diretório da skill):

```bash
node scripts/siga-tools.mjs login --visivel=true
node scripts/siga-tools.mjs listar-verificacoes "SET - SANTO AMARO" "02/2026"
node scripts/siga-tools.mjs extrair-dados 123456 "BR 21-xxx - NOME - SANTO AMARO" "02/2026"
```

---

## GitHub Actions (repositório)

Só existe **um** workflow de publicação, focado no zip das agents:

- **Nome:** *Release pacote .agents (tag v*)*  
- **Ficheiro:** [`.github/workflows/publish-dot-agents-on-tag.yml`](.github/workflows/publish-dot-agents-on-tag.yml)  
- **Gatilho:** `push` de tags `v*`  
- **Jobs:** (1) verificar se o commit da tag está no histórico de `main`; (2) empacotar `.agents` com exclusões, criar a release e anexar `cf-agents-<tag>.zip`. O EXE de Windows é preparado fora do CI e, no fluxo recomendado, anexado com `publish-cf-release.ps1` após o sucesso do workflow.

---

## Documentação adicional

| Recurso | Conteúdo |
|---------|----------|
| [`.agents/skills/siga-automation/SKILL.md`](.agents/skills/siga-automation/SKILL.md) | Roteiro de auditoria, regras de apontamento, módulo visual, catálogo ERP, SIGA/Playwright. |
| [`scripts/installer/LEIA-ME.txt`](scripts/installer/LEIA-ME.txt) | Instalador offline, Web, publicação, `gh`, Inno. |
| `config/lista-item-verificacao.json` / `config/doc_types.json` | Catálogo e tipos de documento (preenchidos / referência após `sincronizar-lista-itens` ou após o fluxo automático). |

---

## Repositório e licenças

O material é para uso no âmbito do conselho fiscal e SIGA, conforme políticas internas. Dependências de terceiros seguem as licenças em `node_modules` após `npm install` na skill.
