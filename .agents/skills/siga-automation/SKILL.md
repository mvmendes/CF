---
name: Automacao_Conselho_Fiscal_SIGA
description: Skill para auditorias do Conselho Fiscal no SIGA (extração, anexos, apontamentos). Após sincronizar o catálogo ERP, a I.A. deve mapear descrições (nomeExibicao) a códigos e propor apontamentos quando houver entendimento claro; se houver itens novos, ambiguidade ou múltiplos códigos plausíveis, deve perguntar ao analista (usuário do chat) como proceder. Standalone, com Playwright.
---

# Fluxos de Automação do SIGA (Standalone)

Esta skill fornece uma suíte completa em CLI para extração de dados e automação do SIGA (Sistema de Gestão Módulo Conselho Fiscal). **O projeto é 100% autossuficiente**, exigindo apenas Node.js e a biblioteca `playwright`.

**IMPORTANTE: Como a skill é distribuível, o caminho para os scripts dependerá de onde a skill for instalada.**
Caminho principal do CLI: `scripts/siga-tools.mjs`

Repositório canónico (público, atualizações via git): `https://github.com/mvmendes/CF` — pasta `.agents/skills/siga-automation/`. Contribuições de terceiros: Pull Request revisado por **mvmendes** ou **jamanoel** (ver `CONTRIBUTING.md` na raiz do repo).

## Pré-voo obrigatório: sincronizar skill com `origin` (antes de qualquer comando SIGA)

Em **cada** sessão de auditoria (ou ao abrir o projeto após dias sem uso), execute **primeiro**:

```bash
node scripts/siga-tools.mjs preflight
```

O comando:

1. Localiza a raiz do clone git (ex.: `C:\CCB\CF`).
2. Executa `git fetch origin main`.
3. Se houver commits novos em `.agents/skills/siga-automation/` no remoto, atualiza **scripts**, `SKILL.md`, `config/` e `package.json` a partir de `origin/main`.
4. **Não** altera `works/`, `.siga_session/` nem `token.json` (ignorados pelo git).

Só prossiga com `login`, `extrair-dados`, etc. se o JSON de saída tiver `"ok": true`. Se `"reason": "local_changes"`, peça ao analista se pode usar `preflight --force=true` ou faça commit/PR das alterações locais. Se `package.json` tiver mudado após atualização, corra `npm install` na pasta da skill.

**Distribuição sem instalador:** clone ou pull do repositório público + `preflight` substituem pacotes zip/EXE para manter scripts alinhados com a equipa.

## Princípio imperativo: o analista manda nos lançamentos e no encerramento

- **Quem realiza e responsabiliza a verificação é o utilizador (analista humano).** A skill e o CLI são **apenas apoio** — extração, organização de ficheiros, leitura de documentos, proposta de mapeamento para o catálogo ERP e texto de parecer — **não** substituem o juízo do auditor.
- A I.A. **deve** propor achados (`codigo` ERP, dados sugeridos, observação factual). Pode atualizar **`Task-Parecer-*.md`** com essas propostas e os comandos *sugeridos* (como exemplo).
- **`inserir-item`**, **`atualizar-item`**, **`excluir-item`**, **`fechar-verificacao`** e **`baixar-relatorio`** só podem ser executados depois do utilizador **confirmar explicitamente no chat**, com intenção clara (por exemplo: «sim, lança o item X», «aprovo lançar os quatro pontos», «podes fechar a verificação e baixar o relatório»).
- É **vedado** usar como autorização vagas como «implementa o plano», «termina todos os to-dos», «não pares até concluíres», «executa automático» ou tarefas de sistema — **mantém os apontamentos e o fecho em espera** até haver uma **confirmação humana explícita** para cada bloco sensível.

## Aprendizados Técnicos Críticos (Contexto para I.A.)

Para que a automação seja robusta, a I.A. deve ter ciência de como o SIGA se comporta:

1. **Sessão Isolada do Playwright:**
   - O Playwright **não** compartilha a sessão do navegador principal do usuário.
   - É estritamente necessário criar uma sessão rodando o comando `login` manualmente na primeira execução.
   - A sessão (Cookies, LocalStorage) é salva em `works/.siga_session/state.json` e o JWT em `token.json`. O CLI valida a sessão via API silenciosamente, sem navegar e destruir o estado atual.

2. **Troca de Contexto de Unidade (Casa de Oração / Setor):**
   - O SIGA utiliza a tela `SIS99906.aspx` para trocar a Unidade.  
   - Não basta selecionar a `<option>` no HTML. A automação localiza a opção, força o valor no input hidden e chama o `form.submit()`.

2b. **Mês de Trabalho (barra superior — crítico):**
   - O dropdown **Mês de Trabalho** (`#f_competencia_webmaster` em `SIS99908.aspx`) define a competência da **sessão** (`localStorage` → `competenciasDados`). Telas como **RH00401** listam apontamentos conforme esse mês — **não** apenas o parâmetro `MM/AAAA` do CLI.
   - Se a barra estiver em **05/2026** e a auditoria for **03/2026**, o `dados_voluntarios.json` virá com datas `*/05/26` (falso 29.12). O `extrair-dados` chama `switchWorkingMonth` após cada troca de CO (competências encerradas são injetadas via `codigoCompetencia` da API RH010).
   - **Pré-voo obrigatório:** antes de `extrair-dados` ou `validar-voluntarios`, execute `verificar-sessao-co` (troca CO, aplica o mês, amostra RH00401). Só prossiga se `"ok": true` no JSON; se `"ok": false`, leia `problemas` e corrija a sessão (ou repita após `login`).

