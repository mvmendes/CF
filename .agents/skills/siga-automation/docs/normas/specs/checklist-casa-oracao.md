# Checklist — verificação mensal Casa de Oração

Síntese operacional a partir do **Roteiro de Verificação CF (InfoCCB)**, **Lista de Ocorrências** e práticas já documentadas nesta skill.  
Para lançamento no SIGA, use sempre o `codigo` inteiro de `config/lista-item-verificacao.json`.

## Escopo mensal (CO)

Conforme Sugestão de Verificação Periódica: **mensal** — Casas de Oração, Caixa de Manutenção, Escrituração LRC, Fundo Bíblico, Trabalho Voluntário, Manutenção Preventiva (e correlatos na CO).

## 1. Coletas (LRC / C-50 / mapa)

| Verificar | Rótulo típico (ocorrências) | Notas skill |
| --- | --- | --- |
| Somas linhas/colunas | `6.1` | Conferir totais do mês |
| Rasuras sem justificativa no verso | `6.2` | Priorizar sobre 07.01 quando for só rasura de livro |
| Mín. 3 rubricas por dia | `6.3` | |
| Conciliação LRC × C-52 / mapa | `6.4` | |
| RM / ensaio regional separados | `6.5` | |
| Campos vazios com traço (−) / diagonal | `6.6` | |
| Culto/RJM registrados (mesmo sem frutos) | `6.7` / `6.9` | |
| Digitalização cortada / ilegível | `07.01` (`codigo` ERP ~304) | Ver módulo visual da skill |
| Mapa com PIX/TED não autorizado na CO | `07.01` | Não confundir com `6.2` |

## 2. Relatório financeiro (C-52 / C-39 / depósitos)

| Verificar | Rótulo típico | Notas |
| --- | --- | --- |
| Assinaturas C-52 (mín. 3, 1 do ministério) | `1.1` | |
| Limite de caixa / justificativa | `1.2`, `1.3` | |
| Código/histórico da despesa | `1.4`, `1.5` | |
| C-39: 3 assinaturas; colagem; cópia térmica | `1.6` e correlatos | |
| Depósitos semanais (≥1× por semana do mês) | `01.10` | Contar comprovantes / relação TES00702; ERP típico **552**. Menos depósitos que semanas da competência → propor apontamento |
| Não substituir depósito por transferência pessoal | roteiro §3 | |
| Pagamento em atraso / fora de competência | `3.4`, `3.5` | |

## 3. Documentos fiscais (NF / cupom / faturas)

| Verificar | Rótulo típico | Notas |
| --- | --- | --- |
| Destinatário / CNPJ CCB | `2.1`, `2.2` | |
| Discriminação de itens | `2.3` | Evitar “DIVERSOS” |
| Local de entrega (SP) | `2.5` | |
| Carimbo/recibo de quitação | preenchimento / pagamento | |
| Papel térmico com cópia | relatório financeiro | |
| Compras a prazo pela CO | não devem ocorrer | orientar Tesouraria/ADM |

## 4. Fundo Bíblico

| Verificar | Rótulo típico | Notas skill |
| --- | --- | --- |
| Formulário mensal preenchido e assinado (3 responsáveis) | `17.x` / `17.01` | `codigo` ERP típico **272** — confirmar no catálogo |
| Inventário / saldo espécie / DT | `17.1`–`17.5` | Distinto do C-52 |

## 5. Voluntários (livros Modelo 2/4 e SIGA)

**Pré-requisito de cobertura (não pular livros):** para **cada** PDF em `Voluntarios/` do mês (Adm, Cozinha, Limpeza, Costura, GEM, EBI, Estacionamento, **Manutenção Preventiva**, etc.), percorrer **página a página** e aplicar a matriz abaixo. `validar-voluntarios` (JSON) **só** apoia repetição 29.09 — **não** substitui 29.08 / **29.14** / assinatura / ordem no PDF / linhas em branco.

