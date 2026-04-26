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

  await page.evaluate((guid) => {
    // Modify hidden selects and trigger change for Select2
    if (window.jQuery) {
       jQuery("#f_competencia").val(guid).trigger("change");
       jQuery("#f_efetivado").val("").trigger("change"); // Todos
       jQuery("#f_localidade").val("12316").trigger("change"); // Cidade Ademar
    } else {
       const c = document.querySelector("#f_competencia");
       if (c) { c.value = guid; c.dispatchEvent(new Event("change")); }
       const e = document.querySelector("#f_efetivado");
       if (e) { e.value = ""; e.dispatchEvent(new Event("change")); }
       const l = document.querySelector("#f_localidade");
       if (l) { l.value = "12316"; l.dispatchEvent(new Event("change")); }
    }

    // Now click the Consultar button on the modal!
    const btn = document.querySelector("#btnConsultar") || 
                document.querySelector(".modal-footer .btn-success") ||
                document.querySelector("button[onclick*='btnConsultar']");
    if (btn) btn.click();
    else if (typeof __doPostBack !== 'undefined') {
        __doPostBack('btnConsultar', '');
    }
  }, compGuid);

  console.log("Aguardando network idle pós clique...");
  await page.waitForTimeout(5000); // hard wait to allow grid load
  
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
  
  console.log("Codigos encontrados:", codigosMnt);

  await browser.close();
}

run().catch(console.error);