3. **Arquitetura de Anexos e GED Azure:**
   - Os documentos em transações financeiras (Fechamentos, Despesas) e Voluntários **NÃO** estão em links HTML clássicos.
   - Para listar arquivos: O SIGA invoca um endpoint SOAP `ArquivoWS.asmx/Selecionar`.
   - Para baixar arquivos: O SIGA abre a página `GED99901.aspx`. O script extrai a URL real (Blob Storage) e o Token de Autorização do Azure, injetados diretamente na tag `<script>` dentro do HTML do GED.
   - **Nomes duplicados no GED:** se dois blobs distintos sugerem o mesmo nome (ex.: `CF052554.pdf`), o scraper **não sobrescreve** — grava `nome__<guid8>.ext` e regista em `<pasta>/.ged-download-manifest.json` com SHA-256 de cada ficheiro e interpretação (*conteúdo idêntico* = upload duplicado; *diferente* = possível anexo trocado).

4. **Catálogo de itens de verificação (ERP):**
   - Os códigos numéricos e textos de `nomeExibicao` vêm do ERP e **mudam** (ex.: novas regras 29.14, 05.09). A fonte de verdade é: `GET /api/ver/ver002/lista-item-verificacao?codigoDepartamento=24` (Conselho Fiscal). O CLI grava o resultado em `config/lista-item-verificacao.json` e **já chama** essa sincronização automaticamente no início de: `listar-verificacoes`, `iniciar-verificacao` e `extrair-dados` (sempre com departamento `24`, salvo uso explícito do comando abaixo).
   - Comando **manual** (mesma persistência, útil fora desses fluxos): `node scripts/siga-tools.mjs sincronizar-lista-itens` ou `... sincronizar-lista-itens 24` (outro `codigoDepartamento` se necessário). **Antes** de mapear regras como `29.09` → `codigo` para `inserir-item`/`atualizar-item`, leia o JSON recém-sincronizado (ou execute `sincronizar-lista-itens` após o `login`).

5. **Pós-sincronização: aprender o catálogo e decidir o próximo passo (obrigatório para a I.A.):**  
   Sempre que o arquivo `config/lista-item-verificacao.json` tiver acabado de ser atualizado (comando `sincronizar-lista-itens` **ou** sync automático no início de `listar-verificacoes` / `iniciar-verificacao` / `extrair-dados`), a I.A. **deve**:
   - **Ler o JSON completo** (ou, em auditorias longas, pelo menos o(s) `nomeGrupo` relevantes, ex. *Registro de coletas*, *REGISTRO DE VOLUNTARIO*, *Relatório financeiro*).
   - **Construir o mapa mental** `inconformidade observada` → par (`codigo`, `nomeExibicao`, `nomeGrupo`), usando a redação do ERP como *fonte* dos critérios oficiais.
   - **Tentar converter** cada constatação da auditoria em proposta de apontamento: escolher **um** `codigo` por achado, redigir `observacao` e campos de data / *N.º Documento* alinhados a esta skill (e geralmente apresentar ao analista no parecer *antes* de `inserir-item`, salvo se o fluxo do utilizador for “já lance tudo”).

   **Quando a I.A. pode propor o mapeamento com confiança (entendimento *pleno* no catálogo):**
   - Existe no catálogo **exatamente uma** linha cujo `nomeExibicao` descreve, sem ambiguidade, a mesma situação que se viu no PDF/JSON; e
   - O `codigo` a usar (inteiro) está explícito nessa linha; e
   - Não existem **duas** regras distintas aplicáveis ao mesmo fato; e
   - Regras de procedimento crítico desta skill (ex.: 29.09 com múltiplos `N.º Documento`, `parseInt` do `codigo`, nunca o rótulo `29.09` sozinho no CLI) estão **satisfeitas**.
   Executar **`inserir-item`** só após confirmação explícita do utilizador (secção «Princípio imperativo»); clareza no catálogo **não** dispensa esse passo.

   **Já há autorização para chamar `inserir-item` / `fechar-verificacao`?** Só quando o utilizador tiver respondido afirmativamente na conversa aos **tipos de ação concretos** (lançar, alterar, excluir, encerrar, baixar). Frases ambíguas ou genéricas de automação não contam.

   **Quando a I.A. *não* deve adivinhar: deve interpelar o analista (perguntar no chat):**
   - Aparecem **itens novos** ou inéditos no catálogo (p.ex. códigos ou textos de `nomeExibicao` que não existiam nas auditorias anteriores ou fora do roteiro desta skill) e a relação com o documento **não** está 100% clara.
   - **Dois ou mais** regras (`codigo` distintos) são plausíveis para o mesmo achado.
   - A redação de `nomeExibicao` é **genérica** ou **ampla** (dúvida se o achado cai nessa regra ou noutra, ou conflita com 07.01 x 06.02, etc.).
   - Há dúvida sobre **reincidência**, competência do fato, ou se o ERP exige anexo antes do apontamento.

   Nesse caso, a I.A. expõe no chat **a pergunta concreta**, listando: o achado; os candidatos do JSON (`codigo` + resumo de `nomeExibicao` + `nomeGrupo`); e, se fizer sentido, uma proposta padrão. Pode ainda adicionar no arquivo `Task-Parecer-*.md` uma subsecção **"Catálogo — esclarecimentos pendentes"** até o analista responder.

