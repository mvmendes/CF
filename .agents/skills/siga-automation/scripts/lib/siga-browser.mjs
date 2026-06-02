import { chromium } from "playwright";
import path from "path";
import fs from "fs/promises";

export class SigaBrowser {
  constructor(sessionDir) {
    this.sessionDir = sessionDir;
    this.stateFile = path.join(sessionDir, "state.json");
    this.tokenFile = path.join(sessionDir, "token.json");
    this.browserContext = null;
    this.browserType = null;
    this.page = null;
    this.apiToken = null;
    this.jwtToken = null;
  }

  async init(headless = true) {
    // Evitar abrir múltiplas instâncias
    if (this.page && !this.page.isClosed()) return;

    await fs.mkdir(this.sessionDir, { recursive: true });
    
    let storageState = undefined;
    try {
      await fs.access(this.stateFile);
      storageState = this.stateFile;
      console.error("[SIGA Browser] storageState carregado de:", this.stateFile);
    } catch (e) {
      console.error("[SIGA Browser] Nenhum storageState encontrado. Sessão limpa.");
    }

    // Carregar tokens salvos
    try {
      const tokenData = JSON.parse(await fs.readFile(this.tokenFile, "utf-8"));
      this.apiToken = tokenData.token || "";
      this.jwtToken = tokenData.jwtUrl || "";
    } catch (e) {}

    this.browserType = await chromium.launch({
      headless: headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    this.browserContext = await this.browserType.newContext({
      viewport: { width: 1280, height: 720 },
      storageState: storageState
    });

    this.page = await this.browserContext.newPage();
  }

  async executeLogin() {
    console.error("[SIGA Browser] Entrando na página de login...");
    await this.page.goto("https://siga.congregacao.org.br/", { waitUntil: "domcontentloaded" });

    try {
      console.error("[SIGA Browser] Aguardando login manual (máx 5 min)...");
      
      // Esperar por qualquer URL logada (index.aspx ou SIS99908) ou token
      await Promise.race([
        this.page.waitForURL(u => u.href.includes("index.aspx") || u.href.includes("SIS99908"), { timeout: 300000 }),
        this.page.waitForSelector("#antiXsrfTokenGlobal", { timeout: 300000 })
      ]);
      
      // Aguardar carregamento completo do JS do SIGA
      await this.page.waitForTimeout(5000);

      // Extrair tokens
      const tokens = await this.page.evaluate(() => {
        let jwtRaw = window.localStorage.getItem("ccbsiga-token-api") || "";
        if (jwtRaw.startsWith('"') && jwtRaw.endsWith('"')) jwtRaw = jwtRaw.slice(1, -1);
        return {
          jwt: jwtRaw,
          xsrf: document.querySelector("#antiXsrfTokenGlobal")?.value || 
                document.cookie.match(/__AntiXsrfToken=([^;]+)/)?.[1] || ""
        };
      });

      this.apiToken = tokens.xsrf;
      this.jwtToken = tokens.jwt;
      console.error("[SIGA Browser] Tokens - JWT:", tokens.jwt ? "encontrado" : "VAZIO", "| XSRF:", tokens.xsrf ? "encontrado" : "VAZIO");

      // Salvar tokens (mesmo que parciais)
      await fs.writeFile(this.tokenFile, JSON.stringify({ 
        token: tokens.xsrf, 
        jwtUrl: tokens.jwt,
        date: new Date().toISOString() 
      }));
      
      // Salvar estado completo do browser (Cookies + LocalStorage)
      await this.browserContext.storageState({ path: this.stateFile });
      console.error("[SIGA Browser] ✅ Login detectado. Sessão salva em:", this.stateFile);
      return true;
    } catch (e) {
      console.error("[SIGA Browser] Erro ou Timeout aguardando login manual.", e.message);
      return false;
    }
  }

  /**
   * Valida se a sessão é válida SEM navegar no browser.
   * Baseado em engine.js L1764-1779: usa chamada de API leve (QuantidadeNotificacoes).
   * Isso evita o problema de navegação para page.aspx que causava logout.
   */
  async hasValidSession(headless = true) {
    try {
      if (!this.page) await this.init(headless);
      
      // Verificar se temos JWT token salvo
      if (!this.jwtToken) {
        try {
          const tokenData = JSON.parse(await fs.readFile(this.tokenFile, "utf-8"));
          this.jwtToken = tokenData.jwtUrl || "";
          this.apiToken = tokenData.token || "";
        } catch (e) {}
      }

      // Validar via chamada de API leve (engine.js approach) se temos JWT
      if (this.jwtToken) {
        console.error("[SIGA Browser] Validando sessão via API (QuantidadeNotificacoes)...");
      } else {
        console.error("[SIGA Browser] Sem JWT. Tentando validação via navegação...");
      }
      
      if (this.jwtToken) {
      try {
        const response = await this.browserContext.request.get(
          "https://siga-api.congregacao.org.br/api/Notificacao/QuantidadeNotificacoes",
          {
            headers: {
              "Authorization": `Bearer ${this.jwtToken}`,
              "Accept": "application/json",
            },
            failOnStatusCode: false,
            timeout: 15000,
          }
        );

        if (response.status() === 200) {
          console.error("[SIGA Browser] ✅ Sessão válida (API respondeu 200).");
          return true;
        }

        console.error(`[SIGA Browser] API retornou status ${response.status()}.`);
      } catch (e) {
        console.error("[SIGA Browser] Erro na chamada de API:", e.message);
      }
      } // fim if(jwtToken)

      // Fallback: navegar para a home e verificar se não redireciona para login
      console.error("[SIGA Browser] Tentando validação via navegação (fallback)...");
      await this.page.goto("https://siga.congregacao.org.br/SIS/SIS99908.aspx", {
        waitUntil: "domcontentloaded", timeout: 30000
      });
      await this.page.waitForTimeout(2000);

      const url = this.page.url();
      console.error(`[SIGA Browser] URL após navegação: ${url}`);

      if (url.includes("login") || url.includes("Autenticacao") || url.includes("logon") || url.includes("logoff") || url.endsWith("index.aspx") || url.includes("index.aspx?")) {
        console.error("[SIGA Browser] ❌ Sessão expirada (redirecionado para login/logout/index).");
        return false;
      }

      // Extrair tokens atualizados
      const tokens = await this.page.evaluate(() => {
        let jwtRaw = window.localStorage.getItem("ccbsiga-token-api") || "";
        if (jwtRaw.startsWith('"') && jwtRaw.endsWith('"')) jwtRaw = jwtRaw.slice(1, -1);
        return {
          jwt: jwtRaw,
          xsrf: document.querySelector("#antiXsrfTokenGlobal")?.value || 
                document.cookie.match(/__AntiXsrfToken=([^;]+)/)?.[1] || ""
        };
      });

      if (tokens.xsrf || tokens.jwt) {
        this.apiToken = tokens.xsrf;
        this.jwtToken = tokens.jwt;
        // Salvar sessão atualizada
        await this.browserContext.storageState({ path: this.stateFile });
        await fs.writeFile(this.tokenFile, JSON.stringify({ 
          token: tokens.xsrf, jwtUrl: tokens.jwt, date: new Date().toISOString() 
        }));
        console.error("[SIGA Browser] ✅ Sessão válida (fallback). Tokens atualizados.");
        return true;
      }

      return false;
    } catch (e) {
      console.error("[SIGA Browser] Exceção na validação de sessão:", e.message);
      return false;
    }
  }

  async getCookies() {
    return await this.browserContext.cookies();
  }

  async extractAuthToken() {
    try {
      return await this.page.evaluate(() => {
        const script = Array.from(document.scripts).find(
          (s) => s.textContent.includes("Authorization:") || s.textContent.includes("xhr.open")
        );
        if (!script) return null;
        const authMatch = script.textContent.match(/Authorization:\s*'([^']+)'/) || 
                          script.textContent.match(/"Authorization":\s*"([^"]+)"/);
        return authMatch ? authMatch[1] : null;
      });
    } catch (e) {
      return null;
    }
  }

  async close() {
    // Salvar estado antes de fechar
    if (this.browserContext) {
      try {
        await this.browserContext.storageState({ path: this.stateFile });
      } catch (e) {}
      await this.browserContext.close();
    }
    if (this.browserType) {
      await this.browserType.close();
    }
    this.page = null;
    this.browserContext = null;
    this.browserType = null;
  }
}
