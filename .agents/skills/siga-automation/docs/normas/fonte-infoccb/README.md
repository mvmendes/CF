# Fontes InfoCCB (locais — não versionadas)

Os ficheiros **PDF / XLSX / DOCX** desta pasta são **propriedade intelectual da Congregação Cristã no Brasil (CCB)**.

- **Não** commitar nem publicar estes binários no Git.
- Versionado no repositório: apenas [`manifest.json`](manifest.json) (inventário + IDs Moodle) e este README.
- Após clonar o repo, baixe localmente com sessão InfoCCB autenticada:

```bash
# na raiz da skill
node scripts/infoccb-fetch-cf-docs.mjs
# ou fluxo CDP — ver docs/normas/README.md
```

Depois, se precisar de texto para busca local (também **não** versionado):

```bash
node scripts/infoccb-extract-text.mjs
node scripts/infoccb-extract-xlsx.mjs
node scripts/infoccb-build-ocorrencias-json.mjs
```

O agente de auditoria deve preferir `docs/normas/specs/` (checklist, lista de ocorrências estruturada) e o `SKILL.md`; os PDFs servem de consulta humana / re-extração.
