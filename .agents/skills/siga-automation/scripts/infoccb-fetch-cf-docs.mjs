/**
 * Login (visível) no InfoCCB + inventário/download de docs do curso Conselho Fiscal.
 * Uso:
 *   node scripts/infoccb-fetch-cf-docs.mjs login
 *   node scripts/infoccb-fetch-cf-docs.mjs list
 *   node scripts/infoccb-fetch-cf-docs.mjs download
 */
import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(__dirname, "..");
const SESSION_DIR = path.join(SKILL_ROOT, "works", ".infoccb_session");
const STATE_FILE = path.join(SESSION_DIR, "state.json");
const PROFILE_DIR = path.join(SESSION_DIR, "chrome-profile");
const OUT_DIR = path.join(SKILL_ROOT, "docs", "normas", "fonte-infoccb");
const MANIFEST_FILE = path.join(OUT_DIR, "manifest.json");

const COURSE_URL = "https://peadccb.congregacao.org.br/course/view.php?id=28";
const LOGIN_URL = "https://peadccb.congregacao.org.br/login/index.php";
const HOME_URL = "https://peadccb.congregacao.org.br/";
const CDP_ENDPOINTS = ["http://127.0.0.1:9222", "http://127.0.0.1:9223"];

async function launch(headless = true) {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  let storageState;
  try {
    await fs.access(STATE_FILE);
    storageState = STATE_FILE;
  } catch {
    storageState = undefined;
  }
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    storageState,
  });
  const page = await context.newPage();
  return { browser, context, page, mode: "launch" };
}

/** Perfil persistente da skill (cookies sobrevivem entre runs). */
async function launchPersistent(headless = false) {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { browser: null, context, page, mode: "persistent" };
}

/** Anexa a um Chrome/Chromium já aberto com --remote-debugging-port. */
async function connectCdp() {
  for (const endpoint of CDP_ENDPOINTS) {
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      const context = browser.contexts()[0] || (await browser.newContext({ acceptDownloads: true }));
      const pages = context.pages();
      let page =
        pages.find((p) => p.url().includes("peadccb.congregacao.org.br")) ||
        pages.find((p) => p.url().includes("course/view.php")) ||
        pages[0] ||
        (await context.newPage());
      console.error(`[InfoCCB] Conectado via CDP: ${endpoint} | aba: ${page.url()}`);
      return { browser, context, page, mode: "cdp" };
    } catch {
      /* tenta próximo */
    }
  }
  return null;
}

async function saveState(context) {
  await fs.mkdir(SESSION_DIR, { recursive: true });
  await context.storageState({ path: STATE_FILE });
  console.error("[InfoCCB] Sessão salva em:", STATE_FILE);
}

async function isLoggedIn(page) {
  const url = page.url();
  if (url.includes("/login/")) return false;
  if (/course\/view\.php|\/my\/|user\/profile/i.test(url)) return true;
  const logged = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    if (/Identificação de usuário|Please login/i.test(body) && /Senha/i.test(body) && /Acessar/i.test(body)) {
      return false;
    }
    if (/Instruções Técnicas|Conselho Fiscal|Sair|logout/i.test(body)) return true;
    return !!(
      document.querySelector("#user-menu-toggle, .usermenu, .userbutton, .logininfo") ||
      document.querySelector('a[href*="logout.php"]') ||
      document.querySelector('[data-region="user-menu"]')
    );
  });
  return logged;
}

async function closeHandle({ browser, context, mode }) {
  if (mode === "cdp") {
    // Não fechar o Chrome do usuário — só desconectar
    await browser?.close().catch(() => {});
    return;
  }
  if (mode === "persistent") {
    await context.close().catch(() => {});
    return;
  }
  await browser?.close().catch(() => {});
}

async function cmdLogin() {
  // 1) Tenta anexar sessão já aberta (Chrome com debugging)
  let handle = await connectCdp();
  if (handle) {
    const { page, context } = handle;
    if (!(await isLoggedIn(page))) {
      await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    }
    if (await isLoggedIn(page)) {
      await saveState(context);
      console.log(
        JSON.stringify({
          success: true,
          message: "Sessão InfoCCB capturada da aba já aberta (CDP).",
          url: page.url(),
          mode: "cdp",
        })
      );
      await closeHandle(handle);
      return;
    }
    await closeHandle(handle);
  }

  // 2) Login visível com perfil persistente da skill
  handle = await launchPersistent(false);
  const { context, page } = handle;
  console.error("[InfoCCB] Abrindo login visível (perfil persistente da skill)...");
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("/login/")) {
    console.error("[InfoCCB] Aguardando login manual (máx 5 min)...");
  } else {
    console.error("[InfoCCB] Já autenticado no perfil persistente?");
  }
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    try {
      const url = page.url();
      if (await isLoggedIn(page) || (/course\/view\.php/i.test(url) && !url.includes("/login/"))) {
        break;
      }
    } catch {
      /* navegação */
    }
  }
  if (!(await isLoggedIn(page)) && page.url().includes("/login/")) {
    console.log(JSON.stringify({ success: false, error: "Timeout aguardando login InfoCCB." }));
    await closeHandle(handle);
    process.exit(1);
  }
  // Garante estar no curso CF
  if (!page.url().includes("course/view.php")) {
    await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await saveState(context);
  console.log(
    JSON.stringify({
      success: true,
      message: "Login InfoCCB persistido (perfil + state.json).",
      url: page.url(),
      mode: "persistent",
    })
  );
  await closeHandle(handle);
}

