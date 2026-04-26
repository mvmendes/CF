import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';
import { SigaController } from './controllers/siga-controller.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , command, ...args] = process.argv;

const WORKSPACE_PATH = path.resolve("works");
const HISTORY_FILE = path.join(WORKSPACE_PATH, "historico.json");

async function init() {
  await fs.mkdir(WORKSPACE_PATH, { recursive: true });
}

async function run() {
  await init();
  const controller = new SigaController(WORKSPACE_PATH, HISTORY_FILE);

  let result = null;

  const isVisible = args.includes("--visivel=true");
  const argSemFlag = (a) => a !== "--visivel=true";

  switch (command) {
    case "login": {
      result = await controller.login(isVisible);
      break;
    }
    case "sincronizar-lista-itens": {
      const [codDep] = args.filter(argSemFlag);
      const dep = codDep != null && codDep !== "" ? parseInt(codDep, 10) : 24;
      if (Number.isNaN(dep)) {
        throw new Error("codigoDepartamento inválido. Use 24 (Conselho Fiscal) ou outro numérico.");
      }
      result = await controller.sincronizarListaItens(dep, isVisible);
      break;
    }
    case "listar-verificacoes": {
      const [setor, competencia] = args;
      result = await controller.listarVerificacoes(setor, competencia, isVisible);
      break;
    }
    case "iniciar-verificacao": {
      const [idIniciar, dataInicio] = args;
      result = await controller.iniciarVerificacao(idIniciar, dataInicio, isVisible);
      break;
    }
    case "extrair-dados": {
      const [idExtrair, localidadeExtrair, compExtrair] = args;
      result = await controller.extrairDados(idExtrair, localidadeExtrair, compExtrair, isVisible);
      break;
    }
    case "validar-voluntarios": {
      const [localidadeVol, compVol] = args;
      result = await controller.validarVoluntarios(localidadeVol, compVol);
      break;
    }
    case "inserir-item": {
      const [idInserir, codigo, data, doc, obs] = args.filter(argSemFlag);
      result = await controller.inserirItem(idInserir, codigo, data, doc, obs);
      break;
    }
    case "atualizar-item": {
      const baseArgs = args.filter(argSemFlag);
      if (baseArgs.length < 6) {
        throw new Error(
          "Uso: atualizar-item <codigoApontamento> <codigoVerificacao> <codigoItemVerificacao> <dataDD/MM/AAAA> <numeroDocumento> <observacao> [reincidencia true|false]"
        );
      }
      const [codApont, idVer, codItem, data, doc, ...rest] = baseArgs;
      if (rest.length < 1) {
        throw new Error("Parâmetros insuficientes: informe observacao.");
      }
      let reincidencia = "false";
      let obsParts = [...rest];
      const last = obsParts[obsParts.length - 1];
      if (obsParts.length > 1 && (last === "true" || last === "false")) {
        reincidencia = last;
        obsParts = obsParts.slice(0, -1);
      }
      const obs = obsParts.join(" ");
      result = await controller.atualizarItem(codApont, idVer, codItem, data, doc, obs, reincidencia);
      break;
    }
    case "excluir-item": {
      const [codigoApontamento, codigoVerificacao] = args;
      result = await controller.excluirItem(codigoApontamento, codigoVerificacao);
      break;
    }
    case "fechar-verificacao": {
      const [idFechar] = args;
      result = await controller.fecharVerificacao(idFechar);
      break;
    }
    case "baixar-relatorio": {
      const [idRelatorio, localidadeRelatorio, compRelatorio, urlCustomizada] = args;
      result = await controller.baixarRelatorio(idRelatorio, localidadeRelatorio, compRelatorio, urlCustomizada);
      break;
    }
    case "atualizar-historico": {
      const [coHist, compHist] = args;
      result = await controller.atualizarHistorico(coHist, compHist);
      break;
    }
    case "listar-historico": {
      result = await controller.listarHistorico();
      break;
    }
    case "render-pdf-png": {
      const [pdfPath, pastaSaida] = args;
      if (!pdfPath) {
        throw new Error("Uso: render-pdf-png <caminhoPdf> [pastaSaida]");
      }
      const { renderPdfToPng } = await import("./lib/render-pdf-png.mjs");
      result = await renderPdfToPng(pdfPath, pastaSaida);
      break;
    }
    default:
      console.error(JSON.stringify({ success: false, error: `Comando desconhecido: ${command}` }));
      process.exit(1);
  }

  if (result) {
    console.log(JSON.stringify(result));
  }
}

run().catch(e => {
  console.error(JSON.stringify({ success: false, error: e.message || String(e) }));
  process.exit(1);
});