---

## Como usar o CLI (siga-tools)

As chamadas são feitas no terminal integrado. O CLI irá gerar saídas estruturadas em JSON ou criar pastas dentro do diretório absoluto `works/` (`path.resolve("works")`).

Supondo que você está na raiz da skill:
`node scripts/siga-tools.mjs <COMANDO> [PARAMETROS...]`

### Comandos Principais:
- `preflight` [(opcional) `--force=true`]: Sincroniza a skill com `origin/main` (fetch + atualização da pasta da skill). Executar **antes** de qualquer outro comando na sessão. Ex.: `node scripts/siga-tools.mjs preflight`
- `login`: Abre o navegador Playwright visível para o usuário autenticar-se. O processo detecta automaticamente a rede e gera o `state.json`. Ex: `node scripts/siga-tools.mjs login --visivel=true`
- `sincronizar-lista-itens [codigoDepartamento]`: Baixa o catálogo de itens de verificação do ERP e grava `config/lista-item-verificacao.json` (padrão: `24` = Conselho Fiscal). Também ocorre **automaticamente** em `listar-verificacoes`, `iniciar-verificacao` e `extrair-dados`.
- `listar-verificacoes <filtroLocalidadeOuSetor> <competencia>`: Busca pendências de auditoria. Para verificação de **Casa de Oração**, prefira código/nome da CO (ex.: `21-0173` ou `CIDADE ADEMAR`) em vez de filtro genérico por setor, para não selecionar Tesouraria/Setor por engano. Ex: `node scripts/siga-tools.mjs listar-verificacoes "21-0173" "02/2026"`
- `verificar-sessao-co <localidade> <competencia>`: Diagnóstico rápido — Mês de Trabalho (`competenciasDados`), `codigoCompetencia` (RH010), troca de CO e amostra de datas em **RH00401** (`*/MM/AA`). Retorna `"ok": true|false`. Ex.: `node scripts/siga-tools.mjs verificar-sessao-co "PEDREIRA" "03/2026"`
- `extrair-dados <id> <localidade> <competencia>`: O fluxo principal. Faz a troca de unidade, busca a chave GUID do mês, lê despesas e baixa todos os PDFs financeiros, de manutenção e voluntários. Os dados são estruturados em `/works/<Localidade>/<Competencia>/`.
- `baixar-depositos-despesas <localidade> <competencia> [--limpar-local=true]`: Rebaixa só anexos TES00601/TES00801 (pastas `Depositos/` e `Despesas/`), com troca explícita de CO antes de cada ecrã. Use `--limpar-local=true` para apagar as duas pastas antes de gravar.
- `validar-voluntarios <localidade> <competencia>`: Valida os apontamentos dos voluntários em busca de repetições sequenciais no arquivo gerado pela extração.
- `render-pdf-png <caminhoDoPdf> [pastaSaida]`: Gera **um ficheiro PNG por página** a partir de um PDF (só **Node 20+**: `pdfjs-dist` e `@napi-rs/canvas`; **sem** Python). Se `pastaSaida` for omitida, a saída fica em `<pastaDoPdf>/.pdf-render/<nomeSemExtensao>/`. Útil para inspecionar digitalizações de livro de voluntários (imagem) com zoom na IDE. Ex.: `node scripts/siga-tools.mjs render-pdf-png "works/.../limpeza-fev-2026.pdf"`.
- `iniciar-verificacao <id> <data>`: Abre a verificação (status Em Andamento) informando a data de início.
- `inserir-item <idDaVerificacao> <codigoDoItem> <dataFato> <numeroDoDocumento> <observacao>`: Insere um apontamento. Note que a numeração de sequenciais deve constar no campo de documento.
- `atualizar-item <codigoApontamento> <idDaVerificacao> <codigoDoItem> <dataFato> <numeroDoDocumento> <observacao> [reincidencia]`: **Edita** um apontamento já existente (API `atualizar-apontamento`, equivalente ao modal *Editar* / VER00204). Útil para corrigir texto, data, *N.º Documento*, reincidência ou item, sem excluir e recriar. A `observacao` pode ter várias palavras; se a última palavra for `true` ou `false`, ela é interpretada como **reincidência** (opcional). Ex.: `node scripts/siga-tools.mjs atualizar-item 1618999 1084703 281 "06/02/2026" "1" "Texto unificado (29.09)." false`
- `excluir-item <codigoApontamento> <idDaVerificacao>`: Deleta um item/apontamento inserido erroneamente, utilizando seu ID de Apontamento.
- `fechar-verificacao <id>`: Operação de submissão final do auditor.
- `baixar-relatorio <id> <localidade> <competencia> [url]`: Efetua o download do Relatório de Auditoria PDF no padrão de nomenclatura amigável para a pasta local. O CLI **troca automaticamente** o contexto para **DR - SETOR …** (inferido do nome da CO) e aplica o **Mês de Trabalho** da competência antes de abrir VER00207 — não use contexto de CO na sessão para este relatório.

---

## Plano mestre: execução completa de uma verificação

Use este plano para **qualquer** verificação mensal do Conselho Fiscal, independentemente da Casa de Oração e da competência. Ele prevalece sobre exemplos antigos e deve ser seguido junto com o catálogo ERP, o módulo de auditoria visual e os comandos CLI documentados nesta skill.

