import path from "path";
import fs from "fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "fs";

/**
 * SigaScraper - Replica a lógica comprovada do engine.js para coleta de dados.
 *
 * Pipeline baseado no runProcessor do motor legado:
 * 1. switchEstablishment → Troca unidade via Playwright (SIS99906.aspx)
 * 2. loadClosingData → Busca GUIDs de fechamento via TES01401.aspx (#grid1)
 * 3. downloadClosingAttachments → Lista anexos via ArquivoWS.asmx/Selecionar
 * 4. downloadFromGedByCodigo → Extrai URL+Auth do blob Azure via GED99901.aspx
 * 5. downloadMaintenance → Baixa anexos de manutenção
 * 6. downloadVolunteers → Baixa livros de voluntários
 *
 * Referência: flows/ver00201/fluxo_conselho_mensal.yaml
 */
export class SigaScraper {
  constructor(browser) {
    this.browser = browser; // Instance of SigaBrowser
    this.page = browser.page;
  }

  // ====================================================================
  // 1. TROCA DE ESTABELECIMENTO (SIS99906.aspx)
  // Baseado em: engine.js → simulateNavigationFlow + fallbackToPlaywright
  // ====================================================================
  async switchEstablishment(establishmentName) {
    console.error(`[SIGA Scraper] Trocando para CO: ${establishmentName}...`);
    
    await this.page.goto("https://siga.congregacao.org.br/SIS/SIS99906.aspx", { 
      waitUntil: "networkidle", timeout: 30000 
    });
    await this.page.waitForTimeout(2000);

    // Localizar o select de estabelecimento e selecionar a CO
    const selected = await this.page.evaluate((name) => {
      const selects = document.querySelectorAll("select");
      for (const sel of selects) {
        for (const opt of sel.options) {
          if (opt.text.toUpperCase().includes(name.toUpperCase())) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return { found: true, value: opt.value, text: opt.text.trim() };
          }
        }
      }
      return { found: false };
    }, establishmentName);

    if (!selected.found) {
      console.error(`[SIGA Scraper] ⚠️ CO "${establishmentName}" não encontrada nos selects. Tentando submit...`);
    } else {
      console.error(`[SIGA Scraper] ✅ Selecionado: ${selected.text}`);
    }

    // Aguardar que o formulário processe a mudança e o botão fique habilitado
    await this.page.waitForTimeout(2000);
    
    // Submeter o formulário (ASP.NET postback)
    const submitted = await this.page.evaluate(() => {
      // Tentar submit direto
      const form = document.querySelector("form");
      if (form) { form.submit(); return "form.submit"; }
      // Tentar __doPostBack
      if (typeof __doPostBack === "function") { __doPostBack("", ""); return "__doPostBack"; }
      return null;
    });
    
    if (submitted) {
      console.error(`[SIGA Scraper] Formulário submetido via: ${submitted}`);
      await this.page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    }
    
    await this.page.waitForTimeout(2000);
    console.error("[SIGA Scraper] Contexto de unidade alterado.");
    
