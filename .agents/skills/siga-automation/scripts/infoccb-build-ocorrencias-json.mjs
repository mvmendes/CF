/**
 * Converte a Lista de Ocorrências extraída (TSV) em JSON estruturado.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const src = path.join(SKILL_ROOT, "docs", "normas", "_extracted", "07-lista-ocorrencias.txt");
const outJson = path.join(SKILL_ROOT, "docs", "normas", "specs", "lista-ocorrencias.json");
const outMd = path.join(SKILL_ROOT, "docs", "normas", "specs", "lista-ocorrencias-co.md");

const lines = fs.readFileSync(src, "utf8").split(/\r?\n/);
const items = [];
for (const line of lines) {
  const parts = line.split("\t");
  // expected: [app?, subgrupo, codigo, descricao, peso] with leading empty
  // sample: CONSELHO... \t Relatório financeiro \t 1.1 \t texto \t 1
  let app = "";
  let subgrupo = "";
  let codigo = "";
  let descricao = "";
  let peso = "";
  if (parts.length >= 5) {
    // find codigo-like field
    const codigoIdx = parts.findIndex((p) => /^\d+\.\d+/.test(String(p).trim()));
    if (codigoIdx >= 2) {
      app = parts[codigoIdx - 2]?.trim() || "";
      subgrupo = parts[codigoIdx - 1]?.trim() || "";
      codigo = parts[codigoIdx].trim();
      descricao = parts[codigoIdx + 1]?.trim() || "";
      peso = parts[codigoIdx + 2]?.trim() || "";
    }
  }
  if (!codigo || !descricao) continue;
  items.push({ aplicacao: app, subgrupo, codigo, descricao, peso: Number(peso) || peso });
}

fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(
  outJson,
  JSON.stringify(
    {
      fonte: "InfoCCB / Conselho Fiscal / Lista de Ocorrências v2",
      recursoMoodleId: 8787,
      geradoEm: new Date().toISOString().slice(0, 10),
      total: items.length,
      itens: items,
    },
    null,
    2
  ),
  "utf8"
);

const co = items.filter((i) => /CASA DE ORAÇÃO/i.test(i.aplicacao));
const bySub = new Map();
for (const it of co) {
  if (!bySub.has(it.subgrupo)) bySub.set(it.subgrupo, []);
  bySub.get(it.subgrupo).push(it);
}

let md = `# Lista de ocorrências — Casa de Oração (InfoCCB)

Fonte: \`docs/normas/fonte-infoccb/07-lista-ocorrencias-conselho-fiscal.xlsx\`  
JSON completo: \`docs/normas/specs/lista-ocorrencias.json\` (${items.length} itens).

**Uso pelo agente:** cruzar o achado documental com \`codigo\`/\`descricao\` abaixo e, em seguida, mapear para o \`codigo\` inteiro do ERP em \`config/lista-item-verificacao.json\` (via \`nomeExibicao\` / grupo). Os rótulos \`1.1\`, \`6.2\`, \`29.09\` **não** vão no CLI \`inserir-item\` — só o inteiro do ERP.

## Aplicação MENSAL | CASA DE ORAÇÃO (${co.length} itens)

`;
for (const [sub, list] of bySub) {
  md += `\n### ${sub}\n\n`;
  md += `| Código | Descrição | Peso |\n| --- | --- | --- |\n`;
  for (const it of list) {
    md += `| ${it.codigo} | ${it.descricao.replace(/\|/g, "\\|")} | ${it.peso} |\n`;
  }
}
fs.writeFileSync(outMd, md, "utf8");
console.log(JSON.stringify({ total: items.length, co: co.length, outJson, outMd }, null, 2));