### 0. Entrada mínima obrigatória
- Antes de executar qualquer comando, confirme que o pedido contém **Casa de Oração** e **competência**.
- Se faltar a Casa de Oração, pergunte ao analista qual é a CO (nome, código `BR ...` ou parte inequívoca do nome).
- Se faltar a competência, pergunte o período em formato `MM/AAAA`.
- Normalize a competência para `MM/AAAA` nos comandos e para `AAAA-MM` ao procurar pastas em `works/`.
- Nunca assuma a CO a partir de um arquivo aberto, pasta recente ou setor se o usuário não tiver informado isso no pedido atual.

### 1. Sessão, dependências e catálogo
- **Pré-voo git (obrigatório):** `node scripts/siga-tools.mjs preflight` — confirme `"ok": true` (ver secção *Pré-voo obrigatório* no início desta skill).
- Se for um ambiente novo, rode `npm install` na pasta da skill antes dos comandos Node (e de novo após `preflight` se `package.json` tiver sido atualizado).
- Verifique se há sessão em `works/.siga_session/`. Se a sessão estiver ausente, expirada ou a API responder `401`, execute `node scripts/siga-tools.mjs login --visivel=true` e aguarde o usuário concluir o login no Chromium.
- No início da verificação, sincronize o catálogo ERP por uma ação que já atualiza `config/lista-item-verificacao.json` (`listar-verificacoes`, `iniciar-verificacao`, `extrair-dados`) ou por `node scripts/siga-tools.mjs sincronizar-lista-itens`.
- Após sincronizar, leia o catálogo e use sempre o `codigo` inteiro do ERP para `inserir-item` / `atualizar-item`; nunca use apenas rótulos como `29.09`, pois `parseInt("29.09")` vira `29`.

### 2. Identificação segura da verificação
- Liste as verificações com filtro específico da CO e competência: `node scripts/siga-tools.mjs listar-verificacoes "<CO ou codigo BR>" "<MM/AAAA>"`.
- Prefira código/nome da CO (`21-0173`, `CIDADE ADEMAR`, etc.) em vez de `SET - ...`. Filtro por setor pode devolver verificação de **Tesouraria/Setor**, que não deve receber apontamento de Casa de Oração.
- Antes de qualquer lançamento, confirme nos dados retornados que o registro escolhido é `CONSELHO FISCAL | Aplicação MENSAL | CASA DE ORAÇÃO`, que a localidade corresponde à CO solicitada e que a competência bate com o pedido.
- Se houver nenhuma verificação, várias candidatas plausíveis, tipo diferente de `CASA DE ORAÇÃO`, ou localidade ambígua, pare e pergunte ao analista qual `codigoVerificacao` usar.

### 3. Início e extração dos dados
- Se a verificação ainda precisar ser aberta, execute `node scripts/siga-tools.mjs iniciar-verificacao <id> <dataInicioDD/MM/AAAA>`.
- **Pré-voo de sessão (obrigatório):** `node scripts/siga-tools.mjs verificar-sessao-co "<CO ou trecho do nome>" "<MM/AAAA>"`. Confirme `"ok": true` antes de extrair; se `false`, não rode `extrair-dados` até corrigir (evita falso 29.12 e re-download desnecessário).
- Execute a extração principal: `node scripts/siga-tools.mjs extrair-dados <id> "<localidade completa>" "<MM/AAAA>"`.
- Confirme que foi criada a árvore `works/<localidade>/<AAAA-MM>/` com `Fechamento`, `Despesas`, `Manutencao`, `Voluntarios`, anexos e JSONs consolidados.
- Se o fechamento/GUID não existir para a competência, pare e informe o bloqueio; não invente pastas, GUIDs ou IDs.

### 4. Auditoria documental obrigatória
- Leia o `fechamento_*.json`, `config/doc_types.json` e o catálogo `config/lista-item-verificacao.json` atualizado.
- Inspecione os documentos de `Fechamento`, `Despesas`, `Manutencao`, `Voluntarios` e depósitos/coletas conforme o módulo de auditoria visual desta skill.
- Quando o PDF for imagem ou a leitura depender de conferência visual, renderize páginas com `node scripts/siga-tools.mjs render-pdf-png "<pdf>"` e analise página a página.
- Não substitua a leitura visual de livros de voluntários por `dados_voluntarios.json`: o JSON ajuda em repetições, mas não mostra assinaturas, campos vazios, riscos de cancelamento ou ordem real no encarte.

### 5. Parecer, dúvidas e autorização
- Registre os achados em `works/Task-Parecer-<CO>.md`, com evidência concreta, documento/página/linha quando aplicável, item candidato do catálogo (`codigo`, `nomeExibicao`, `nomeGrupo`) e campos sugeridos de data e `N.º Documento`.
- Se houver item novo, regra genérica, múltiplos códigos plausíveis ou dúvida sobre reincidência/competência/anexo, pergunte ao analista antes de lançar.
- Apresente o parecer no chat e só execute `inserir-item`, `atualizar-item`, `excluir-item`, `fechar-verificacao` ou equivalente após autorização explícita do usuário.

