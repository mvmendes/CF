/**
 * Extrai PDF base64 de um log CDP (Runtime.evaluate) e grava em disco.
 * Uso: node scripts/infoccb-save-cdp-b64.mjs <cdp-json> <outfile.pdf>
 */
import fs from "fs";
import path from "path";

const [, , cdpPath, outPath] = process.argv;
if (!cdpPath || !outPath) {
  console.error("Uso: node infoccb-save-cdp-b64.mjs <cdp-json> <outfile.pdf>");
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(cdpPath, "utf8"));
const v = j?.result?.value ?? j?.result?.result?.value;
if (!v?.b64) {
  console.error("Sem b64 no CDP JSON. Chaves:", Object.keys(j?.result || {}));
  process.exit(2);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const buf = Buffer.from(v.b64, "base64");
fs.writeFileSync(outPath, buf);
console.log(
  JSON.stringify({
    out: outPath,
    bytes: buf.length,
    ok: v.ok,
    status: v.status,
    sourceBytes: v.size,
  })
);