| Verificar | Rótulo típico | Notas skill |
| --- | --- | --- |
| Linhas em branco sem cancelamento | `07.01` | 1 apontamento por página PDF; ERP típico **304**. Não confundir com folha cheia + mesma letra → **29.14** |
| Assinatura na linha | `29.11` | Só no PDF |
| **Código da função** em cada linha usada | `29.08` | ERP típico **280**. Obrigatório em **todos** os livros — Cozinha e Manutenção Preventiva costumam concentrar falhas |
| Saída em branco | `29.10` | ERP típico **282** |
| Ordem / repetição de horário (≥4ª) | `29.09` | ERP típico **281**; ordem = sentido de leitura no PDF; repetição pode usar JSON de apoio |
| **Caligrafia idêntica / preenchimento único** | `29.14` | **Obrigatório** em cada livro (PDF). ERP típico **277** (*LEGALIDADE - VOLUNTÁRIO*): nomes/horários da mesma mão entre colaboradores distintos. Catálogo ERP prevalece sobre texto InfoCCB antigo (“linha em branco”). Norma apoio: roteiro §26.5 |
| Livro × SIGA | `29.12` | |
| Cadastro Modelos 1/3 | lista ADM `28.5`+ | |

**Antes de fechar o parecer:** registrar na seção de cobertura (ou equivalente) cada livro como `OK` / `achado` / `N/A` para 29.08, 29.09, 29.10, **29.14**, 07.01. Livro sem achado deve aparecer como **OK explícito**, não como “não olhado”.

## 6. Manutenção preventiva / brigada (CO)

Usar itens `28.x` da lista de ocorrências (livro de acompanhamento, atas trimestrais, check-list elétrico, brigada, extintores). Periodicidade do roteiro mensal + atas trimestrais.

## 7. Formulários 14.8 / 14.2 (bens móveis)

| Verificar | Regra | Código típico |
| --- | --- | --- |
| **14.8** no fechamento | **Obrigatório** — exatamente **um** 14.8 da **competência auditada** (mesmo “sem movimentação”) | `05.09` → ERP **305** se ausente / não anexado |
| **14.8** de outra competência | Anexo no pacote do mês errado (ex.: 14.8 de 04 no fechamento de 05) **gera** apontamento; não satisfaz a obrigatoriedade | `05.09` → ERP **305** |
| Mais de um **14.8** | Também é apontamento | `05.09` / critério do analista |
| **14.2** | **Opcional** — só se houver movimentação no mês; **não** substitui o 14.8 | Não apontar só por ausência de 14.2 |

**Prazo de anexo:** se a competência sob auditoria ainda for o **mês anterior** ao corrente e o prazo de anexar no SIGA ainda estiver vigente, o analista pode **segurar** o 305 e pedir à CO que anexe antes de lançar. Competências já encerradas (ex.: maio quando o mês corrente já passou de junho) → manter o apontamento.

## 8. Matriz mínima antes do parecer (anti-lacuna)

Espelhada e **obrigatória** no `SKILL.md` (Plano mestre §4b + template `## Cobertura`). Não apresentar `Task-Parecer` como “completo” sem ter marcado estes eixos (aprendizado Pedreira 05 × Robson Sato):

| Eixo | O que fazer | Falha típica se pular |
| --- | --- | --- |
| Pacote `doc_types` | C-52, mapa, coletas, depósitos, despesas, FB, **14.8** (1× competência correta), manut. assinada, livros | Esquecer 14.8 / FB ilegível |
| Depósitos **01.10** | Contar nº de depósitos do mês × nº de semanas da competência | 3 depósitos em mês com 4+ semanas sem apontar |
| Voluntários **todos** os PDFs | 29.08 + 29.09 + 29.10 + 29.11 + **29.14** + 07.01 por livro | Só olhar GEM/Limpeza; omitir Cozinha/Manutenção/Costura; pular caligrafia |
| Despesas | Natureza × código (ex. gás cozinha → 3027 OK); NF × colagem | Falso 01.04 ou NF sem anexo |
| `analisar-voluntarios` / `validar-voluntarios` | Apoio JSON a 29.08/09/10 | Usar JSON como única fonte e perder 29.08 / **29.14** no PDF |

Ver também no SKILL a tabela R1–R10 (Roteiro CF Parte 1).

## Hierarquia de fontes

1. Evidência no documento extraído (`works/...`).
2. Descrição em `specs/lista-ocorrencias.json`.
3. `codigo` ERP em `config/lista-item-verificacao.json`.
4. Detalhe normativo no PDF em `fonte-infoccb/05-roteiro-...` ou Seção 9.
5. Confirmação do analista antes de `inserir-item` / `fechar-verificacao`.