### 6. Lançamentos e padrão de observação
- Para cada apontamento autorizado, chame `node scripts/siga-tools.mjs inserir-item <idVerificacao> <codigoItemERP> "<dataFato>" "<numeroDocumento>" "<observacao>"`.
- A observação deve ser **curta, factual e restrita ao achado**: cite documento/localidade/competência, número do documento quando houver e divergência observada.
- Não prefixe a observação com o código do item (`07.01 -`, `29.09 -` etc.); o item já é intrínseco ao lançamento.
- Não acrescente recomendações de correção, conclusões não observadas, frases como "demais conferem" ou justificativas fora do escopo do erro.
- Para apontamentos sequenciais da mesma regra, use o campo `N.º Documento` como sequencial/identificador, não apenas a observação.
- Na regra 29.09 por repetição de horário, conte as ocorrências a partir da 4.ª: 5 entradas iguais no mesmo dia/livro geram 2 apontamentos, com `N.º Documento` `1` e `2`.

### 7. Correção de lançamentos
- Se um apontamento foi lançado na verificação errada, exclua-o com `node scripts/siga-tools.mjs excluir-item <codigoApontamento> <codigoVerificacaoErrada>` antes de relançar no `codigoVerificacao` correto.
- Se o apontamento está na verificação correta mas o texto/data/documento/reincidência precisa ajuste, prefira `node scripts/siga-tools.mjs atualizar-item ...` em vez de excluir e recriar.
- Depois de lançar, atualizar ou excluir, rode `listar-verificacoes "<CO ou codigo BR>" "<MM/AAAA>"` para confirmar `codigosApontamento` e documente os IDs no parecer.

### 8. Encerramento e relatório
- Quando o parecer estiver revisado e o usuário autorizar o fechamento, execute `node scripts/siga-tools.mjs fechar-verificacao <id>`.
- Em seguida baixe o relatório: `node scripts/siga-tools.mjs baixar-relatorio <id> "<localidade completa>" "<MM/AAAA>"`.
- Informe ao usuário o caminho do PDF salvo em `works/<localidade>/<AAAA-MM>/Relatório CF - ...pdf`.
- Se o SIGA ou o CLI não confirmar o encerramento/download, pare e relate o erro; não declare a verificação encerrada sem evidência de sucesso.

---

## Workflow Principal: Auditoria Mensal (resumo operacional)

Quando o usuário pedir algo como: *"Vou fazer a analise da CO 'Jardim Miriam', competencia do mes 02/2026."*

Siga **rigorosamente** o plano mestre acima. O roteiro abaixo é apenas um resumo operacional dos passos mais comuns.

1. **Garantir Dependências:** 
   Se for necessário rodar em um projeto novo, execute `npm install` na pasta da skill (Playwright, `pdfjs-dist` e `@napi-rs/canvas` para o CLI; **não** é necessário Python).
   
2. **Entrada mínima e check de login**: 
   Confirme a **Casa de Oração** e a **competência**. Se algum dado faltar, pergunte antes de executar comandos.  
   Verifique se o `works/.siga_session/state.json` existe. Se não existir ou o usuário relatar falhas, execute o login visível:
   `node scripts/siga-tools.mjs login --visivel=true`
   Peça para o usuário preencher suas credenciais na janela do Chromium que se abrirá.

2b. **Catálogo de itens (início de qualquer verificação):**  
   Com sessão válida, o `config/lista-item-verificacao.json` é atualizado automaticamente na primeira ação de `listar-verificacoes`, `iniciar-verificacao` ou `extrair-dados`. Se precisar só atualizar o arquivo (sem outra operação), execute `node scripts/siga-tools.mjs sincronizar-lista-itens`. **Em seguida, cumpra o ponto 5** dos *Aprendizados Técnicos* (aprender o catálogo, mapear `nomeExibicao` → `codigo`, autonomia vs. pergunta ao analista). Use sempre o `codigo` numérico do JSON (não o rótulo `29.09` solto) ao chamar `inserir-item` / `atualizar-item`.

3. **Identificação da verificação e extração de dados**:
   Liste por CO/código BR, não por setor genérico, e confirme que o `codigoVerificacao` retornado é da aplicação **CASA DE ORAÇÃO**:
   `node scripts/siga-tools.mjs listar-verificacoes "21-0198" "02/2026"`  
   Rode `iniciar-verificacao <id> <data>` quando necessário. **Antes de extrair:**
   `node scripts/siga-tools.mjs verificar-sessao-co "JD MIRIAM" "02/2026"` — só continue se `"ok": true`.  
   Em seguida:
   `node scripts/siga-tools.mjs extrair-dados 123456 "BR 21-0198 - JD MIRIAM - SANTO AMARO" "02/2026"`
   Alerte o usuário que está procedendo com o download de todos os comprovantes.

4. **Análise Preliminar Interna (Usando I.A. Nativa)**:
   Leia o arquivo JSON consolidado `fechamento_{GUID}.json` que será jogado em `works/`.
   Inspecione a pasta `Fechamento` e utilize suas próprias capacidades nativas (ex: se necessário usar ferramentas de extração PDF ou visual) para checar a consistência das NF's com as `despesas` descritas no JSON.  
   Na pasta `Voluntarios/`, ao auditar os livros digitalizados, inclua **obrigatoriamente** a verificação de **linhas de registo em branco no fim das folhas sem cancelamento** (risco horizontal ou diagonal), com **um apontamento 07.01 (`codigo` 304) por página afetada**, conforme o detalhe em *Livro de Voluntários* no módulo *Auditoria Contábil e Visual* (subitem *Cancelamento de linhas de registo não utilizadas*).

