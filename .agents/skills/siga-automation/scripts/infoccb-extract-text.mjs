/**
 * Extrai texto de PDFs/XLSX baixados do InfoCCB para docs/normas/_extracted/
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(SKILL_ROOT, "docs", "normas", "fonte-infoccb");
const OUT = path.join(SKILL_ROOT, "docs", "normas", "_extracted");

const require = createRequire(import.meta.url);

async function loadPdfjs() {
  try {
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    return await import("pdfjs-dist/build/pdf.mjs");
  }
}

async function extractPdf(fileName, maxPages = 50) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(fs.readFileSync(path.join(SRC, fileName)));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const limit = Math.min(doc.numPages, maxPages);
  let text = "";
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str).join(" ");
    text += `\n\n===== PAGE ${i}/${doc.numPages} =====\n` + pageText;
  }
  const out = path.join(OUT, fileName.replace(/\.pdf$/i, ".txt"));
  fs.writeFileSync(out, text);
  return { fileName, pages: doc.numPages, extracted: limit, chars: text.length, out };
}

function extractXlsx(fileName) {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    console.error("[skip xlsx] pacote xlsx não instalado");
    return null;
  }
  const wb = XLSX.readFile(path.join(SRC, fileName));
  let md = "";
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    md += `\n\n## Sheet: ${name}\n\n` + csv.slice(0, 80000);
  }
  const out = path.join(OUT, fileName.replace(/\.xlsx$/i, ".csv.txt"));
  fs.writeFileSync(out, md);
  return { fileName, sheets: wb.SheetNames, chars: md.length, out };
}

fs.mkdirSync(OUT, { recursive: true });

const pdfs = [
  ["01-secao09-conselho-fiscal.pdf", 40],
  ["04-tutorial-verificacao-conselho-fiscal-siga.pdf", 40],
  ["06-sugestao-verificacao-periodica.pdf", 20],
  ["05-roteiro-verificacao-cf-completo.pdf", 60],
];

const results = [];
for (const [f, max] of pdfs) {
  results.push(await extractPdf(f, max));
}
const x = extractXlsx("07-lista-ocorrencias-conselho-fiscal.xlsx");
if (x) results.push(x);
console.log(JSON.stringify(results, null, 2));