    return selected.found ? selected.text : establishmentName;
  }

  // ====================================================================
  // 2. CARREGAR DADOS DE FECHAMENTO (TES01401.aspx)
  // Baseado em: engine.js → loadClosingData (L2207-2279)
  // Usa seletor #grid1 e a.showModal[data-url*='TES01406.aspx'] data-codigo
  // ====================================================================
  async loadClosingData(competencia) {
    console.error(`[SIGA Scraper] Carregando fechamentos via TES01401.aspx...`);
    
    await this.page.goto("https://siga.congregacao.org.br/TES/TES01401.aspx?f_inicio=S", { 
      waitUntil: "networkidle", timeout: 30000 
    });

    // Aguardar grid (como no engine.js L2221)
    await this.page.waitForSelector("#grid1", { timeout: 30000 }).catch(() => {
      console.error("[SIGA Scraper] ⚠️ Tabela #grid1 não encontrada, tentando fallback...");
    });
    await this.page.waitForTimeout(1000);

    // Extrair fechamentos (lógica idêntica ao engine.js L2238-2263)
    const closings = await this.page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table#grid1 tr"));
      return rows.map(row => {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length >= 6) {
          const competencia = cells[1]?.textContent.trim();
          const localidade = cells[2]?.textContent.trim();
          // Buscar link "Visualizar" e ler data-codigo (engine.js L2248-2251)
          const viewLink = row.querySelector("a.showModal[data-url*='TES01406.aspx']");
          const codigo = viewLink?.getAttribute("data-codigo");
          
          // Fallback: tentar no dropdown de opções
          if (!codigo) {
            const anyLink = row.querySelector("a[href*='TES01406'], a[onclick*='TES01406']");
            if (anyLink) {
              const href = anyLink.getAttribute("href") || anyLink.getAttribute("onclick") || "";
              const match = href.match(/codigo=([A-F0-9-]{36})/i);
              if (match) return { codigo: match[1], competencia, localidade, status: cells[5]?.querySelector(".badge")?.textContent.trim() };
            }
          }
          
          if (codigo) {
            return { codigo, competencia, localidade, status: cells[5]?.querySelector(".badge")?.textContent.trim() };
          }
        }
        return null;
      }).filter(Boolean);
    });

    console.error(`[SIGA Scraper] ${closings.length} fechamentos encontrados na tabela.`);
    
    // Encontrar o GUID da competência solicitada
    const target = closings.find(c => c.competencia?.includes(competencia));
    if (target) {
      console.error(`[SIGA Scraper] ✅ GUID para ${competencia}: ${target.codigo}`);
    } else {
      console.error(`[SIGA Scraper] ❌ Fechamento para ${competencia} não encontrado. Disponíveis: ${closings.map(c=>c.competencia).join(", ")}`);
    }
    return target;
  }

  // ====================================================================
  // 3. DOWNLOAD DE ANEXOS DO FECHAMENTO
  // Baseado em: engine.js → downloadClosingAttachments (L3218-3342)
  // Usa ArquivoWS.asmx/Selecionar + downloadFromGedByCodigo
  // ====================================================================
  async downloadClosingAttachments(closingGuid, targetDir) {
    console.error(`[SIGA Scraper] Listando anexos do fechamento ${closingGuid}...`);
    
    // Listar anexos via WebService (engine.js L3225-3231)
    const files = await this.page.evaluate(async (guid) => {
      try {
        const resp = await fetch("/GED/ArquivoWS.asmx/Selecionar", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=UTF-8" },
          body: JSON.stringify({ origem: "TES.FechamentoC52", codigoOrigem: guid }),
        });
        const json = await resp.json();
        return (json.d || []).map(a => ({ Codigo: a.Codigo, Nome: a.Nome, TamanhoKB: a.TamanhoKB }));
      } catch (e) { return []; }
    }, closingGuid);

    if (!files.length) {
      console.error("[SIGA Scraper] ⚠️ Nenhum anexo encontrado para este fechamento.");
      return [];
    }

    console.error(`[SIGA Scraper] ${files.length} anexos encontrados. Iniciando downloads...`);
    await fs.mkdir(targetDir, { recursive: true });

    for (const file of files) {
      await this.downloadFromGedByCodigo(file.Codigo, file.Nome, targetDir);
    }
    
    return files;
  }

  // ====================================================================
  // 4. DOWNLOAD DE ARQUIVO DO GED (Azure Blob)
  // Baseado em: engine.js → downloadFromGedByCodigo (L2110-2205)
  // Extrai URL do blob + Authorization do script embutido no HTML
  // ====================================================================
  async downloadFromGedByCodigo(codigo, suggestedName, targetDir) {
    console.error(`[SIGA Scraper] Baixando: ${suggestedName} (GED: ${codigo})...`);
    
    const gedUrl = `https://siga.congregacao.org.br/GED/GED99901.aspx?codigo=${codigo}`;
    
    // Navegar para a página GED que contém o script de download
    // GED grandes (ex.: colagem DESPESAS) podem exceder 30s com networkidle; domcontentloaded + timeout maior é mais estável.
    await this.page.goto(gedUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await this.page.waitForTimeout(2000).catch(() => {});
    const html = await this.page.content();

    // Extrair URL/headers do script embutido (engine.js L2139-2148)
    const urlMatch = html.match(/xhr\.open\("GET",\s*"([^"]+)",/i);
    const authMatch = html.match(/xhr\.setRequestHeader\("authorization",\s*"([^"]+)"\)/i);
    const dateMatch = html.match(/xhr\.setRequestHeader\("x-ms-date",\s*"([^"]+)"\)/i);
    const versionMatch = html.match(/xhr\.setRequestHeader\("x-ms-version",\s*"([^"]+)"\)/i);
    const nameMatch = html.match(/a\.download\s*=\s*"([^"]+)"/i);

    if (!urlMatch || !authMatch) {
      console.error(`[SIGA Scraper] ❌ URL/Auth não encontrados para ${suggestedName}. Pulando...`);
      return false;
    }

    const blobUrl = urlMatch[1];
    const auth = authMatch[1];
    const xmsDate = dateMatch ? dateMatch[1] : new Date().toUTCString();
    const fileName = (nameMatch ? nameMatch[1] : suggestedName || codigo).trim();

    // Headers para o blob Azure (engine.js L2167-2175)
    const blobHeaders = {
      "Authorization": auth,
      "x-ms-date": xmsDate,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36",
    };
    if (versionMatch) blobHeaders["x-ms-version"] = versionMatch[1];

    // Download do blob via context.request (Playwright)
    const blobResp = await this.browser.browserContext.request.get(blobUrl, { headers: blobHeaders });
    
    if (blobResp.ok()) {
      const buf = await blobResp.body();
      const safeName = fileName.replace(/[<>:"/\\|?*]/g, "_");
      await fs.writeFile(path.join(targetDir, safeName), buf);
      console.error(`[SIGA Scraper] ✅ ${safeName} salvo (${(buf.length / 1024).toFixed(1)} KB).`);
      return true;
    } else {
      console.error(`[SIGA Scraper] ❌ Download falhou (${blobResp.status()}) para ${fileName}`);
      return false;
    }
  }

  // ====================================================================
  // 5. EXTRAÇÃO COMPLETA (Pipeline engine.js → runProcessor)
  // Pipeline: switchEstablishment → loadClosingData → downloadAttachments
  // ====================================================================
  async scrapeClosingData(workDir, closingGuid) {
    console.error(`[SIGA Scraper] Extraindo dados do fechamento ${closingGuid}...`);

    // Navegar para a página de detalhes e extrair dados financeiros
    await this.page.goto(`https://siga.congregacao.org.br/TES/TES01406.aspx?codigo=${closingGuid}`, { 
      waitUntil: "networkidle", timeout: 30000 
    });
    await this.page.waitForTimeout(2000);

    // Extrair resumo financeiro da página
    const parsedData = await this.page.evaluate(() => {
      const allText = document.body.innerText;
      
      // Despesas
      const despesas = [];
      const tables = document.querySelectorAll("table");
      tables.forEach(table => {
        const rows = table.querySelectorAll("tbody tr");
        rows.forEach(tr => {
          const cells = Array.from(tr.querySelectorAll("td"));
          if (cells.length >= 5) {
            const firstCell = cells[0]?.textContent.trim();
            if (firstCell && /^\d{2}\/\d{2}\/\d{4}/.test(firstCell)) {
              despesas.push({
                data: firstCell,
                tipo: cells[1]?.textContent.trim(),
                documento: cells[2]?.textContent.trim(),
                fornecedor: cells[3]?.textContent.trim(),
                despesa: cells[4]?.textContent.trim(),
                valor: cells[cells.length - 1]?.textContent.trim(),
              });
            }
          }
        });
      });

      // Resumo financeiro
      const saldoAnteriorMatch = allText.match(/Saldo do mês anterior\s+([\d.,]+)/);
      const totalColetasMatch = allText.match(/Total das coletas\s+([\d.,]+)/);
      const totalDepositadoMatch = allText.match(/Total depositado\s+([\d.,]+)/);
      const totalDespesasMatch = allText.match(/Total de despesas\s+([\d.,]+)/);
      const saldoProxMesMatch = allText.match(/Saldo para o mês seguinte\s+([\d.,]+)/);

      return {
        resumo: {
          saldoAnterior: saldoAnteriorMatch?.[1] || "",
          totalColetas: totalColetasMatch?.[1] || "",
          totalDepositado: totalDepositadoMatch?.[1] || "",
          totalDespesas: totalDespesasMatch?.[1] || "",
          saldoProximoMes: saldoProxMesMatch?.[1] || "",
        },
        despesas,
      };
    });

    // Salvar JSON de dados financeiros
    await fs.writeFile(
      path.join(workDir, `fechamento_${closingGuid}.json`), 
      JSON.stringify(parsedData, null, 2)
    );
    
    console.error(`[SIGA Scraper] ${parsedData.despesas.length} despesas extraídas.`);

    // Download de todos os anexos
    const anexos = await this.downloadClosingAttachments(
      closingGuid, 
      path.join(workDir, "Fechamento")
    );
    
    parsedData.anexos = anexos;
    // Re-salvar com lista de anexos
    await fs.writeFile(
      path.join(workDir, `fechamento_${closingGuid}.json`), 
      JSON.stringify(parsedData, null, 2)
    );
    
    return parsedData;
  }

  // ====================================================================
  // 6. MANUTENÇÃO
  // ====================================================================
  async downloadMaintenance(workDir, competencia, fechamentoGuid) {
    console.error(`[SIGA Scraper] Extraindo manutenção para competência ${competencia} (fechamento: ${fechamentoGuid})...`);
    const mntDir = path.join(workDir, "Manutencao");
    await fs.mkdir(mntDir, { recursive: true });

    if (!fechamentoGuid) {
      console.error(`[SIGA Scraper] ⚠️ GUID do fechamento não fornecido. Pulando manutenção.`);
      return;
    }

    // O MNT00407 usa o GUID do fechamento TES (não o código MNT do grid)
    // para buscar anexos via ArquivoWS.
    // Origens: "MNT.RelatoriosFechamento" (Relatórios/Checklists) e "MNT.AtaTrimestral" (Atas)
    const files = await this.page.evaluate(async (guid) => {
      const allFiles = [];
      const token = (document.querySelector("#antiXsrfTokenGlobal") || {}).value || "";

      for (const origem of ["MNT.RelatoriosFechamento", "MNT.AtaTrimestral"]) {
        try {
          const resp = await fetch("/GED/ArquivoWS.asmx/Selecionar", {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=UTF-8",
              "__antixsrftoken": token,
              "X-Requested-With": "XMLHttpRequest"
            },
            body: JSON.stringify({ origem, codigoOrigem: guid }),
          });
          const json = await resp.json();
          if (json.d && json.d.length > 0) {
            json.d.forEach(a => allFiles.push({
              Codigo: a.Codigo,
              Nome: a.Nome,
              tipo: origem.includes("Relatorio") ? "relatorio" : "ata"
            }));
          }
        } catch(e) { /* ignorar erros de cada origem */ }
      }
      return allFiles;
    }, fechamentoGuid);

    if (!files || files.length === 0) {
      console.error(`[SIGA Scraper] ⚠️ Nenhum anexo de manutenção encontrado para ${competencia}.`);
      return;
    }

    console.error(`[SIGA Scraper] ${files.length} anexo(s) de manutenção encontrado(s). Baixando...`);

    for (const file of files) {
      await this.downloadFromGedByCodigo(file.Codigo, file.Nome, mntDir);
    }
  }

  // ====================================================================
  // 7. VOLUNTÁRIOS
  // Baseado na API REST do Siga api/rh/rh010 do engine.js (Azure Blobs)
  // ====================================================================
  async downloadVolunteers(workDir, competencia, localidadeNome) {
    console.error(`[SIGA Scraper] Extraindo anexos de voluntários para ${competencia}...`);
    const volDir = path.join(workDir, "Voluntarios");
    await fs.mkdir(volDir, { recursive: true });

    // 1. Extrair Dados de Apontamentos (RH00401) para cruzamento (Regra 29.12)
    console.error(`[SIGA Scraper] Extraindo tabela de apontamentos (RH00401) para ${competencia}...`);
    try {
        await this.page.goto("https://siga.congregacao.org.br/RH/RH00401.aspx?f_inicio=S&__initPage__=S", { waitUntil: "networkidle" });
        const appointments = await this.page.evaluate(() => {
            const data = [];
            document.querySelectorAll("#grid1 tbody tr").forEach(row => {
                const cells = row.querySelectorAll("td");
                if (cells.length >= 12) {
                    data.push({
                        livro: cells[0].textContent.trim(),
                        voluntario: cells[1].textContent.trim(),
                        nome: cells[2].textContent.trim(),
                        funcaoCodigo: cells[5].textContent.trim(),
                        dataRegistro: cells[6].textContent.trim(),
                        entrada: cells[7].textContent.trim(),
                        saida: cells[8].textContent.trim(),
                        duracao: cells[9].textContent.trim()
                    });
                }
            });
            return data;
        });
        await fs.writeFile(path.join(volDir, "dados_voluntarios.json"), JSON.stringify(appointments, null, 2));
        console.error(`[SIGA Scraper] ✅ Salvos ${appointments.length} registros de hora de voluntários.`);
    } catch (e) {
        console.error(`[SIGA Scraper] ⚠️ Falha ao extrair tabela RH00401: ${e.message}`);
    }

    // 2. Navegar para RH01001 e baixar anexos
    await this.page.goto("https://siga.congregacao.org.br/SIS/Programa.aspx?programa=RH01001&f_inicio=S", { waitUntil: "networkidle" });
    const compNorm = String(competencia || "").trim().toLowerCase();
    
    console.error(`[SIGA Scraper] Consultando tabela de fechamentos de voluntários...`);
    const fechamentos = await this.page.evaluate(async () => {
         const token = document.querySelector("#antiXsrfTokenGlobal")?.value || document.cookie.match(/__AntiXsrfToken=([^;]+)/)?.[1];
         let jwt = window.localStorage.getItem("ccbsiga-token-api") || "";
         if (jwt.startsWith('"')) jwt = jwt.slice(1, -1);
         const resp = await fetch("https://siga-api.congregacao.org.br/api/rh/rh010/dados/tabela?codigoCompetencia=&codigoStatus=", {
            headers: { 
              "accept": "application/json", 
              "__antixsrftoken": token,
              "Authorization": `Bearer ${jwt}` 
            }
         });
         if (!resp.ok) return [];
         return await resp.json();
    });

    const compAlvo = (fechamentos || []).find(c => String(c.nomeExibicaoCompetencia || "").trim().toLowerCase() === compNorm);
    const targetGuid = compAlvo ? compAlvo.codigoFechamentoMensal : null;

    if (!targetGuid) {
         console.error(`[SIGA Scraper] ⚠️ Competência ${competencia} não encontrada na tabela de fechamentos de Voluntários.`);
         return;
    }

    console.error(`[SIGA Scraper] ✅ GUID Resolvido para Voluntários: ${targetGuid}`);

    const anexosUrl = `https://siga-api.congregacao.org.br/api/rh/rh010/anexos/${targetGuid}`;
    const anexos = await this.page.evaluate(async (url) => {
         const token = document.querySelector("#antiXsrfTokenGlobal")?.value || document.cookie.match(/__AntiXsrfToken=([^;]+)/)?.[1];
         let jwt = window.localStorage.getItem("ccbsiga-token-api") || "";
         if (jwt.startsWith('"')) jwt = jwt.slice(1, -1);
         const resp = await fetch(url, { 
           headers: { 
             "accept": "application/json", 
             "__antixsrftoken": token,
             "Authorization": `Bearer ${jwt}` 
           } 
         });
         if (!resp.ok) return [];
         return await resp.json();
    }, anexosUrl);

    if (!Array.isArray(anexos) || anexos.length === 0) {
        console.error(`[SIGA Scraper] ⚠️ Nenhum anexo de Voluntários encontrado no endpoint de anexos para ${competencia}.`);
        return;
    }

    console.error(`[SIGA Scraper] Preparando para baixar ${anexos.length} anexos de voluntários.`);

    for (const item of anexos) {
         const fileName = (item.nome || `${item.codigo}.pdf`).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
         const fileUrl = item.blobUrl;
         const auth = item.autorizacaoAnexo; 
         const dateHeader = item.dataAutorizacao;
         
         const requestHeaders = { "Accept": "*/*" };
         if (auth) requestHeaders["Authorization"] = auth;
         if (dateHeader) requestHeaders["x-ms-date"] = dateHeader;
         
         try {
             const resp = await fetch(fileUrl, { method: "GET", headers: requestHeaders });
             if (!resp.ok) {
                 console.error(`[SIGA Scraper] ❌ Erro azure no voluntário: ${fileName} -> HTTP ${resp.status} ${await resp.text()}`);
                 continue;
             }
             const arrayBuffer = await resp.arrayBuffer();
             await fs.writeFile(path.join(volDir, fileName), Buffer.from(arrayBuffer));
             console.error(`[SIGA Scraper] ✅ Anexo de voluntário baixado (Nativo): ${fileName}`);
         } catch(e) {
             console.error(`[SIGA Scraper] ❌ Erro de rede ao baixar voluntário: ${fileName} -> ${e.toString()}`);
         }
    }
  }

  // ====================================================================
  // 8. DEPÓSITOS INDIVIDUAIS (TES00601) e DESPESAS INDIVIDUAIS (TES00801)
  // ====================================================================
  async downloadIndividualAttachments(workDir, competencia, urlList, origemWS, folderName) {
    console.error(`[SIGA Scraper] Iniciando extração de anexos isolados (${folderName}) para ${competencia}...`);
    const targetDir = path.join(workDir, folderName);
    await fs.mkdir(targetDir, { recursive: true });

    await this.page.goto(urlList, { waitUntil: "networkidle", timeout: 60000 });
    
    // Aguarda o grid carregar (as transações)
    try { await this.page.waitForSelector("#grid1 tbody tr", { timeout: 15000 }); } 
    catch (e) {
       console.error(`[SIGA Scraper] O grid não carregou ou está vazio para ${folderName}.`);
       return;
    }

    const items = await this.page.evaluate((targetComp) => {
        const partesComp = targetComp.split("/").map((s) => s.trim()).filter(Boolean);
        const mesComp = String(partesComp[0] || "").padStart(2, "0");
        const anoComp = String(partesComp[1] || "");
        if (!(mesComp && anoComp)) return [];

        /** @returns {boolean} */
        function linhaEhDaCompetencia(rowEl) {
          const cel0 = rowEl.querySelector("td:nth-child(1)")?.textContent?.trim() || "";
          const cel1 = rowEl.querySelector("td:nth-child(2)")?.textContent?.trim() || "";

          const mDd = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(cel0);
          if (mDd && mDd.length >= 4) {
            const mo = String(mDd[2]).padStart(2, "0");
            const yy = String(mDd[3]);
            return mo === mesComp && yy === anoComp;
          }

          const norm = (s) => String(s || "").replace(/\s+/g, "");
          let mMm = /^(\d{1,2})\/(\d{4})$/.exec(norm(cel0));
          if (!mMm) mMm = /^(\d{1,2})\/(\d{4})$/.exec(norm(cel1));
          if (mMm && mMm.length >= 3) {
            return String(mMm[1]).padStart(2, "0") === mesComp && String(mMm[2]) === anoComp;
          }

          const fullHead = `${cel0} ${cel1}`;
          const reMesAnoComp = new RegExp(
            `(^|[^0-9])${mesComp}\\/${anoComp}([^0-9]|$)`
          );
          return reMesAnoComp.test(fullHead);
        }

        const vistos = new Set();
        const data = [];
        document.querySelectorAll("#grid1 tbody tr").forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 5) return;
          if (!linhaEhDaCompetencia(row)) return;

          const link = row.querySelector("a[data-codigo]");
          const guid = link?.getAttribute("data-codigo") || "";
          if (!guid || vistos.has(guid)) return;
          vistos.add(guid);

          data.push({ codigo: guid });
        });
        return data;
    }, competencia);

    if (!items || items.length === 0) {
        console.error(`[SIGA Scraper] Nenhum item de ${folderName} encontrado correspondente a ${competencia}.`);
        return;
    }

    console.error(`[SIGA Scraper] Encontrados ${items.length} itens de ${folderName}. Buscando documentos no GED...`);

    const token = await this.page.evaluate(() => {
        return (document.querySelector("#antiXsrfTokenGlobal")?.value) || "";
    });

    for (const item of items) {
        const files = await this.page.evaluate(async ({ tkn, origem, guid }) => {
            try {
                const resp = await fetch("/GED/ArquivoWS.asmx/Selecionar", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json; charset=UTF-8",
                        "__antixsrftoken": tkn,
                        "X-Requested-With": "XMLHttpRequest"
                    },
                    body: JSON.stringify({ origem: origem, codigoOrigem: guid }),
                });
                const json = await resp.json();
                return json.d || [];
            } catch(e) { return []; }
        }, { tkn: token, origem: origemWS, guid: item.codigo });

        if (files && files.length > 0) {
            for (const f of files) {
                await this.downloadFromGedByCodigo(f.Codigo, f.Nome, targetDir);
            }
        }
    }
  }

  async downloadDeposits(workDir, competencia) {
      await this.downloadIndividualAttachments(
          workDir, 
          competencia, 
          "https://siga.congregacao.org.br/TES/TES00601.aspx?f_inicio=S&__initPage__=S", 
          "TES.Deposito", 
          "Depositos"
      );
  }

  async downloadExpenses(workDir, competencia) {
      await this.downloadIndividualAttachments(
          workDir, 
          competencia, 
          "https://siga.congregacao.org.br/TES/TES00801.aspx?f_inicio=S&__initPage__=S", 
          "TES.Despesa", 
          "Despesas"
      );
  }
}