5. **Geração do Parecer (Task.md)**:
   Pegue o resultado da análise detalhada e escreva as constatações listadas no arquivo `/works/Task-Parecer-<CO>.md`.
   Apresente no chat o que encontrou e pergunte o que o analista aprova como lançamento.

6. **Efetivação das Constatações**:
   Quando o usuário confirmar a lista final do `Task.md`, dispare seu controle iterativo chamando o comando CLI. 
   **CUIDADO 1:** O comando `inserir-item` exige o ID OBRIGATORIAMENTE em formato inteiro (`281`). Nunca repasse o número com pontos (`"29.09"`).
   **CUIDADO 2:** Ao inserir múltiplos itens da mesma regra, posicione a numeração sequencial/identificador no 4º argumento (campo "Número do Documento"), e não apenas dentro da string de observação. Ex: `inserir-item 1084703 274 "02/02/2026" "3" ""`.
   **CUIDADO 3 (regra 29.09 – repetição de horário):** Contam-se as ocorrências **a partir da 4.ª** repetição do mesmo horário no mesmo dia/livro: cada uma delas exige **um apontamento** (mesmo item `281`), com *N.º Documento* sequencial **1, 2, … N** no mesmo dia. Ex.: 5 entradas iguais → **dois** itens 29.09 (4.ª e 5.ª), doc `1` e `2`, podendo a observação ser idêntica nos dois.
   **CUIDADO 4 (observação):** Redija texto factual e enxuto. Não inclua o prefixo do item, recomendações de correção, "demais conferem" ou inferências fora do achado observado.
   **AJUSTE:** Para alterar um apontamento já lançado (texto, data, documento, reincidência), use `atualizar-item` em vez de excluir/recriar quando fizer sentido.
   **ERROS:** Caso efetue um apontamento incorreto, utilize o comando `excluir-item <codigoApontamento> <idDaVerificacao>`; para edição, prefira `atualizar-item`.

7. **Balanço Final e Arquivamento**:
   Ao final, se o usuário autorizar, execute `fechar-verificacao <id>`.
   Imediatamente após concluir e obter a URL do relatório, utilize o comando de download fornecendo a URL customizada do SIGA (se a filtragem mudar) ou apenas informando a localidade e competência:
   `node scripts/siga-tools.mjs baixar-relatorio <id> "<Nome da CO>" "<mes/ano>" "https://siga.congregacao.org.br/ver/VER00207.aspx?codigoVerificacao=<id>&FiltroItemVerificacao=Todos&filtroStatusVerificacao=3"`
   Entregue o link de arquivo `file:///` do PDF salvo para que o usuário possa armazenar e arquivar o relatório final ("Relatório CF...").

---

## 🕵️ Módulo de Auditoria Contábil e Visual (Feito Pelo Agente)

A skill de Automação do SIGA foi desenhada para que **o próprio Agente (você)** atue como o Auditor de Inteligência Visual (OCR e Visão Computacional). **Analisar uma Casa de Oração é um processo complexo e criterioso**, não se resuma a olhar os nomes dos arquivos.

Este passo de categorizar e validar profundamente os documentos é **ESSENCIAL e cravado na pedra**. Você NUNCA deve pular esta etapa após a extração!

**Siga rigorosamente este Roteiro de Auditoria Criteriosa:**

1. **Ler o Balanço Base e Dependências**: 
   - Abra o `fechamento_{GUID}.json` extraído. Ele possui os totais declarados no sistema (ex: *totalColetas*, *totalDespesas*) e o Array exato de NFs (`despesas`).
   - Carregue os Padrões Visuais Base: `.agents/skills/siga-automation/config/doc_types.json`
   - Carregue o **Catálogo de Ocorrências** (já sincronizado com o ERP): `config/lista-item-verificacao.json`. Relembre as regras do **ponto 5** dos *Aprendizados Técnicos*: a partir das `nomeExibicao`, decida com confiança plena o `codigo` de cada apontamento ou **pergunte ao analista** se houver itens novos ou ambiguidade.

