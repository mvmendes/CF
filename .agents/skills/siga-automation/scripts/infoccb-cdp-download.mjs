/**
 * Anexa ao Chrome já aberto com CDP (porta 9222), aguarda login InfoCCB e baixa
 * a seção Instruções Técnicas do curso Conselho Fiscal (id=28).
 */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const SESSION_DIR = path.join(SKILL_ROOT, "works", ".infoccb_session");
const STATE_FILE = path.join(SESSION_DIR, "state.json");
const OUT_DIR = path.join(SKILL_ROOT, "docs", "normas", "fonte-infoccb");
const COURSE = "https://peadccb.congregacao.org.br/course/view.php?id=28";

function safeName(n) {
  return String(n || "doc")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function isLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login/")) return false;
  if (/course\/view\.php/i.test(url)) return true;
  return page.evaluate(() =>
    /Instruções Técnicas|Conselho Fiscal|Sair|logout|MARCUS/i.test(document.body?.innerText || "")
  );
}

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
let page =
  context.pages().find((p) => p.url().includes("peadccb")) ||
  context.pages()[0] ||
  (await context.newPage());

await page.bringToFront().catch(() => {});
await page.goto(COURSE, { waitUntil: "domcontentloaded", timeout: 90000 });
console.error("[InfoCCB] Faça login na janela Chrome (CDP :9222). Aguardando até 5 min...");

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  for (const p of context.pages()) {
    if (p.url().includes("course/view.php") && !p.url().includes("login")) {
      page = p;
      break;
    }
  }
  if (await isLoggedIn(page)) break;
}

if (!(await isLoggedIn(page))) {
  console.log(JSON.stringify({ success: false, error: "Timeout login CDP" }));
  await browser.close();
  process.exit(1);
}

await fs.mkdir(SESSION_DIR, { recursive: true });
await context.storageState({ path: STATE_FILE });
console.error("[InfoCCB] Sessão salva. Listando seção 2 e baixando...");

await page.goto(`${COURSE}#section-2`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1500);

const data = await page.evaluate(() => {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    const text = (a.innerText || "").replace(/\s+/g, " ").trim();
    if (!href.includes("peadccb")) continue;
    if (
      !/mod\/resource|mod\/folder|pluginfile|\.pdf/i.test(href) &&
      !/Tutorial|Roteiro|Sugestão|Instru/i.test(text)
    ) {
      continue;
    }
    let sectionId = null;
    let sectionTitle = null;
    let el = a;
    for (let i = 0; i < 15 && el; i++) {
      el = el.parentElement;
      if (el?.id?.match(/^section-\d+$/)) {
        sectionId = el.id;
        sectionTitle =
          el.querySelector(".sectionname, .section-title, h3, h4")?.innerText?.trim() || null;
        break;
      }
    }
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ text, href, sectionId, sectionTitle });
  }
  const sections = [...document.querySelectorAll("[id^=section-]")].map((s) => ({
    id: s.id,
    title: (s.querySelector(".sectionname, .section-title, h3, h4")?.innerText || "").trim(),
  }));
  return { sections, resources: out };
});

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.writeFile(path.join(OUT_DIR, "manifest.json"), JSON.stringify(data, null, 2));

let targets = data.resources.filter((r) => r.sectionId === "section-2");
if (!targets.length) {
  targets = data.resources.filter((r) => /Tutorial|Roteiro|Sugestão|Instru/i.test(r.text));
}
console.error(
  "[InfoCCB] Alvos:",
  targets.map((t) => t.text)
);

const results = [];
for (const item of targets) {
  console.error("[InfoCCB] Baixando", item.text);
  try {
    const dlP = page.waitForEvent("download", { timeout: 25000 }).catch(() => null);
    await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const download = await dlP;
    if (!download) {
      const fileLink = await page.evaluate(
        () =>
          document.querySelector(
            'a[href*="pluginfile.php"], a[href$=".pdf"], .resourceworkaround a'
          )?.href || null
      );
      const url = fileLink || item.href;
      if (/pluginfile|\.pdf/i.test(url)) {
        const resp = await context.request.get(url);
        const buf = Buffer.from(await resp.body());
        let fname = safeName(item.text);
        if (!fname.toLowerCase().endsWith(".pdf") && (resp.headers()["content-type"] || "").includes("pdf")) {
          fname += ".pdf";
        }
        const fp = path.join(OUT_DIR, fname);
        await fs.writeFile(fp, buf);
        results.push({ text: item.text, ok: true, via: "request", filePath: fp, bytes: buf.length });
        continue;
      }
    }
    if (download) {
      const fname = download.suggestedFilename() || `${safeName(item.text)}.pdf`;
      const fp = path.join(OUT_DIR, fname);
      await download.saveAs(fp);
      results.push({ text: item.text, ok: true, via: "download", filePath: fp });
    } else {
      results.push({ text: item.text, ok: false, reason: "nao_baixavel", url: page.url() });
    }
  } catch (e) {
    results.push({ text: item.text, ok: false, error: e.message });
  }
}

const summary = {
  success: true,
  mode: "cdp",
  outDir: OUT_DIR,
  sections: data.sections,
  attempted: targets.length,
  downloaded: results.filter((r) => r.ok).length,
  results,
};
await fs.writeFile(path.join(OUT_DIR, "download-results.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
