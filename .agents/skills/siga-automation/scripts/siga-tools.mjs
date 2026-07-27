import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';
import { SigaController } from './controllers/siga-controller.mjs';
import { parseBatchCliFlags } from './lib/inserir-itens-batch.mjs';

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
    case "preflight": {
      const force = args.includes("--force=true");
      const { runPreflightSync } = await import("./lib/preflight-sync.mjs");
      result = await runPreflightSync({ force });
      break;
    }
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
    case "verificar-sessao-co": {
      const [localidadeSess, compSess] = args.filter(argSemFlag);
      result = await controller.verificarSessaoCo(localidadeSess, compSess, isVisible);
      break;
    }
    case "extrair-dados": {
      const [idExtrair, localidadeExtrair, compExtrair] = args;
      result = await controller.extrairDados(idExtrair, localidadeExtrair, compExtrair, isVisible);
      break;
    }
    case "baixar-depositos-despesas": {
      const limparLocal = args.includes("--limpar-local=true");
      const pos = args.filter(
        (a) => a !== "--visivel=true" && a !== "--limpar-local=true"
      );
      const [localidadeBs, compBs] = pos;
      result = await controller.baixarDepositosDespesas(localidadeBs, compBs, {
        isVisible,
        limparLocal
      });
      break;
    }
    case "validar-voluntarios": {
      const [localidadeVol, compVol] = args.filter(argSemFlag);
      result = await controller.validarVoluntarios(localidadeVol, compVol);
      break;
    }
    case "analisar-voluntarios": {
      const [localidadeAn, compAn] = args.filter(argSemFlag);
      result = await controller.analisarVoluntarios(localidadeAn, compAn);
      break;
    }
    case "baixar-voluntarios": {
      const [localidadeBv, compBv] = args.filter(argSemFlag);
      result = await controller.baixarVoluntarios(localidadeBv, compBv, { isVisible });
      break;
    }
    case "inserir-item": {
      const [idInserir, codigo, data, doc, obs] = args.filter(argSemFlag);
      result = await controller.inserirItem(idInserir, codigo, data, doc, obs);
      break;
    }
    case "inserir-itens-batch": {
      const { flags, positional } = parseBatchCliFlags(args);
      let codigoVerificacao = null;
      let arquivo = null;
      if (positional.length === 1) {
        arquivo = positional[0];
      } else if (positional.length >= 2) {
        codigoVerificacao = positional[0];
        arquivo = positional[1];
      }
      if (!arquivo) {
        throw new Error(
          'Uso: inserir-itens-batch [<idVerificacao>] <arquivo.json|ndjson> [--autorizado=true] [--dry-run=true] [--min-conviccao=95] [--regra=29.08,29.09] [--continue-on-error=true] [--delay-ms=150] [--from=0] [--log=caminho]'
        );
      }
      result = await controller.inserirItensBatch(arquivo, {
        codigoVerificacao,
        dryRun: flags.dryRun,
        continueOnError: flags.continueOnError,
        delayMs: flags.delayMs,
        from: flags.from,
        log: flags.log,
        autorizado: flags.autorizado,
        minConviccao: flags.minConviccao,
        maxConviccao: flags.maxConviccao,
        regras: flags.regras,
        statusIncluir: flags.statusIncluir,
        statusExcluir: flags.statusExcluir,
        incluirSegurados: flags.incluirSegurados,
        exigirConviccao: flags.exigirConviccao,
        exigirRegra: flags.exigirRegra,
      });
      break;
    }
    case "validar-lote": {
      const { flags, positional } = parseBatchCliFlags(args);
      let codigoVerificacao = null;
      let arquivo = null;
      if (positional.length === 1) {
        arquivo = positional[0];
      } else if (positional.length >= 2) {
        codigoVerificacao = positional[0];
        arquivo = positional[1];
      }
      if (!arquivo) {
        throw new Error(
          'Uso: validar-lote [<idVerificacao>] <arquivo.json|ndjson> [--min-conviccao=95] [--regra=29.08] [--export=saida.json] [--exigir-conviccao] [--exigir-regra]'
        );
      }
      result = await controller.validarLote(arquivo, {
        codigoVerificacao,
        minConviccao: flags.minConviccao,
        maxConviccao: flags.maxConviccao,
        regras: flags.regras,
        statusIncluir: flags.statusIncluir,
        statusExcluir: flags.statusExcluir,
        incluirSegurados: flags.incluirSegurados,
        exigirConviccao: flags.exigirConviccao,
        exigirRegra: flags.exigirRegra,
        exportPath: flags.exportPath,
      });
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
      const urlLike = args.find(
        (a) => String(a).startsWith("http") || String(a).includes("VER00207.aspx")
      );
      const pick = (prefix) => {
        const p = args.find((a) => a.startsWith(prefix));
        return p ? p.slice(prefix.length) : null;
      };
      const positional = args.filter(
        (a) =>
          a !== "--visivel=true" &&
          !a.startsWith("--est=") &&
          !a.startsWith("--data=") &&
          !a.startsWith("--tipo=") &&
          a !== urlLike
     );
      const [idRelatorio, localidadeRelatorio, compRelatorio] = positional;
      result = await controller.baixarRelatorio(
        idRelatorio,
        localidadeRelatorio,
        compRelatorio,
        urlLike || null,
        {
          codigoEstabelecimento: pick("--est="),
          dataRelatorio: pick("--data="),
          filtroTipoVerificacao: pick("--tipo=")
        }
      );
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
      console.error(
        JSON.stringify({
          success: false,
          error: `Comando desconhecido: ${command}`,
          comandos: [
            "preflight",
            "login",
            "sincronizar-lista-itens",
            "listar-verificacoes",
            "verificar-sessao-co",
            "iniciar-verificacao",
            "extrair-dados",
            "baixar-depositos-despesas",
            "baixar-voluntarios",
            "validar-voluntarios",
            "analisar-voluntarios",
            "render-pdf-png",
            "inserir-item",
            "inserir-itens-batch",
            "validar-lote",
            "atualizar-item",
            "excluir-item",
            "fechar-verificacao",
            "baixar-relatorio",
          ],
        })
      );
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