2. **Auditoria Documental e Cruzamento Contábil**: 
   Acesse a pasta extraída (que contém PDFs de `Fechamento`, `Despesas`, `Manutencao` e `Voluntarios`). Você tem a habilidade de analisar imagens nativamente ou através da extensão recomendada. Você deve cruzar os dados da seguinte forma:
   
   - **Livro de Coletas (C-50)**: 
     - *Assinaturas:* Todas as linhas/dias preenchidos devem possuir no mínimo 3 rubricas simples (Vistos).
     - *Integridade Fiel (OCR):* Fique atento à qualidade do scanner! Caso a imagem esteja mal enquadrada/cortada ao meio (exibindo perda de informação, ausência dos centavos na margem ou perda do total diário no recorte da página lateral direita), você DEVE apontar imediatamente a inconsistência: **"06.02 - Rasura, preenchimento incorreto ou incompleto no registro das coletas"**. O documento só é válido se estiver 100% legível nos valores numéricos horizontais.
   
   - **Mapa de Coletas (PDF do SIGA em `Fechamento`)**:
     - *Estrutura:* Relatório consolidado (ex.: colunas **OFP**, **CXM**, **Total**), com desdobramentos *Valor arrecadado em Espécie*, *em Cartão*, e por vezes **"Vlr. arrec. em PIX / TED / Transf."* (ou texto equivalente). Detalhe em `doc_types.json` → `mapa_coletas` / `criterio_emissao_manual`.
     - *Não conformidade de manual (07.01):* Para **Casa de Oração**, a emissão do **Mapa de Coletas** com a linha discriminando **PIX / TED / transferência** (quando a cartilha de orientação do manual **não** autoriza o uso desse leiaute ou dessa consolidação assinada pela CO) configura desvio de norma interna, **não** corrigida apenas trocando de item de coletas. Enquadre em **"07.01 - Não conformidade com a norma/regra/comunicado interno"** — `codigo` **304** (confirmar em `lista-item-verificacao.json` após `sincronizar-lista-itens`). Descreva na observação o trecho do PDF (linha, valores) e a referência à instrução do manual desrespeitada. Não confundir com **06.02** (problema de digitalização de livro) nem **06.09** (culto sem registro), salvo o caso concreto exija ambos.

   - **Digitalização e Legibilidade (Regra 07.01 — uso complementar do item 304)**:
     - *Padrão (digitalização):* Tons de cinza, 300 a 600 DPI.
     - *Falha Genérica (documento):* Caso o documento apresente qualquer corte (perda de margem, centavos ou assinaturas) ou baixa resolução que impeça a leitura clara, utilize o enquadramento: **"07.01 - Não conformidade com a norma/regra/comunicado interno"** (Item ID `304`). Esta regra **também** se aplica, como acima, a **falta de alinhamento com a cartilha** (ex.: mapa de coletas no formato incorreto), não só a qualidade de escaneamento. Quando o erro for **apenas** digitalização pobre, a 07.01 prevalece sobre a 06.02 na formulação dada no roteiro; quando for **apenas** rasura de livro, priorize 06.02/06.03.

   - **Fechamento Mensal / Relatório Financeiro (C-52)**: 
     - *Assinaturas da Mesa:* Exija e confira visualmente no mínimo 3 assinaturas finais.
     - *Regras de Hierarquia:* Obrigatoriamente, 1 dessas assinaturas pertence ao **Ministério Local** (Ancião, Diácono ou Cooperador). As demais (no mínimo 2) pertencem a cargos da curadoria/administração (Administração, Tesoureiro, Porteiro). Invalide sumariamente relatórios preenchidos apenas por oficiais paralelos (sum assinatura do ministério da CO atestado no mês atual).
     - *Saldos:* O Saldo Atual cruza perfeitamente com o nó `totalColetas` do JSON?

   - **Fechamento do Fundo Bíblico (formulário mensal, distinto do C-52)**: 
     - *Obrigatoriedade e confusão:* O **Fechamento do Fundo Bíblico** é documento **obrigatório** e **não** é o movimento C-52, nem o mapa/recebimentos de coletas. Padrões e critérios de leitura: `config/doc_types.json` → `fundo_biblico` (`file_patterns`, `criterio_auditoria`, `conteudo_para_reconhecer`). Relatório SIGA típico: **EST04102**, paginação *Folha 1/2* (tabelas de estoque) e *Folha 2/2* (três blocos *Responsável* com assinaturas e nomes).
     - *Verificação na pasta e no SIGA:* Confira a pasta `Fechamento` extraída **e** a lista de anexos do fechamento no SIGA: deve existir um PDF cujo conteúdo seja este formulário. Se o anexo do Fundo Bíblico **não** aparece (só C52, despesas, depósitos, mapas, etc.), trata-se de **omissão** do documento.
     - *Assinaturas:* Se o PDF existir, abra a **última folha** (em geral *Folha 2 / 2*): exigem-se **três** assinaturas nos blocos *Responsável* (a primeira folha costuma trazer só quadros de valores, sem as três rubricas). Se faltar o arquivo, ou faltar assinatura em um ou mais blocos, o enquadramento é **17.01** (ausência de formulário de fechamento mensal devidamente preenchido e assinado), com `codigo` de item no SIGA = **272** (confirmar em `lista-item-verificacao.json` após `sincronizar-lista-itens`).
   
   - **Colagem de Despesas (C-39)**: 
     - *Composição C-39:* Verifique as 3 assinaturas visíveis e obrigatórias no cabeçalho ou rodapé formal do modelo C-39.
     - *Rastreabilidade de NFs:* Cada nota listada no `despesas` do JSON (ex: R$ 159,80 Leroy Merlin, R$ 542,80 Enel/Eletropaulo) consta materialmente anexada ou grampeada nesta Colagem de Despesas? (Aponte NF ausente de comprovante com os itens `03.01` ou `03.02`).
     - *Nomes GED duplicados:* Após extração/re-download, leia `Despesas/.ged-download-manifest.json` (se existir). Para cada grupo com `conteudoIdentico: false`, abra **ambos** os PDFs (`CF052554.pdf` e `CF052554__<guid>.pdf`), compare valor/data/fornecedor e cruze com a linha da despesa no JSON/SIGA (`origemGuid`, `nomeListaGED`). Registre no parecer se é upload duplicado inofensivo ou possível comprovante arquivado no lugar errado.
   
   - **Colagem de Depósitos (Local das Coletas)**: 
     - As filipetas bancárias ou comprovantes de caixa eletrônico devem estar legíveis na folha A4 e a folha rubricada 3 vezes.

   - **Livro de Voluntários (RH004 / RH010)**:
     - *Fonte de verdade para o preenchimento no livro (papel digitalizado):* **Apenas o PDF** na pasta `Voluntarios/`. A análise de **assinaturas**, de **código de função** preenchido **no encarte do livro**, de **entradas/saídas** em branco e de **ordem cronológica dos horários de entrada** (sentido de leitura do PDF, de cima para baixo, **no mesmo dia e no mesmo livro**) é **sempre visual** no PDF, **não** substituível por inspeção isolada de `dados_voluntarios.json` (o JSON do SIGA não mostra assinaturas; pode servir de apoio, mas **não** descarta a leitura folha a folha).
     - *Cancelamento de linhas de registo não utilizadas (07.01) — passo explícito:* No fim de **cada folha** do livro (quadro de presença), as linhas **em branco** que não forem preenchidas devem estar **anuladas** conforme o manual: **risco horizontal** (quando for cancelar **uma** linha) ou **risco diagonal** abrangendo o **bloco** de linhas vazias até ao fim do quadro. Percorra **cada** PDF em `Voluntarios/` (todos os livros do mês) **página a página** (use `node scripts/siga-tools.mjs render-pdf-png "<caminho/do/ficheiro.pdf>"` se ajudar a zoom/IDE). Se existirem linhas vazias **sem** anulação visível, é **não cumprimento** da instrução de preenchimento do livro / norma interna: enquadrar em **07.01 - Não conformidade com a norma/regra/comunicado interno** — `codigo` **304** (sempre confirmar após `sincronizar-lista-itens`). **Lançar um apontamento 07.01 por folha (número de página do PDF) com problema**; na `observacao`, indique o **ficheiro**, a **página** e o tipo de falta (p.ex. bloco em branco sem risco diagonal; linha final sem risco). **Diferenciar** do 07.01 de outros documentos (p.ex. Mapa de Coletas): use *data do fato* coerente com a competência (p.ex. último dia do mês) e *N.º Documento* **sequencial** para o par **mesmo** `codigo` **304** + **mesma** data, sem saltar repetição. Não tratar como falha a folha em que a **última** linha vazia estiver claramente cortada com **risco horizontal** (anulação aceitável à linha).
     - *Regra 29.11 (Assinaturas):* No PDF, cada **linha** utilizada deve exibir a rubrica/assinatura do voluntário. Linha com horários preenchidos e **sem** assinatura = apontamento. Confirme com zoom nas varreduras; PDFs de livro costumam ser **imagem** (sem camada de texto), exigindo inspeção visual.
     - *Campos no livro (PDF), mapear no catálogo após `sincronizar-lista-itens`:* p.ex. **29.08** (cód. de função em branco, `codigo` típico `280`), **29.10** (sem saída, `282`); rótulos como “campo obrigatório / rasura” podem constar noutro item (ver **29.04** se existir no ERP). Sempre: `nomeExibicao` → `codigo` no JSON. Entrada e saída vazias validam-se **só** no PDF.
     - *Regra 29.09 (fora da ordem, repetição de horário):* **(a) Ordem cronológica no livro (PDF):** se, percorrendo o dia no sentido de leitura, o horário de **entrada** de uma linha for **anterior** ao da **linha de cima** (retrocesso), trata-se de *fora da ordem* (código de item `281` após confirmar no catálogo). **(b) Repetição de horário:** ainda se pode apoiar no JSON para contar repetições idênticas de entrada/saída no **mesmo** dia; a partir da 4.ª, um apontamento por ocorrência, *N.º Documento* **1, 2, … N**. Use `atualizar-item` se precisar corrigir apontamento.
     - *Regra 29.12 (Cruzamento Livro vs SIGA):* Só após a conferência no PDF, bata com o `dados_voluntarios.json`. Divergências: regra 29.12 com o **código** numérico do catálogo (ex. `284`), com página/linha do **PDF** citada.

