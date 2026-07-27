/**
 * Extrai texto tabular da Lista de Ocorrências (XLSX) sem dependência xlsx.
 */
import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const xlsxPath = path.join(
  SKILL_ROOT,
  "docs",
  "normas",
  "fonte-infoccb",
  "07-lista-ocorrencias-conselho-fiscal.xlsx"
);
const outPath = path.join(
  SKILL_ROOT,
  "docs",
  "normas",
  "_extracted",
  "07-lista-ocorrencias.txt"
);

function listZipEntries(buf) {
  const files = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const nameLen = buf.readUInt16LE(i + 26);
      const extra = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + nameLen).toString();
      const dataStart = i + 30 + nameLen + extra;
      files.push({ name, method, compSize, dataStart });
      i = dataStart + compSize;
    } else {
      i++;
    }
  }
  return files;
}

function inflateEntry(buf, entry) {
  const raw = buf.slice(entry.dataStart, entry.dataStart + entry.compSize);
  return entry.method === 8 ? zlib.inflateRawSync(raw) : raw;
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) =>
      x[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
    );
    strings.push(texts.join(""));
  }
  return strings;
}

function colToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSheet(xml, shared) {
  const rows = new Map();
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*)>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?/g;
  let m;
  while ((m = cellRe.exec(xml))) {
    const col = m[1];
    const row = Number(m[2]);
    const attrs = m[3] || "";
    let val = m[4] ?? "";
    if (attrs.includes('t="s"')) val = shared[Number(val)] ?? "";
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row)[colToIndex(col)] = val;
  }
  return [...rows.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => cells.map((c) => c ?? "").join("\t"));
}

const buf = fs.readFileSync(xlsxPath);
const entries = listZipEntries(buf);
const sharedEntry = entries.find((e) => e.name === "xl/sharedStrings.xml");
const sheetEntry = entries.find((e) => e.name === "xl/worksheets/sheet1.xml");
if (!sharedEntry || !sheetEntry) {
  console.error("Estrutura XLSX inesperada", entries.map((e) => e.name));
  process.exit(1);
}
const shared = parseSharedStrings(inflateEntry(buf, sharedEntry).toString("utf8"));
const lines = parseSheet(inflateEntry(buf, sheetEntry).toString("utf8"), shared);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ out: outPath, rows: lines.length, sample: lines.slice(0, 8) }, null, 2));
