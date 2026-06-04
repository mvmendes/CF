# Contribuir ao repositório CF

O repositório **CF** é **público** para leitura e colaboração via Pull Request. Alterações na skill `siga-automation` e em `.agents` passam por revisão.

## Quem pode fazer o quê

| Papel | Push direto em `main` | Abrir PR | Aprovar / fundir PR |
|--------|------------------------|----------|---------------------|
| **mvmendes** (mantenedor) | Sim | Sim | Sim |
| **jamanoel** (Josué) | Não | Sim | Sim |
| Outros colaboradores com acesso de leitura | Não | Sim | Não (aguardam aprovação) |
| Qualquer utilizador GitHub (fork público) | Não | Sim (do fork) | Não |

A branch `main` está protegida: merges exigem **Pull Request** e **aprovação de code owner** (`CODEOWNERS`: @mvmendes ou @jamanoel). Colaboradores com permissão *Read* não podem fazer push — apenas PR a partir de fork ou branch (se tiverem sido convidados com permissão de escrita temporária, o mantenedor deve evitar isso).

Em repositórios **pessoais**, a restrição “só o owner faz push” cumpre-se pela permissão de colaborador (`pull` = leitura) e não pela API de *branch restrictions* (disponível só em organizações).

## Fluxo recomendado

1. **Fork** do repositório ou clone e crie um branch a partir de `main`.
2. Altere apenas o necessário (skill em `.agents/skills/siga-automation/`, documentação, scripts).
3. **Não** inclua em commits: `works/`, `node_modules/`, `.siga_session/`, `token.json`, PDFs de auditoria ou credenciais.
4. Abra um **Pull Request** para `main` com descrição clara do que mudou e porquê.
5. Aguarde revisão de **mvmendes** ou **jamanoel** antes do merge.

## Atualizar a skill localmente (sem pacote de instalador)

Quem já tem um clone em `C:\CCB\CF` (ou equivalente) deve correr o pré-voo antes de cada sessão de auditoria:

```bash
cd .agents/skills/siga-automation
node scripts/siga-tools.mjs preflight
```

Isto faz `git fetch` e alinha **scripts**, `SKILL.md`, `config/` e `package.json` com `origin/main`, **sem** apagar `works/` (dados locais ignorados pelo git).

Se houver alterações locais não commitadas na skill:

```bash
node scripts/siga-tools.mjs preflight --force=true
```

Use `--force=true` só após confirmar que pode descartar essas alterações.

## Pedir acesso

Para colaboração recorrente, peça ao mantenedor (**mvmendes**) permissão de **Read** no repositório. Escrita direta em `main` não é concedida a terceiros; contribuições entram sempre por PR.
