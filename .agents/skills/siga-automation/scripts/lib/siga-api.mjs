export class SigaApi {
  constructor(browser) {
    this.browser = browser; // Instance of SigaBrowser
  }

  async fetchApi(url, method = "GET", body = null, authToken = null) {
    const cookies = await this.browser.getCookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    
    if (!this.browser.apiToken) {
       await this.browser.hasValidSession();
    }

    const headers = {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "Cookie": cookieString,
      "__antixsrftoken": this.browser.apiToken || ""
    };

    if (this.browser.jwtToken) {
       headers["Authorization"] = `Bearer ${this.browser.jwtToken}`;
    }

    if (authToken) {
      headers["Authorization"] = authToken;
    }

    const options = {
      method,
      headers
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`API Siga retornou status ${response.status} em ${url}`);
      }
      const text = await response.text();
      try { return JSON.parse(text); } catch(e) { return { text }; }
    } catch(e) {
      console.error("[SIGA API Error]", e.message);
      throw e;
    }
  }

  /**
   * Catálogo de itens de verificação (Conselho Fiscal) conforme o ERP.
   * GET lista-item-verificacao?codigoDepartamento= — padrão Conselho Fiscal: 24.
   */
  async getListaItemVerificacao(codigoDepartamento = 24) {
    const u = `https://siga-api.congregacao.org.br/api/ver/ver002/lista-item-verificacao?codigoDepartamento=${encodeURIComponent(String(codigoDepartamento))}`;
    return await this.fetchApi(u, "GET", null);
  }

  /** A API pode devolver array cru ou wrapper com { dados: [...] }. */
  static normalizarRespostaListaItens(resposta) {
    if (Array.isArray(resposta)) return resposta;
    if (resposta && Array.isArray(resposta.dados)) return resposta.dados;
    if (resposta && Array.isArray(resposta.itens)) return resposta.itens;
    throw new Error("Resposta inesperada de lista-item-verificacao: esperado array ou objeto com dados[]");
  }

  async listVerifications(setor, competencia) {
    let allVerifications = [];
    let paginaAtual = 0;
    const quantidadePorPagina = 100;
    const compQuery = competencia && competencia !== "null" ? encodeURIComponent(competencia.trim()) : "";
    
    while (paginaAtual < 50) {
      // Usamos status=null por padrão para trazer tudo, mas o usuário pode filtrar se a API aceitar múltiplos futuramente.
      const url = `https://siga-api.congregacao.org.br/api/ver/ver002/dados-tabela?paginaAtual=${paginaAtual}&quantidadePorPagina=${quantidadePorPagina}&pesquisaRapida=&codigoTipoVerificacao=&codigoEstabelecimento=&dataIni=&dataFin=&status=null&codigoCompetencia=${compQuery}&codigoDepartamento=null`;
      const result = await this.fetchApi(url);
      
      if (result && Array.isArray(result.dados)) {
        allVerifications = allVerifications.concat(result.dados);
        if (result.dados.length < quantidadePorPagina) {
          break;
        }
        paginaAtual++;
      } else {
        break;
      }
    }
    
    let dados = allVerifications;
    
    // Filtro por Setor/Região
    if (setor && setor !== "null") {
       const s = setor.toUpperCase();
       dados = dados.filter(d => 
         (d.nomeRegiao || "").toUpperCase().includes(s) || 
         (d.nomeSetor || "").toUpperCase().includes(s) ||
         (d.nomeEstabelecimento || "").toUpperCase().includes(s)
       );
    }

    // Filtro por Competência
    if (competencia && competencia !== "null") {
       dados = dados.filter(d => d.competencia === competencia);
    }

    return { dados, totalRegistros: dados.length };
  }

  async startVerification(codigoVerificacao, dataInicio) {
    const url = `https://siga-api.congregacao.org.br/api/ver/ver002/iniciar-verificacao?codigoVerificacao=${codigoVerificacao}&dataInicio=${dataInicio}`;
    return await this.fetchApi(url, "PUT", {});
  }

  /**
   * Encerra a verificação no SIGA (submissão final do auditor).
   * O path exato pode variar entre versões; tenta candidatos comuns.
   */
  async fecharVerificacao(codigoVerificacao) {
    const id = parseInt(String(codigoVerificacao), 10);
    if (Number.isNaN(id)) {
      throw new Error(`codigoVerificacao inválido: ${codigoVerificacao}`);
    }
    const bases = [
      "finalizar-verificacao",
      "encerrar-verificacao",
      "fechar-verificacao",
      "concluir-verificacao"
    ];
    let lastErr = null;
    for (const pathSuffix of bases) {
      const url = `https://siga-api.congregacao.org.br/api/ver/ver002/${pathSuffix}?codigoVerificacao=${id}`;
      try {
        return await this.fetchApi(url, "PUT", {});
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Não foi possível encerrar a verificação pela API.");
  }

  async postItem(codigoVerificacao, codigoItem, dataFato, documento, observacao) {
    const url = "https://siga-api.congregacao.org.br/api/ver/ver002/inserir-apontamento";
    const body = {
      codigoVerificacao: parseInt(codigoVerificacao),
      codigoItemVerificacao: parseInt(codigoItem),
      dataDocumento: this.formatDateForSiga(dataFato),
      numeroDocumento: documento || "",
      observacao: observacao,
      anexos: []
    };
    return await this.fetchApi(url, "POST", body);
  }

  /**
   * Atualiza apontamento existente (PUT). Mesmo corpo usado no modal "Editar" (VER00204) no front.
   * dataFato: DD/MM/AAAA; dataDocumento enviada como AAAA-MM-DDT00:00:00, como no app.
   */
  async putAtualizarApontamento(
    codigoApontamento,
    codigoVerificacao,
    codigoItemVerificacao,
    dataFato,
    numeroDocumento,
    observacao,
    reincidencia = "false"
  ) {
    const url = "https://siga-api.congregacao.org.br/api/ver/ver002/atualizar-apontamento";
    const r =
      reincidencia === true || reincidencia === "true"
        ? "true"
        : "false";
    const body = {
      codigo: parseInt(codigoApontamento, 10),
      codigoVerificacao: parseInt(codigoVerificacao, 10),
      codigoItemVerificacao: parseInt(codigoItemVerificacao, 10),
      reincidencia: r,
      dataDocumento: this.formatDataDocumentoComHorario(dataFato),
      numeroDocumento: numeroDocumento != null && numeroDocumento !== "" ? String(numeroDocumento) : "",
      observacao: observacao != null ? String(observacao) : "",
      anexos: []
    };
    return await this.fetchApi(url, "PUT", body);
  }

  async deleteItem(itemBody) {
    const url = "https://siga-api.congregacao.org.br/api/ver/ver002/excluir-apontamento";
    // O Siga usa PUT para "excluir" (marcar como excluído ou remover da lista ativa via payload completo)
    return await this.fetchApi(url, "PUT", itemBody);
  }

  formatDateForSiga(dateStr) {
    // Entrada: DD/MM/YYYY ou DD/MM/YY
    // Saída: YYYY-MM-DD
    if (!dateStr || !dateStr.includes("/")) return dateStr;
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      let year = parts[2];
      if (year.length === 2) year = "20" + year;
      return `${year}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
    return dateStr;
  }

  /** DD/MM/AAAA → AAAA-MM-DDTHH:mm:ss (meia-noite), alinhado ao payload do front na edição. */
  formatDataDocumentoComHorario(dateStr) {
    if (dateStr == null || String(dateStr).trim() === "") return dateStr;
    const s = String(dateStr);
    if (s.includes("T") && /^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
    const d = this.formatDateForSiga(s);
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T00:00:00`;
    return s;
  }
}
