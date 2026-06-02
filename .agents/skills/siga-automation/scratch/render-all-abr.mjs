import fs from "fs/promises";
import path from "path";
import { renderPdfToPng } from "../scripts/lib/render-pdf-png.mjs";

const BASE_DIR = "works/BR 21-0173 - CIDADE ADEMAR - SANTO AMARO/2026-04";

async function renderFolder(folderName) {
  const dirPath = path.join(BASE_DIR, folderName);
  try {
    const items = await fs.readdir(dirPath);
    for (const item of items) {
      if (item.toLowerCase().endsWith(".pdf")) {
        const pdfPath = path.join(dirPath, item);
        console.log(`Rendering: ${pdfPath}`);
        try {
          const res = await renderPdfToPng(pdfPath, null);
          console.log(`✅ Success: ${item} (${res.pageCount} pages)`);
        } catch (e) {
          console.error(`❌ Error rendering ${item}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.error(`Error reading folder ${folderName}: ${e.message}`);
  }
}

async function run() {
  await renderFolder("Fechamento");
  await renderFolder("Manutencao");
  await renderFolder("Voluntarios");
  console.log("All renders completed.");
}

run().catch(console.error);
