import { chromium } from "playwright";
import fs from "fs/promises";
import path from "path";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: path.join("works", ".siga_session", "state.json")
  });
  const page = await context.newPage();

  console.log("Acessando MNT00401...");
  await page.goto("https://siga.congregacao.org.br/MNT/MNT00401.aspx?f_inicio=S", { waitUntil: "networkidle" });
  
  const compGuid = "66D71449-146C-4470-977A-A3FAF515011A"; // 01/2026

  try {
    await page.selectOption("#f_competencia", compGuid);
    
    // Tentamos usar o seletor f_efetivado se existir
    if (await page.$("#f_efetivado")) {
      await page.selectOption("#f_efetivado", "");
    }
    
    if (await page.$("#f_status")) {
        await page.selectOption("#f_status", { label: "* Todos *" }).catch(() => {});
        await page.selectOption("#f_status", "").catch(() => {});
    }
    
    if (await page.$("#f_localidade")) {
        await page.selectOption("#f_localidade", "12316").catch(() => {}); // Cidade Ademar
    }

    console.log("Clicando btnConsultar usando force...");
    // Localizar botão pelo value, id ou classes.
    await page.evaluate(() => {
        const btn = document.querySelector("#btnConsultar, a[onclick*='btnConsultar'], input[value*='Consultar']");
        if (btn) btn.click();
        else if (typeof __doPostBack !== 'undefined') __doPostBack('btnConsultar', '');
    });

    await page.waitForTimeout(5000); // Aguarda o grid recarregar (grid é via AJAX)

    // Extrair HTML do body para debugar!
    const bodyHtml = await page.content();
    await fs.writeFile("debug_mnt.html", bodyHtml);
    
    // Get table links
    const codigosMnt = await page.evaluate(() => {
        const codigos = new Set();
        const modals = document.querySelectorAll("a[data-url*='MNT00407'], button[data-url*='MNT00407']");
        modals.forEach(m => {
            const codigo = m.getAttribute("data-codigo") || new URLSearchParams((m.getAttribute("data-url") || "").split('?')[1])?.get("codigo");
            if (codigo) codigos.add(codigo);
        });
        const onclicks = document.querySelectorAll("[onclick*='MNT00407']");
        onclicks.forEach(el => {
            const match = (el.getAttribute("onclick") || "").match(/codigo=([A-F0-9-]{36})/i);
            if (match) codigos.add(match[1]);
        });
        return Array.from(codigos);
    });
    
    console.log("Codigos encontrados na tentativa 1:", codigosMnt);
  } catch (err) {
    console.error(err);
  }

  await browser.close();
}

run().catch(console.error);