3. **Gerar Relatório de Pendências Definitivo (Parecer do Fiscal)**: 
    Não generalize as falhas. Descreva as inconformidades juntando o achado concreto com o `codigo` e o texto de `nomeExibicao` **retirados** do `lista-item-verificacao.json` (pós-sincronização). Se ainda estiver a aguardar o analista sobre um item novo, documente isso em **"Catálogo — esclarecimentos pendentes"** no `Task-Parecer`. 
    **🚨 REGRA CRÍTICA PARA INSERÇÃO DE ITENS (EVITE O BUG DO parseInt) 🚨**
    Ao invocar a ferramenta `node scripts/siga-tools.mjs inserir-item ...`, você **DEVE** passar o `codigo` (ID numérico interno do banco, ex: `281` ou `304`), após extraí-lo do arquivo `lista-item-verificacao.json`.
    - ❌ **ERRO FATAL:** Passar strings como `"29.09"`. O CLI fará `parseInt("29.09")` enviando silenciosamente a regra errada de ID `29`.
    - ✅ **CORRETO:** Consultar o JSON, identificar que "29.09" tem `"codigo": 281`, e passar `281` no lugar.
    Apresente o Parecer para aprovação humana antes de injetar no sistema, e apenas lance os itens expressamente autorizados/solicitados pelo usuário.

---

> 💡 **Ponto de Melhoria e Dica para o Analista / Engenheiro de Fluxos:** 
> Para um fluxo de trabalho implacável, é obrigatória a instalação da extensão **[tomoki1207.pdf](https://open-vsx.org/vscode/item?itemName=tomoki1207.pdf)** no VS Code. Isso possibilita a visualização ágil das folhas e recibos escaneados na própria IDE durante as interações com a IA, não deixando margem para dúvida ou perdas de foco de tela.