async function collectResourceLinks(page) {
  await page.goto(COURSE_URL, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2000);
  // Focar seção 2 se existir âncora
  await page.evaluate(() => {
    const el = document.querySelector("#section-2, [id*='section-2']");
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(500);

  const resources = await page.evaluate(() => {
    const out = [];
    const seen = new Set();

    const push = (item) => {
      if (!item.href || seen.has(item.href)) return;
      seen.add(item.href);
      out.push(item);
    };

    // Links de recursos Moodle (mod/resource, mod/folder, mod/url, pluginfile)
    const anchors = [...document.querySelectorAll("a[href]")];
    for (const a of anchors) {
      const href = a.href;
      const text = (a.innerText || a.textContent || "").replace(/\s+/g, " ").trim();
      if (!href.includes("peadccb.congregacao.org.br")) continue;
      const isDoc =
        /mod\/resource|mod\/folder|mod\/url|pluginfile\.php|\.pdf|\.docx?|\.xlsx?/i.test(href) ||
        /instru[cç][aã]o|IT\.|manual|norma|comunicado|procedimento|cartilha/i.test(text);
      if (!isDoc && !/mod\/resource|mod\/folder|pluginfile/i.test(href)) continue;

      // seção aproximada
      let sectionId = null;
      let sectionTitle = null;
      let el = a;
      for (let i = 0; i < 12 && el; i++) {
        el = el.parentElement;
        if (!el) break;
        if (el.id && /^section-\d+$/i.test(el.id)) {
          sectionId = el.id;
          sectionTitle =
            el.querySelector(".sectionname, .section-title, h3, h4")?.innerText?.trim() || null;
          break;
        }
      }

      push({
        text,
        href,
        sectionId,
        sectionTitle,
        titleAttr: a.getAttribute("title") || "",
      });
    }

    // Títulos de seções do curso
    const sections = [...document.querySelectorAll("[id^=section-]")].map((s) => ({
      id: s.id,
      title: (s.querySelector(".sectionname, .section-title, h3, h4")?.innerText || "").trim(),
    }));

    return { url: location.href, title: document.title, sections, resources: out };
  });

  return resources;
}

async function openSession(headless = true) {
  let handle = await connectCdp();
  if (handle && (await isLoggedIn(handle.page))) {
    return handle;
  }
  if (handle) await closeHandle(handle);

  handle = await launchPersistent(headless);
  await handle.page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  if (await isLoggedIn(handle.page)) return handle;
  await closeHandle(handle);

  handle = await launch(headless);
  await handle.page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  return handle;
}

async function cmdList() {
  const handle = await openSession(true);
  const { context, page } = handle;
  if (!(await isLoggedIn(page))) {
    await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  if (page.url().includes("/login/") || !(await isLoggedIn(page))) {
    console.log(
      JSON.stringify({
        success: false,
        error:
          "Sessão InfoCCB inválida. Opções: (1) node scripts/infoccb-fetch-cf-docs.mjs login  |  (2) abra o Chrome com --remote-debugging-port=9222 e rode list/download de novo",
      })
    );
    await closeHandle(handle);
    process.exit(1);
  }
  const data = await collectResourceLinks(page);
  await saveState(context);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(data, null, 2), "utf8");
  console.log(
    JSON.stringify({
      success: true,
      mode: handle.mode,
      sections: data.sections,
      totalResources: data.resources.length,
      section2: data.resources.filter((r) => r.sectionId === "section-2"),
      manifest: MANIFEST_FILE,
    })
  );
  await closeHandle(handle);
}

function safeName(name) {
  return String(name || "documento")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function downloadOne(page, context, item, destDir) {
  const base = safeName(item.text || item.titleAttr || "doc");
  // Abrir resource e tentar achar pluginfile / download
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes("pluginfile.php") ||
      (r.headers()["content-type"] || "").includes("pdf") ||
      (r.headers()["content-disposition"] || "").includes("attachment"),
    { timeout: 20000 }
  ).catch(() => null);

  const downloadPromise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);

  const download = await downloadPromise;
  if (download) {
    const suggested = download.suggestedFilename() || `${base}.bin`;
    const filePath = path.join(destDir, suggested);
    await download.saveAs(filePath);
    return { ok: true, via: "download", filePath, source: item.href };
  }

  // Se a página é viewer com link para pluginfile
  const fileLink = await page.evaluate(() => {
    const a =
      document.querySelector('a[href*="pluginfile.php"]') ||
      document.querySelector('a[href$=".pdf"]') ||
      document.querySelector(".resourceworkaround a, .resourcecontent a");
    return a ? a.href : null;
  });

  const targetUrl = fileLink || item.href;
  if (/pluginfile\.php|\.pdf($|\?)/i.test(targetUrl)) {
    const resp = await context.request.get(targetUrl);
    const buf = Buffer.from(await resp.body());
    const ct = resp.headers()["content-type"] || "";
    const cd = resp.headers()["content-disposition"] || "";
    let fname = base;
    const m = cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i);
    if (m) fname = decodeURIComponent(m[1].replace(/"/g, ""));
    else if (ct.includes("pdf") && !fname.toLowerCase().endsWith(".pdf")) fname += ".pdf";
    const filePath = path.join(destDir, safeName(fname));
    await fs.writeFile(filePath, buf);
    return { ok: true, via: "request", filePath, source: targetUrl, bytes: buf.length, contentType: ct };
  }

  // folder: listar e baixar filhos
  if (page.url().includes("mod/folder") || (await page.locator('a[href*="pluginfile.php"]').count()) > 0) {
    const files = await page.evaluate(() =>
      [...document.querySelectorAll('a[href*="pluginfile.php"]')].map((a) => ({
        href: a.href,
        text: (a.innerText || "").trim(),
      }))
    );
    const saved = [];
    for (const f of files) {
      const resp = await context.request.get(f.href);
      const buf = Buffer.from(await resp.body());
      let fname = safeName(f.text || path.basename(new URL(f.href).pathname)) || "file.bin";
      if (!path.extname(fname) && (resp.headers()["content-type"] || "").includes("pdf")) fname += ".pdf";
      const filePath = path.join(destDir, fname);
      await fs.writeFile(filePath, buf);
      saved.push({ filePath, bytes: buf.length, source: f.href });
    }
    return { ok: true, via: "folder", files: saved, source: item.href };
  }

  await respPromise;
  return { ok: false, reason: "nao_baixavel", url: page.url(), source: item.href, text: item.text };
}

async function cmdDownload() {
  const handle = await openSession(true);
  const { context, page } = handle;
  await page.goto(COURSE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (page.url().includes("/login/") || !(await isLoggedIn(page))) {
    console.log(
      JSON.stringify({
        success: false,
        error:
          "Sessão InfoCCB inválida. Opções: (1) node scripts/infoccb-fetch-cf-docs.mjs login  |  (2) Chrome com --remote-debugging-port=9222",
      })
    );
    await closeHandle(handle);
    process.exit(1);
  }

  const data = await collectResourceLinks(page);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(data, null, 2), "utf8");

  // Preferir seção 2; se vazia, baixar tudo que parecer IT/manual
  let targets = data.resources.filter((r) => r.sectionId === "section-2");
  if (targets.length === 0) {
    targets = data.resources.filter((r) =>
      /instru[cç]|IT\.|manual|norma|procedimento|cartilha|tutorial|roteiro|verifica/i.test(
        `${r.text} ${r.titleAttr} ${r.sectionTitle || ""}`
      )
    );
  }
  if (targets.length === 0) targets = data.resources;

  const results = [];
  for (const item of targets) {
    console.error(`[InfoCCB] Baixando: ${item.text || item.href}`);
    try {
      const r = await downloadOne(page, context, item, OUT_DIR);
      results.push({ text: item.text, ...r });
    } catch (e) {
      results.push({ text: item.text, ok: false, error: e.message, source: item.href });
    }
  }

  await saveState(context);
  const summary = {
    success: true,
    mode: handle.mode,
    outDir: OUT_DIR,
    sections: data.sections,
    attempted: targets.length,
    downloaded: results.filter((r) => r.ok).length,
    results,
  };
  await fs.writeFile(path.join(OUT_DIR, "download-results.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await closeHandle(handle);
}

const cmd = process.argv[2] || "list";
if (cmd === "login") await cmdLogin();
else if (cmd === "list") await cmdList();
else if (cmd === "download") await cmdDownload();
else {
  console.error("Uso: node scripts/infoccb-fetch-cf-docs.mjs <login|list|download>");
  process.exit(1);
}
