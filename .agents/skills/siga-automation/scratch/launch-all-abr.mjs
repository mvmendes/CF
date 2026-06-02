import { SigaController } from "../scripts/controllers/siga-controller.mjs";
import path from "path";

const WORKSPACE_PATH = path.resolve("works");
const HISTORY_FILE = path.join(WORKSPACE_PATH, "historico.json");

const VERIFICATION_ID = "1084705";

const APONTAMENTOS = [
  { cod: 304, data: "30/04/2026", doc: "1", obs: "MAPA DE COLETAS.pdf apresenta linha e valores em PIX / TED / Transf., em desacordo com a IT.TES.02." },
  { cod: 304, data: "30/04/2026", doc: "2", obs: "Livro de Limpeza (limpeza-abr-2026.pdf), pags. 1, 2, 3: cabeçalho preenchido com o ano incorreto de 2025 em vez de 2026." },
  { cod: 304, data: "30/04/2026", doc: "3", obs: "Livro de Costura (costura-abr-2026.pdf), pag. 1: linhas em branco no fim da folha sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "4", obs: "Livro de Cozinha (cozinha-abr-2026.pdf), pag. 2: linha 14 em branco no fim sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "5", obs: "Livro de Espaço Infantil (espBiblicoInfantil-abr-2026.pdf), pag. 2: linhas em branco no fim sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "6", obs: "Livro de Grupo Musical (grupoMusical-abr-2026.pdf), pag. 1: linhas em branco no fim sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "7", obs: "Livro de Limpeza (limpeza-abr-2026.pdf), pag. 3: linhas em branco no fim sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "8", obs: "Livro de Limpeza (limpeza-abr-2026.pdf), pag. 4: linhas em branco no fim sem anulação." },
  { cod: 304, data: "30/04/2026", doc: "9", obs: "Livro de Limpeza (limpeza-abr-2026.pdf), pag. 5: linhas em branco no fim sem anulação." },
  { cod: 272, data: "30/04/2026", doc: "1", obs: "Formulário mensal do Fundo Bíblico (EST04102) gerado e assinado com a competência incorreta de 05/2026." },
  { cod: 281, data: "10/04/2026", doc: "1", obs: "Livro de Limpeza, pag. 4, dia 10/04: entradas fora de ordem cronológica (entradas as 07:30, 07:50 e 07:35 registradas após 09:05)." },
  { cod: 281, data: "17/04/2026", doc: "2", obs: "Livro de Limpeza, pag. 4, dia 17/04: entradas fora de ordem cronológica (entradas as 07:30, 07:30 e 07:45 registradas após 07:40 e 09:40)." },
  { cod: 281, data: "24/04/2026", doc: "3", obs: "Livro de Limpeza, pag. 5, dia 24/04: entrada fora de ordem cronológica (entrada as 07:55 registrada após 07:59)." },
  { cod: 280, data: "04/04/2026", doc: "1", obs: "Livro Cozinha, pag. 1, dia 04/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "04/04/2026", doc: "2", obs: "Livro Cozinha, pag. 1, dia 04/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "04/04/2026", doc: "3", obs: "Livro Cozinha, pag. 1, dia 04/04: campo Código da Função não preenchido. Voluntária Elaine de Paula Contratesi." },
  { cod: 280, data: "08/04/2026", doc: "4", obs: "Livro Cozinha, pag. 1, dia 08/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "08/04/2026", doc: "5", obs: "Livro Cozinha, pag. 1, dia 08/04: campo Código da Função não preenchido. Voluntária Elaine de Paula Contratesi." },
  { cod: 280, data: "10/04/2026", doc: "6", obs: "Livro Cozinha, pag. 1, dia 10/04: campo Código da Função não preenchido. Voluntária Terezinha L. de Matos." },
  { cod: 280, data: "10/04/2026", doc: "7", obs: "Livro Cozinha, pag. 1, dia 10/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "13/04/2026", doc: "8", obs: "Livro Cozinha, pag. 1, dia 13/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "14/04/2026", doc: "9", obs: "Livro Cozinha, pag. 1, dia 14/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "14/04/2026", doc: "10", obs: "Livro Cozinha, pag. 1, dia 14/04: campo Código da Função não preenchido. Voluntária Elaine de Paula Contratesi." },
  { cod: 280, data: "15/04/2026", doc: "11", obs: "Livro Cozinha, pag. 1, dia 15/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "15/04/2026", doc: "12", obs: "Livro Cozinha, pag. 1, dia 15/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "17/04/2026", doc: "13", obs: "Livro Cozinha, pag. 2, dia 17/04: campo Código da Função não preenchido. Voluntária Elaine Contratesi." },
  { cod: 280, data: "18/04/2026", doc: "14", obs: "Livro Cozinha, pag. 2, dia 18/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "18/04/2026", doc: "15", obs: "Livro Cozinha, pag. 2, dia 18/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "22/04/2026", doc: "16", obs: "Livro Cozinha, pag. 2, dia 22/04: campo Código da Função não preenchido. Voluntária Elaine Contratesi." },
  { cod: 280, data: "22/04/2026", doc: "17", obs: "Livro Cozinha, pag. 2, dia 22/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "25/04/2026", doc: "18", obs: "Livro Cozinha, pag. 2, dia 25/04: campo Código da Função não preenchido. Voluntária Elaine Contratesi." },
  { cod: 280, data: "25/04/2026", doc: "19", obs: "Livro Cozinha, pag. 2, dia 25/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "25/04/2026", doc: "20", obs: "Livro Cozinha, pag. 2, dia 25/04: campo Código da Função não preenchido. Voluntária Maria Ap. Damasceno." },
  { cod: 280, data: "28/04/2026", doc: "21", obs: "Livro Cozinha, pag. 2, dia 28/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "28/04/2026", doc: "22", obs: "Livro Cozinha, pag. 2, dia 28/04: campo Código da Função não preenchido. Voluntária Gloria Lopes." },
  { cod: 280, data: "28/04/2026", doc: "23", obs: "Livro Cozinha, pag. 2, dia 28/04: campo Código da Função não preenchido. Voluntária Elaine de Paula Contratesi." },
  { cod: 280, data: "29/04/2026", doc: "24", obs: "Livro Cozinha, pag. 2, dia 29/04: campo Código da Função não preenchido. Voluntária Terezinha L. Matos." },
  { cod: 280, data: "29/04/2026", doc: "25", obs: "Livro Cozinha, pag. 2, dia 29/04: campo Código da Função não preenchido. Voluntária Elaine de Paula Contratesi." }
];

async function run() {
  const controller = new SigaController(WORKSPACE_PATH, HISTORY_FILE);
  console.log(`Initializing browser and session verification...`);
  
  const hasSession = await controller.browser.hasValidSession(true);
  if (!hasSession) {
    throw new Error("Sessão inválida ou expirada. Por favor, faça o login novamente.");
  }
  
  console.log(`Starting to insert ${APONTAMENTOS.length} items for verification ${VERIFICATION_ID}...`);
  
  // Sincronizar catálogo
  await controller.salvarListaItensDoErp(24);
  
  for (let i = 0; i < APONTAMENTOS.length; i++) {
    const item = APONTAMENTOS[i];
    console.log(`[${i+1}/${APONTAMENTOS.length}] Inserting Code ${item.cod} on ${item.data} Doc ${item.doc}...`);
    try {
      const res = await controller.api.postItem(VERIFICATION_ID, item.cod, item.data, item.doc, item.obs);
      console.log(`   ✅ Success`);
    } catch (e) {
      console.error(`   ❌ Error on item ${i+1}: ${e.message}`);
    }
    // Pequeno atraso para evitar overload
    await new Promise(r => setTimeout(r, 200));
  }
  
  await controller.browser.close();
  console.log("All items inserted successfully.");
}

run().catch(console.error);
