import fs from "fs/promises";
import path from "path";
import { SigaBrowser } from '../lib/siga-browser.mjs';
import { SigaApi } from '../lib/siga-api.mjs';
import { SigaScraper } from '../lib/siga-scraper.mjs';
import { loadBatchFromFile, sleep, filterBatchItems, summarizeBatch, buildExportPayload } from '../lib/inserir-itens-batch.mjs';
import { analisarVoluntariosJson } from '../lib/analisar-voluntarios.mjs';

export class SigaController {
  constructor(workspacePath, historyFile) {
    this.workspacePath = workspacePath;
    this.historyFile = historyFile;
    const sessionDir = path.join(workspacePath, ".siga_session");
    
    this.browser = new SigaBrowser(sessionDir);
    this.api = new SigaApi(this.browser);
    this.scraper = new SigaScraper(this.browser);
  }

  /** `works/../config/lista-item-verificacao.json` (raiz da skill com cwd na skill). */
  _configListaItensFilePath() {
    return path.join(this.workspacePath, "..", "config", "lista-item-verificacao.json");
  }

  /**
   * Baixa o catálogo do ERP e grava `config/lista-item-verificacao.json`.
   * Sessão válida (JWT/cookies) obrigatória. Não fecha o browser.
   */
  async salvarListaItensDoErp(codigoDepartamento = 24) {
    const bruto = await this.api.getListaItemVerificacao(codigoDepartamento);
    const list = SigaApi.normalizarRespostaListaItens(bruto);
    const p = this._configListaItensFilePath();
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(list, null, 2), "utf8");
    return { list, path: p, total: list.length, codigoDepartamento };
  }

  /**
   * Comando dedicado: sincronizar e, ao final, fechar browser se headless.
   */
  async sincronizarListaItens(codigoDepartamento = 24, isVisible = true) {
    if (!(await this.browser.hasValidSession(!isVisible))) {
      throw new Error("Sessão inválida. Por favor, execute o comando 'login' primeiro.");
    }
    const { list, path: arquivo, total, codigoDepartamento: dep } = await this.salvarListaItensDoErp(
      codigoDepartamento
    );
    if (!isVisible) await this.browser.close();
    return {
      success: true,
      message: `Catálogo salvo: ${total} itens (departamento ${dep}).`,
      total,
      codigoDepartamento: dep,
      arquivo
    };
  }

  async login(isVisible) {
    await this.browser.init(!isVisible);
    const success = await this.browser.executeLogin();
    if (success) {
      // Não fechamos aqui para permitir que o estado seja consolidado e o usuário veja o sucesso
      return { success: true, message: "Login realizado com sucesso e sessão persistida." };
    } else {
      await this.browser.close();
      throw new Error("Falha no login manual ou timeout.");
    }
  }

  async listarVerificacoes(setor, competencia, isVisible = true) {
    const valid = await this.browser.hasValidSession(!isVisible);
    if (!valid) throw new Error("Sessão inválida. Por favor, execute o comando 'login' primeiro.");
    await this.salvarListaItensDoErp(24);
    const result = await this.api.listVerifications(setor, competencia);
    if (!isVisible) await this.browser.close();
    return { success: true, pendencias: result.dados || [], total: result.totalRegistros };
  }

  async iniciarVerificacao(idIniciar, dataInicio, isVisible = true) {
    if (!(await this.browser.hasValidSession(!isVisible))) throw new Error("Sessão inválida.");
    await this.salvarListaItensDoErp(24);
    const result = await this.api.startVerification(idIniciar, dataInicio);
    if (!isVisible) await this.browser.close();
    return { success: true, message: `Verificacao ${idIniciar} iniciada.`, data: result };
  }

  async extrairDados(idExtrair, localidadeExtrair, compExtrair, isVisible = true) {
     if (!localidadeExtrair || !compExtrair) {
       throw new Error("Para extrair dados do fechamento, informe: extrair-dados <id> <localidade> <competencia>.");
     }
     
     if (!(await this.browser.hasValidSession(!isVisible))) throw new Error("Sessão inválida.");
     await this.salvarListaItensDoErp(24);
     // Para a etapa de extração (Scraper), precisamos deixar a página aberta
     await this.browser.init(!isVisible);
     
     // Recria o scraper com a page injetada
     this.scraper.page = this.browser.page;

     const [mes, ano] = compExtrair.split("/");
     const compFormatted = `${mes.padStart(2, "0")}/${ano}`;
     this.scraper.workingCompetencia = compFormatted;

     // 1. Trocar o estabelecimento para a CO (Casa de Oração) via interface web
     // Extrair o nome curto da localidade (ex: "PEDREIRA" de "BR 21-0198 - PEDREIRA - SANTO AMARO")
     const parts = localidadeExtrair.split(" - ");
     const nomeLocalidade = parts.length >= 2 ? parts[1].trim() : localidadeExtrair;
     
     // fullLocalidade receives the EXACT dropdown text like "BR 21-0934 - PARAISÓPOLIS - MORUMBI"
     const fullLocalidade = await this.scraper.switchEstablishment(nomeLocalidade);

      // 2. Buscar o GUID do fechamento da competência na tela TES01401
     const closing = await this.scraper.loadClosingData(compFormatted);
     
     if (!closing || !closing.codigo) {
       await this.browser.close();
       throw new Error(`GUID do fechamento não encontrado para ${compFormatted}. Verifique se a competência está correta e se há um fechamento lançado.`);
     }

     const closingGuid = closing.codigo;
     console.error(`[SIGA Controller] GUID do fechamento: ${closingGuid}`);

     // 3. Extrair dados com o GUID real
     const competenciaDir = `${ano}-${mes.padStart(2, "0")}`;
     const workDir = path.join(this.workspacePath, fullLocalidade, competenciaDir);
     await fs.mkdir(workDir, { recursive: true });

    await this.scraper.scrapeClosingData(workDir, closingGuid);
    await this.scraper.downloadMaintenance(workDir, compFormatted, closingGuid);
    await this.scraper.switchEstablishment(nomeLocalidade);
    await this.scraper.downloadDeposits(workDir, compFormatted);
    await this.scraper.switchEstablishment(nomeLocalidade);
    await this.scraper.downloadExpenses(workDir, compFormatted);
     await this.scraper.downloadVolunteers(workDir, compFormatted, nomeLocalidade);

     if (!isVisible) {
       await this.browser.close();
     } else {
       console.error("[SIGA Controller] O navegador será mantido aberto (modo visível). Pressione Ctrl+C ou feche a janela.");
     }
     return { success: true, message: "Extração de todos os dados concluída.", diretorio: workDir };
  }

  /**
   * Volta ao contexto da CO e rebaixa apenas TES00601 / TES00801 (anexos isolados).
   * Útil quando a sessão/grid cruzou dados de outro estabelecimento.
   */
  async baixarDepositosDespesas(localidadeExtrair, competenciaExtrair, opts = {}) {
    const { isVisible = false, limparLocal = false } = opts || {};
    if (!localidadeExtrair || !competenciaExtrair) {
      throw new Error(
        "Uso: baixar-depositos-despesas <localidadeCompletaSIGA> <MM/AAAA> [--visivel=true] [--limpar-local=true]"
      );
    }

    if (!(await this.browser.hasValidSession(!isVisible))) throw new Error("Sessão inválida.");
    await this.browser.init(!isVisible);
    this.scraper.page = this.browser.page;

    const parts = localidadeExtrair.split(" - ");
    const nomeLocalidade = parts.length >= 2 ? parts[1].trim() : localidadeExtrair.trim();

    const [mes, ano] = competenciaExtrair.split("/");
    const compFormatted = `${mes.padStart(2, "0")}/${ano}`;
    const competenciaDir = `${ano}-${mes.padStart(2, "0")}`;
    this.scraper.workingCompetencia = compFormatted;

    const fullLocalidade = await this.scraper.switchEstablishment(nomeLocalidade);
    const workDir = path.join(this.workspacePath, fullLocalidade, competenciaDir);
    await fs.mkdir(workDir, { recursive: true });

    const depDir = path.join(workDir, "Depositos");
    const desDir = path.join(workDir, "Despesas");
    if (limparLocal) {
      await fs.rm(depDir, { recursive: true, force: true });
      await fs.rm(desDir, { recursive: true, force: true });
    }

    await this.scraper.switchEstablishment(nomeLocalidade);
    await this.scraper.downloadDeposits(workDir, compFormatted);

    await this.scraper.switchEstablishment(nomeLocalidade);
    await this.scraper.downloadExpenses(workDir, compFormatted);

    if (!isVisible) await this.browser.close();

    return {
      success: true,
      message: "Anexos TES.Deposito e TES.Despesa re-download concluído.",
      diretorio: workDir,
      depositos: depDir,
      despesas: desDir,
      limparLocal
    };
  }

  /**
   * Pré-voo: CO + Mês de Trabalho + amostra RH00401 antes de `extrair-dados`.
   * Evita extração com sessão em competência errada (ex.: 05/2026 × auditoria 03/2026).
   */
  async verificarSessaoCo(localidade, competencia, isVisible = true) {
    if (!localidade || !competencia) {
      throw new Error(
        'Uso: verificar-sessao-co "<localidade completa ou trecho>" "<MM/AAAA>"'
      );
    }
    if (!(await this.browser.hasValidSession(!isVisible))) {
      throw new Error("Sessão inválida. Execute 'login' primeiro.");
    }

    const [mes, ano] = competencia.split("/");
    if (!mes || !ano) {
      throw new Error("Competência inválida. Use MM/AAAA.");
    }
    const compFormatted = `${mes.padStart(2, "0")}/${ano}`;
    const sufixoData = `${mes.padStart(2, "0")}/${String(ano).slice(-2)}`;

    await this.browser.init(!isVisible);
    this.scraper.page = this.browser.page;
    this.scraper.workingCompetencia = compFormatted;

    const parts = localidade.split(" - ");
    const nomeLocalidade = parts.length >= 2 ? parts[1].trim() : localidade.trim();

    const mesAntes = await this.scraper.readWorkingMonthSession();
    const codigoCompetencia = await this.scraper.resolveCompetenciaCodigo(compFormatted);
    const rh010All = await this.scraper.fetchRh010Competencias();
    const rh010Competencia = (rh010All || []).find(
      (c) =>
        String(c.nomeExibicaoCompetencia || "").trim().toLowerCase() ===
        compFormatted.toLowerCase()
    );
    const rh010Localidade = this.scraper.filterRh010ByLocalidade(rh010All, nomeLocalidade);

    const estabelecimento = await this.scraper.switchEstablishment(nomeLocalidade);
    const mesDepois = await this.scraper.readWorkingMonthSession();
    const rh004 = await this.scraper.probeRh00401Grid();

    const datasFora = (rh004.datas || []).filter(
      (d) => d && !d.includes(sufixoData)
    );
    const amostraDatas = (rh004.datas || []).slice(0, 8);

    const mesOk =
      String(mesDepois.competenciasDados?.nome || "").trim() === compFormatted ||
      String(mesDepois.selectText || "").trim() === compFormatted;

    const avisos = [];
    if (
      mesDepois.selectText &&
      String(mesDepois.selectText).trim() !== compFormatted &&
      mesOk
    ) {
      avisos.push(
        `Select visível (${mesDepois.selectText}) difere de competenciasDados (${compFormatted}); confiar nas datas RH00401.`
      );
    }

    const problemas = [];
    if (!codigoCompetencia) {
      problemas.push(`codigoCompetencia não encontrado na API RH010 para ${compFormatted}.`);
    }
    if (!mesOk) {
      problemas.push(
        `Mês de Trabalho da sessão não é ${compFormatted} (obtido: ${mesDepois.competenciasDados?.nome || mesDepois.selectText || "?" }).`
      );
    }
    if (rh004.totalLinhas > 0 && datasFora.length > 0) {
      problemas.push(
        `${datasFora.length} data(s) em RH00401 fora de */${sufixoData} (ex.: ${datasFora.slice(0, 3).join(", ")}).`
      );
    }
    if (rh004.totalLinhas === 0) {
      problemas.push("RH00401 sem linhas — pode ser CO errada ou competência vazia.");
    }

    const ok = problemas.length === 0;

    if (!isVisible) await this.browser.close();

    return {
      success: true,
      ok,
      competenciaEsperada: compFormatted,
      sufixoDataEsperado: sufixoData,
      codigoCompetencia: codigoCompetencia || null,
      estabelecimento,
      filtroLocalidade: nomeLocalidade,
      mesTrabalho: {
        antes: mesAntes,
        depois: mesDepois,
        alterado: JSON.stringify(mesAntes) !== JSON.stringify(mesDepois),
      },
      rh010: {
        competencia: rh010Competencia
          ? {
              codigoCompetencia: rh010Competencia.codigoCompetencia,
              nomeExibicaoCompetencia: rh010Competencia.nomeExibicaoCompetencia,
              status: rh010Competencia.nomeStatus || rh010Competencia.status,
            }
          : null,
        localidadesNaCompetencia: rh010Localidade.length,
        amostraLocalidades: rh010Localidade.slice(0, 3).map((r) => r.nomeExibicaoLocalidade),
      },
      rh00401: {
        totalLinhas: rh004.totalLinhas,
        amostraDatas,
        datasForaCompetencia: datasFora.length,
        exemplosFora: datasFora.slice(0, 5),
      },
      problemas,
      avisos,
      message: ok
        ? `Sessão OK para ${estabelecimento} em ${compFormatted} (${rh004.totalLinhas} linhas RH00401).`
        : `Sessão NÃO confere: ${problemas.join(" ")}`,
    };
  }

  _pathDadosVoluntarios(localidade, competencia) {
    const [mes, ano] = competencia.split("/");
    const compFormatted = `${ano}-${mes.padStart(2, "0")}`;
    return path.join(
      this.workspacePath,
      localidade,
      compFormatted,
      "Voluntarios",
      "dados_voluntarios.json"
    );
  }

  async validarVoluntarios(localidade, competencia) {
    if (!localidade || !competencia) {
      throw new Error("Informe a localidade e a competencia. Ex: validar-voluntarios \"BR 21-0173...\" \"01/2026\"");
    }
    const filePath = this._pathDadosVoluntarios(localidade, competencia);
    
    try {
      const content = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(content);
      
      const groupedByData = {};
      data.forEach((line) => {
        const livro = line.voluntario || "Desconhecido";
        const key = `${livro} | ${line.dataRegistro}`;
        if (!groupedByData[key]) groupedByData[key] = { entradas: [], saidas: [] };
        groupedByData[key].entradas.push(line.entrada);
        groupedByData[key].saidas.push(line.saida);
      });

      const repeticoes = [];
      Object.entries(groupedByData).forEach(([key, val]) => {
        const countsEntrada = {};
        const countsSaida = {};
        val.entradas.forEach(h => { countsEntrada[h] = (countsEntrada[h] || 0) + 1; });
        val.saidas.forEach(h => { countsSaida[h] = (countsSaida[h] || 0) + 1; });
        
        Object.entries(countsEntrada).forEach(([horario, count]) => {
          if (count > 3) repeticoes.push({ chave: key, tipo: "Entrada", horario, ocorrencias: count, item: "29.09" });
        });
        Object.entries(countsSaida).forEach(([horario, count]) => {
          if (count > 3) repeticoes.push({ chave: key, tipo: "Saída", horario, ocorrencias: count, item: "29.09" });
        });
      });

      return {
        success: true,
        message: repeticoes.length > 0 ? "Repetições encontradas (+4x)" : "Nenhuma repetição >3x encontrada.",
        repeticoes,
        nota: "Só repetição 29.09. Prefira analisar-voluntarios para 29.08/29.09/29.10; PDF obrigatório para 29.11/29.14."
      };
    } catch (e) {
      throw new Error(`Erro ao validar voluntários: Arquivo não encontrado ou não foi possível ler os dados em ${filePath}`);
    }
  }

  /**
   * Análise ampla offline do JSON de voluntários (29.08 / 29.09 / 29.10).
   * Não substitui leitura visual do PDF (29.11, 29.14, ordem no livro, 07.01).
   */
  async analisarVoluntarios(localidade, competencia) {
    if (!localidade || !competencia) {
      throw new Error(
        'Uso: analisar-voluntarios "<localidade>" "MM/AAAA"'
      );
    }
    const filePath = this._pathDadosVoluntarios(localidade, competencia);
    let data;
    try {
      data = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      throw new Error(`dados_voluntarios.json não encontrado em ${filePath}`);
    }
    const analise = analisarVoluntariosJson(data, competencia);
    return {
      success: true,
      arquivo: filePath,
      ...analise,
    };
  }

  /**
   * Rebaixa só anexos GED de voluntários (RH) para a CO/competência.
   */
  async baixarVoluntarios(localidadeExtrair, competenciaExtrair, opts = {}) {
    const { isVisible = false } = opts || {};
    if (!localidadeExtrair || !competenciaExtrair) {
      throw new Error(
        'Uso: baixar-voluntarios "<localidadeCompletaSIGA>" "MM/AAAA" [--visivel=true]'
      );
    }

    if (!(await this.browser.hasValidSession(!isVisible))) {
      throw new Error("Sessão inválida. Execute 'login' primeiro.");
    }
    await this.browser.init(!isVisible);
    this.scraper.page = this.browser.page;

    const parts = localidadeExtrair.split(" - ");
    const nomeLocalidade = parts.length >= 2 ? parts[1].trim() : localidadeExtrair.trim();
    const [mes, ano] = competenciaExtrair.split("/");
    const compFormatted = `${mes.padStart(2, "0")}/${ano}`;
    const competenciaDir = `${ano}-${mes.padStart(2, "0")}`;
    this.scraper.workingCompetencia = compFormatted;

    const fullLocalidade = await this.scraper.switchEstablishment(nomeLocalidade);
    const workDir = path.join(this.workspacePath, fullLocalidade, competenciaDir);
    await fs.mkdir(path.join(workDir, "Voluntarios"), { recursive: true });

    await this.scraper.downloadVolunteers(workDir, compFormatted, nomeLocalidade);

    if (!isVisible) await this.browser.close();

    return {
      success: true,
      message: "Anexos de voluntários re-download concluído.",
      diretorio: workDir,
      voluntarios: path.join(workDir, "Voluntarios"),
    };
  }

  async inserirItem(idInserir, codigo, data, doc, obs) {
     if (!(await this.browser.hasValidSession())) throw new Error("Sessão inválida.");
     const result = await this.api.postItem(idInserir, codigo, data, doc, obs);
     if (!this.browser.isVisible) await this.browser.close();
     return { success: true, message: `Ocorrência registrada no SIGA.`, data: result };
  }

  /**
   * Valida/resume um lote JSON (sem gravar no SIGA).
   * Útil antes de `inserir-itens-batch --min-conviccao=95`.
   */
  async validarLote(arquivo, options = {}) {
    const loaded = await loadBatchFromFile(
      arquivo,
      { codigoVerificacao: options.codigoVerificacao },
      {
        requireCodigo: options.requireCodigo !== false,
        requireRegra: Boolean(options.exigirRegra),
        requireConviccao: Boolean(options.exigirConviccao),
      }
    );

    const filtro = {
      minConviccao: options.minConviccao,
      maxConviccao: options.maxConviccao,
      regras: options.regras,
      statusIncluir: options.statusIncluir,
      statusExcluir: options.statusExcluir,
      incluirSegurados: Boolean(options.incluirSegurados),
    };

    const { selected, rejected } = filterBatchItems(loaded.itens, filtro);
    const resumo = summarizeBatch(loaded.itens);
    const resumoSelecionados = summarizeBatch(selected.map((s) => s.item));

    let exportPath = null;
    if (options.exportPath) {
      const payload = buildExportPayload(
        options.codigoVerificacao || loaded.codigoVerificacao,
        selected,
        { filtro, origem: loaded.path }
      );
      exportPath = path.resolve(options.exportPath);
      await fs.mkdir(path.dirname(exportPath), { recursive: true });
      await fs.writeFile(exportPath, JSON.stringify(payload, null, 2), "utf8");
    }

    return {
      success: true,
      message: `Lote: ${loaded.itens.length} item(ns); após filtro: ${selected.length} elegível(is), ${rejected.length} fora.`,
      arquivo: loaded.path,
      meta: loaded.meta || {},
      resumo,
      filtro,
      elegiveis: selected.length,
      foraDoFiltro: rejected.length,
      resumoElegiveis: resumoSelecionados,
      amostraElegiveis: selected.slice(0, 15).map(({ index, item }) => ({
        index,
        regra: item.regra,
        conviccao: item.conviccao,
        status: item.status,
        codigo: item.codigo,
        dataFato: item.dataFato,
        numeroDocumento: item.numeroDocumento,
        livro: item.livro,
        observacao: item.observacao?.slice(0, 120),
      })),
      amostraFora: rejected.slice(0, 15).map(({ index, reasons, item }) => ({
        index,
        reasons,
        regra: item.regra,
        conviccao: item.conviccao,
        status: item.status,
        observacao: item.observacao?.slice(0, 80),
      })),
      export: exportPath,
    };
  }

  /**
   * Insere vários apontamentos a partir de um ficheiro JSON/NDJSON.
   * Mantém a sessão aberta entre itens; fecha o browser no fim (headless).
   *
   * @param {string} arquivo Lote JSON/NDJSON
   * @param {object} options
   * @param {string|number} [options.codigoVerificacao] Override se o ficheiro não trouxer por item
   * @param {boolean} [options.dryRun]
   * @param {boolean} [options.continueOnError]
   * @param {number} [options.delayMs]
   * @param {number} [options.from] Índice 0-based sobre a lista **já filtrada**
   * @param {string|null} [options.log] Caminho de log (append)
   * @param {boolean} [options.autorizado] Obrigatório true (exceto dry-run) — gate humano da skill
   * @param {number} [options.minConviccao] Só lança itens com conviccao ≥ N
   * @param {number} [options.maxConviccao]
   * @param {string} [options.regras] Ex.: "29.08,29.09"
   * @param {boolean} [options.incluirSegurados]
   */
  async inserirItensBatch(arquivo, options = {}) {
    const dryRun = Boolean(options.dryRun);
    const continueOnError = Boolean(options.continueOnError);
    const delayMs = options.delayMs != null ? Number(options.delayMs) : 150;
    const from = options.from != null ? Math.max(0, Number(options.from) || 0) : 0;
    const logPath = options.log || null;
    const autorizado = Boolean(options.autorizado);

    if (!dryRun && !autorizado) {
      throw new Error(
        "inserir-itens-batch exige --autorizado=true (confirmação explícita do analista no chat) ou use --dry-run=true."
      );
    }

    const loaded = await loadBatchFromFile(
      arquivo,
      { codigoVerificacao: options.codigoVerificacao },
      {
        requireCodigo: true,
        requireRegra: Boolean(options.exigirRegra),
        requireConviccao: Boolean(options.exigirConviccao),
      }
    );

    const filtro = {
      minConviccao: options.minConviccao,
      maxConviccao: options.maxConviccao,
      regras: options.regras,
      statusIncluir: options.statusIncluir,
      statusExcluir: options.statusExcluir,
      incluirSegurados: Boolean(options.incluirSegurados),
    };
    const { selected, rejected } = filterBatchItems(loaded.itens, filtro);
    const itens = selected.map((s) => s.item);

    if (itens.length === 0) {
      return {
        success: true,
        message: "Nenhum item elegível após o filtro (nada lançado).",
        dryRun,
        arquivo: loaded.path,
        totalArquivo: loaded.itens.length,
        foraDoFiltro: rejected.length,
        filtro,
        total: 0,
        ok: 0,
        fail: 0,
        skipped: 0,
        resultados: [],
      };
    }

    if (from >= itens.length) {
      throw new Error(
        `--from=${from} está além do lote filtrado (elegíveis=${itens.length}, arquivo=${loaded.itens.length}).`
      );
    }

    const appendLog = async (line) => {
      if (!logPath) return;
      const abs = path.resolve(logPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.appendFile(abs, `${line}\n`, "utf8");
    };

    await appendLog(
      `${new Date().toISOString()} START file=${loaded.path} arquivo=${loaded.itens.length} elegiveis=${itens.length} rejected=${rejected.length} from=${from} dryRun=${dryRun} filtro=${JSON.stringify(filtro)}`
    );

    if (!dryRun) {
      if (!(await this.browser.hasValidSession())) {
        throw new Error("Sessão inválida.");
      }
    }

    const resultados = [];
    let ok = 0;
    let fail = 0;
    let skipped = from;

    for (let i = from; i < itens.length; i++) {
      const it = itens[i];
      const label = `[${i + 1}/${itens.length}] verif=${it.codigoVerificacao} regra=${it.regra || "?"} conv=${it.conviccao ?? "?"} codigo=${it.codigo} data=${it.dataFato} doc=${it.numeroDocumento}`;
      process.stderr.write(`${label} ... `);

      if (dryRun) {
        process.stderr.write("DRY-RUN\n");
        ok++;
        resultados.push({ index: i, success: true, dryRun: true, item: it });
        await appendLog(`DRY-RUN ${label}`);
        continue;
      }

      try {
        const data = await this.api.postItem(
          it.codigoVerificacao,
          it.codigo,
          it.dataFato,
          it.numeroDocumento,
          it.observacao
        );
        process.stderr.write("OK\n");
        ok++;
        resultados.push({
          index: i,
          success: true,
          item: {
            codigoVerificacao: it.codigoVerificacao,
            codigo: it.codigo,
            regra: it.regra,
            conviccao: it.conviccao,
            dataFato: it.dataFato,
            numeroDocumento: it.numeroDocumento,
          },
          data,
        });
        await appendLog(`OK ${label}`);
      } catch (e) {
        fail++;
        const errMsg = e?.message || String(e);
        process.stderr.write(`FAIL ${errMsg}\n`);
        resultados.push({
          index: i,
          success: false,
          item: {
            codigoVerificacao: it.codigoVerificacao,
            codigo: it.codigo,
            regra: it.regra,
            conviccao: it.conviccao,
            dataFato: it.dataFato,
            numeroDocumento: it.numeroDocumento,
          },
          error: errMsg,
        });
        await appendLog(`FAIL ${label} :: ${errMsg}`);
        if (!continueOnError) {
          if (!this.browser.isVisible) await this.browser.close();
          return {
            success: false,
            message: `Lote interrompido no item ${i + 1}/${itens.length} (elegíveis).`,
            arquivo: loaded.path,
            totalArquivo: loaded.itens.length,
            foraDoFiltro: rejected.length,
            filtro,
            total: itens.length,
            from,
            ok,
            fail,
            skipped,
            resultados,
          };
        }
      }

      if (delayMs > 0 && i < itens.length - 1) {
        await sleep(delayMs);
      }
    }

    if (!dryRun && !this.browser.isVisible) {
      await this.browser.close();
    }

    await appendLog(
      `${new Date().toISOString()} DONE ok=${ok} fail=${fail} skipped=${skipped} rejected=${rejected.length}`
    );

    return {
      success: fail === 0,
      message: dryRun
        ? `Dry-run: ${ok} item(ns) elegíveis validados (nenhum lançamento); ${rejected.length} fora do filtro.`
        : `Lote concluído: ${ok} ok, ${fail} falha(s); ${rejected.length} fora do filtro.`,
      dryRun,
      arquivo: loaded.path,
      totalArquivo: loaded.itens.length,
      foraDoFiltro: rejected.length,
      filtro,
      total: itens.length,
      from,
      ok,
      fail,
      skipped,
      log: logPath ? path.resolve(logPath) : null,
      resultados,
    };
  }

  async atualizarItem(codigoApontamento, codigoVerificacao, codigoItem, data, doc, obs, reincidencia) {
     if (!(await this.browser.hasValidSession())) throw new Error("Sessão inválida.");
     const r = reincidencia == null || reincidencia === "" ? "false" : reincidencia;
     const result = await this.api.putAtualizarApontamento(
       codigoApontamento,
       codigoVerificacao,
       codigoItem,
       data,
       doc,
       obs,
       r
     );
     if (!this.browser.isVisible) await this.browser.close();
     return { success: true, message: `Apontamento atualizado no SIGA.`, data: result };
  }

  async excluirItem(codigoApontamento, codigoVerificacao) {
     if (!(await this.browser.hasValidSession())) throw new Error("Sessão inválida.");
     
     const itemBody = {
       codigo: parseInt(codigoApontamento),
       codigoVerificacao: parseInt(codigoVerificacao)
     };

     const result = await this.api.deleteItem(itemBody);
     if (!this.browser.isVisible) await this.browser.close();
     return { success: true, message: `Ocorrência excluída no SIGA.`, data: result };
  }

  async fecharVerificacao(idFechar) {
     if (!(await this.browser.hasValidSession())) throw new Error("Sessão inválida.");
     const data = await this.api.fecharVerificacao(idFechar);
     await this.browser.close();
     return {
       success: true,
       message: `Verificação ${idFechar} encerrada no SIGA.`,
       data,
       link: "https://siga.congregacao.org.br/relatorio"
     };
  }

  /**
   * VER00207 com os mesmos query params do browser; sem filtro de estabelecimento/tipo/localidade
   * o SIGA costuma devolver PDF/HTML sem linhas de apontamentos.
   *
   * Requisitos específicos do VER00207 (relatório de verificação):
   * - O contexto da sessão deve estar no SETOR (ex.: "DR - SETOR SANTO AMARO"), NÃO na CO.
   * - Mês de Trabalho deve estar correto para a competência da verificação.
   * - Usar filtroCodigoEstabelecimento (código numérico da CO, obtido via SIS99906 sem submit).
   * Trocar a sessão para a CO específica costuma fazer o relatório recusar com "não pode ser executado neste estabelecimento".
   */
  _resolveReportContextEstablishment(localidade) {
    const parts = String(localidade || "")
      .split(" - ")
      .map((p) => p.trim())
      .filter(Boolean);
    const setor = parts.length >= 3 ? parts[parts.length - 1] : null;
    if (!setor) {
      throw new Error(
        `Não foi possível inferir o setor a partir de "${localidade}". Use localidade completa (ex.: BR 21-0173 - CIDADE ADEMAR - SANTO AMARO).`
      );
    }
    // Correção: o contexto de setor para relatórios VER00207 (e edição de verificações)
    // usa o prefixo "SET -", não "DR -".
    // "DR - SETOR ..." pertence a outro departamento.
    // Exemplo correto: "SET - SANTO AMARO - SP" (visível na barra superior do SIGA).
    return `SET - ${setor} - SP`;
  }

  _montarUrlRelatorioVer00207({
    codigoVerificacao,
    filtroLocalidade,
    filtroTipoVerificacao,
    filtroCodigoEstabelecimento,
    dataDocumento = ""
  }) {
    const q = new URLSearchParams();
    const set = (k, v) => q.set(k, v == null ? "" : String(v));
    set("codigoVerificacao", codigoVerificacao);
    set("codigoDepartamento", "");
    set("codigoGrupo", "");
    set("data", dataDocumento);
    set("codigoSubGrupo", "");
    set("reincidencia", "");
    set("codigoItemVerificacao", "");
    set("FiltroItemVerificacao", "Todos");
    set("filtroTipoVerificacao", filtroTipoVerificacao);
    set("filtroLocalidade", filtroLocalidade);
    set("filtroGrupo", "Todos");
    set("filtroStatusVerificacao", "3");
    set("filtroReincidencia", "Todos");
    set("filtrosubgrupo", "Todos");
    set("filtroCodigoEstabelecimento", filtroCodigoEstabelecimento);
    set("filtroDepartamento", "Todos");
    return `https://siga.congregacao.org.br/ver/VER00207.aspx?${q.toString()}`;
  }

  /**
   * @param {string|null} urlCustomizada URL copiada do browser (recomendado) ou null
   * @param {{ codigoEstabelecimento?: string, dataRelatorio?: string, filtroTipoVerificacao?: string }} [opts] Para CO: informe codigoEstabelecimento do select de localidade no SIGA (ex. 12316 Cidade Ademar).
   */
  async baixarRelatorio(idVerificacao, localidade, competencia, urlCustomizada, opts = {}) {
     if (!idVerificacao || !localidade || !competencia) {
         throw new Error(
           "Parâmetros insuficientes: baixar-relatorio <id> <localidade> <competencia> [url] [--est=codigo] [--data=AAAA-MM-DD] [--tipo=...]"
         );
     }
     
     if (!(await this.browser.hasValidSession())) throw new Error("Sessão inválida.");
     
     const [mes, ano] = competencia.split("/");
     const compMmAaaa = `${mes.padStart(2, "0")}/${ano}`;
     const compDir = `${ano}-${mes.padStart(2, "0")}`;

     // Para interceptar download, headless puro ou interface devem escutar o evento
     await this.browser.init(true);
     const page = this.browser.page;
     this.scraper.page = page;

    const parts = localidade.split(" - ");
    const nomeLocalidade = parts.length >= 2 ? parts[1].trim() : localidade.trim();

    // VER00207 exige contexto de SETOR (ex.: "SET - SANTO AMARO - SP"), NÃO a CO individual.
    // Trocar a sessão para a CO específica costuma bloquear o relatório com "não pode ser executado neste estabelecimento".
    // A estratégia é: entrar no setor (prefixo SET -), definir Mês de Trabalho, depois usar o código numérico da CO via filtroCodigoEstabelecimento.
    const contextoSetor = this._resolveReportContextEstablishment(localidade);
    console.error(
      `[SIGA Controller] Pré-voo relatório: contexto ${contextoSetor} + Mês de Trabalho ${compMmAaaa}...`
    );

    this.scraper.workingCompetencia = compMmAaaa;

    // 1. Trocar para o contexto de setor (essencial para VER00207 e para relatórios de verificação)
    await this.scraper.switchEstablishment(contextoSetor);

    // 2. Garantir o Mês de Trabalho correto dentro desse contexto
    const mesAplicado = await this.scraper.switchWorkingMonth(compMmAaaa);
    if (!mesAplicado) {
      await this.browser.close();
      throw new Error(
        `Não foi possível definir Mês de Trabalho ${compMmAaaa} no contexto ${contextoSetor} para baixar o relatório.`
      );
    }

    const filtroLocalidade = localidade;

    // 3. Resolver o código numérico da CO (leitura only em SIS99906 — não submete troca de CO)
    const codigoEst =
      opts.codigoEstabelecimento ||
      (await this.scraper.resolveEstablishmentCode(localidade)) ||
      (await this.scraper.resolveEstablishmentCode(parts[0]?.trim())) ||
      (await this.scraper.resolveEstablishmentCode(nomeLocalidade));

     let url = urlCustomizada || null;
     if (!url && codigoEst) {
       const tipo =
         opts.filtroTipoVerificacao || "CONSELHO FISCAL | Aplicação MENSAL | CASA DE ORAÇÃO";
       const d = (opts.dataRelatorio || "").trim();
       const dataParam = d ? (d.includes("T") ? d : `${d}T00:00:00`) : "";
       url = this._montarUrlRelatorioVer00207({
         codigoVerificacao: idVerificacao,
         filtroLocalidade,
         filtroTipoVerificacao: tipo,
         filtroCodigoEstabelecimento: codigoEst,
         dataDocumento: dataParam
       });
     }
     if (!url) {
       console.error(
         "[SIGA Controller] Aviso: URL mínima — o PDF pode sair em branco. Use a URL completa do browser ou --est=<código da localidade no filtro>."
       );
       url = `https://siga.congregacao.org.br/ver/VER00207.aspx?codigoVerificacao=${idVerificacao}&FiltroItemVerificacao=Todos&filtroStatusVerificacao=3`;
     }

     const dir = path.join(this.workspacePath, localidade, compDir);
     await fs.mkdir(dir, { recursive: true });
     
     console.error("[SIGA Controller] Acessando URL do relatório...");
     console.error(`[SIGA Controller] URL: ${url}`);

     let filePath;
     const fileName = `Relatório CF - ${mes}-${ano} - ${localidade}.pdf`.replace(/\//g, "-");
     filePath = path.join(dir, fileName);

     const downloadPromise = page.waitForEvent("download", { timeout: 90000 });
     try {
       await page.goto(url, { waitUntil: "commit", timeout: 90000 });
     } catch (e) {
       if (!String(e.message || "").includes("Download is starting")) {
         throw e;
       }
       console.error("[SIGA Controller] O servidor iniciou a transferência do arquivo...");
     }

     const download = await downloadPromise.catch(() => null);
     if (download) {
       console.error(`[SIGA Controller] Salvando download em: ${filePath}`);
       await download.saveAs(filePath);
     } else {
       const html = await page.content();
      if (html.includes("não pode ser executado neste estabelecimento")) {
        await this.browser.close();
        throw new Error(
          "VER00207 recusou o contexto. O relatório exige: (1) sessão no contexto do SETOR (ex.: DR - SETOR SANTO AMARO), (2) Mês de Trabalho correto, e (3) filtroCodigoEstabelecimento da CO específica."
        );
      }
       const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null);
       const ct = response?.headers()?.["content-type"] || "";
       if (ct.includes("pdf") && response) {
         await fs.writeFile(filePath, await response.body());
       } else if (
         html.includes("VER00207") ||
         html.includes("Relatório") ||
         html.includes("codigoVerificacao")
       ) {
         console.error("[SIGA Controller] Gerando impressão estática PDF da página HTML...");
         await page.waitForTimeout(2000);
         await page.pdf({ path: filePath, format: "A4", printBackground: true });
       } else {
         await this.browser.close();
         throw new Error(
           "O SIGA não devolveu download PDF do relatório. Abra VER00207 no browser, copie a URL completa e passe como 4º argumento."
         );
       }
     }
     
     await this.browser.close();
     return { success: true, message: `Relatório gerado/baixado com sucesso!`, arquivo: filePath };
  }

  async atualizarHistorico(coHist, compHist) {
      let historico = [];
      try {
        const data = await fs.readFile(this.historyFile, "utf-8");
        historico = JSON.parse(data);
      } catch (e) {}
      historico.push({ co: coHist, competencia: compHist, date: new Date().toISOString() });
      await fs.writeFile(this.historyFile, JSON.stringify(historico, null, 2), "utf-8");
      return { success: true, message: `Histórico salvo para ${coHist}.` };
  }

  async listarHistorico() {
      try {
        const d = await fs.readFile(this.historyFile, "utf-8");
        return JSON.parse(d);
      } catch (e) {
        return [];
      }
  }
}
