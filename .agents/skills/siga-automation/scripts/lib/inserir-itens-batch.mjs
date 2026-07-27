import fs from "fs/promises";
import path from "path";

/**
 * Lote de apontamentos (validação + inserção SIGA).
 *
 * Formatos:
 * 1) Array: [ { ...item }, ... ]
 * 2) Objeto: { codigoVerificacao?, meta?, itens|items: [ ... ] }
 * 3) NDJSON/JSONL
 *
 * Campos por item (inserção):
 * - codigo | codigoItem | codigoItemVerificacao  → inteiro ERP (281, não "29.09")
 * - dataFato | data | dataDocumento              → DD/MM/AAAA
 * - numeroDocumento | documento | doc
 * - observacao | obs
 * - codigoVerificacao | idVerificacao (opcional se vier no CLI/raiz)
 *
 * Campos de validação / gate humano (não vão para a API):
 * - regra | ocorrencia | rotulo                  → rótulo InfoCCB (ex.: "29.08")
 * - conviccao | confidence | confianca           → 0–100
 * - status                                       → proposto|segurado|descartado|lancado|pendente
 * - livro | evidencia | motivoIncerteza | seq    → metadados opcionais
 */

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function normalizeRegra(raw) {
  if (raw == null || raw === "") return undefined;
  let s = String(raw).trim();
  // Aceita "29.08", "29.8", "29,08"
  s = s.replace(",", ".");
  const m = s.match(/^(\d+)\.(\d+)$/);
  if (m) {
    // Normaliza 29.8 → 29.08 (dois dígitos no sufixo quando ≤9 e rótulo CF costuma ser xx.0x)
    const major = m[1];
    let minor = m[2];
    if (minor.length === 1) minor = `0${minor}`;
    return `${major}.${minor}`;
  }
  return s;
}

function normalizeConviccao(raw) {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace("%", "").trim());
  if (Number.isNaN(n)) {
    throw new Error(`conviccao inválida: ${raw}`);
  }
  if (n < 0 || n > 100) {
    throw new Error(`conviccao fora de 0–100: ${n}`);
  }
  return Math.round(n);
}

function normalizeStatus(raw) {
  if (raw == null || raw === "") return "proposto";
  const s = String(raw).trim().toLowerCase();
  const map = {
    proposto: "proposto",
    pendente: "pendente",
    p: "pendente",
    segurado: "segurado",
    s: "segurado",
    descartado: "descartado",
    d: "descartado",
    lancado: "lancado",
    lançado: "lancado",
    mantem: "proposto",
    mantém: "proposto",
    m: "proposto",
    inclui: "proposto",
    i: "proposto",
    n: "proposto",
    novo: "proposto",
  };
  if (!map[s]) {
    throw new Error(
      `status inválido "${raw}". Use: proposto|pendente|segurado|descartado|lancado`
    );
  }
  return map[s];
}

export function normalizeBatchItem(raw, defaults = {}) {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cada item do lote deve ser um objeto.");
  }
  const codigo = pick(raw, ["codigo", "codigoItem", "codigoItemVerificacao"]);
  const dataFato = pick(raw, ["dataFato", "data", "dataDocumento"]);
  const numeroDocumento = pick(raw, ["numeroDocumento", "documento", "doc", "nDocumento"]);
  const observacao = pick(raw, ["observacao", "obs"]);
  const codigoVerificacao = pick(raw, [
    "codigoVerificacao",
    "idVerificacao",
    "verificacao",
  ]);
  const regra = normalizeRegra(pick(raw, ["regra", "ocorrencia", "rotulo", "label"]));
  let conviccao;
  try {
    conviccao = normalizeConviccao(pick(raw, ["conviccao", "confidence", "confianca"]));
  } catch (e) {
    throw e;
  }
  const status = normalizeStatus(pick(raw, ["status", "estado"]));

  const item = {
    codigoVerificacao:
      codigoVerificacao != null
        ? String(codigoVerificacao)
        : defaults.codigoVerificacao != null
          ? String(defaults.codigoVerificacao)
          : undefined,
    codigo: codigo != null ? String(codigo) : undefined,
    dataFato: dataFato != null ? String(dataFato).trim() : undefined,
    numeroDocumento:
      numeroDocumento != null && numeroDocumento !== ""
        ? String(numeroDocumento)
        : "",
    observacao: observacao != null ? String(observacao) : "",
    regra,
    conviccao,
    status,
  };

  const livro = pick(raw, ["livro", "documentoLivro"]);
  const evidencia = pick(raw, ["evidencia", "evidence", "fonte"]);
  const motivoIncerteza = pick(raw, ["motivoIncerteza", "incerteza", "nota"]);
  const seq = pick(raw, ["seq", "sequencia", "id"]);
  if (livro != null) item.livro = String(livro);
  if (evidencia != null) item.evidencia = String(evidencia);
  if (motivoIncerteza != null) item.motivoIncerteza = String(motivoIncerteza);
  if (seq != null) item.seq = seq;

  if (raw.reincidencia != null) {
    item.reincidencia = raw.reincidencia === true || raw.reincidencia === "true";
  }

  return item;
}

export function validateBatchItem(item, index, options = {}) {
  const prefix = `Item[${index}]`;
  const requireCodigo = options.requireCodigo !== false;

  if (!item.codigoVerificacao || Number.isNaN(parseInt(item.codigoVerificacao, 10))) {
    throw new Error(`${prefix}: codigoVerificacao inválido ou ausente.`);
  }
  if (requireCodigo) {
    if (!item.codigo || Number.isNaN(parseInt(item.codigo, 10))) {
      throw new Error(`${prefix}: codigo (ERP) inválido ou ausente.`);
    }
    if (String(item.codigo).includes(".")) {
      throw new Error(
        `${prefix}: use o codigo inteiro do ERP (ex.: 281), nunca rótulo com ponto (ex.: 29.09). Campo "regra" é para o rótulo InfoCCB.`
      );
    }
  }
  if (!item.dataFato || !/^\d{2}\/\d{2}\/\d{4}$/.test(item.dataFato)) {
    throw new Error(`${prefix}: dataFato deve estar em DD/MM/AAAA (recebido: ${item.dataFato}).`);
  }
  if (item.observacao == null) {
    throw new Error(`${prefix}: observacao ausente.`);
  }
  if (options.requireRegra && !item.regra) {
    throw new Error(`${prefix}: regra (InfoCCB, ex. 29.08) obrigatória neste modo.`);
  }
  if (options.requireConviccao && item.conviccao == null) {
    throw new Error(`${prefix}: conviccao (0–100) obrigatória neste modo.`);
  }
  return item;
}

export function parseBatchPayload(parsed, defaults = {}, validateOptions = {}) {
  let rootVerif = defaults.codigoVerificacao;
  let meta = {};
  let rows;

  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && typeof parsed === "object") {
    if (parsed.codigoVerificacao != null) {
      rootVerif = parsed.codigoVerificacao;
    }
    if (parsed.meta && typeof parsed.meta === "object") {
      meta = parsed.meta;
    }
    if (Array.isArray(parsed.itens)) {
      rows = parsed.itens;
    } else if (Array.isArray(parsed.items)) {
      rows = parsed.items;
    } else {
      throw new Error(
        'JSON de lote inválido: use um array ou um objeto com propriedade "itens".'
      );
    }
  } else {
    throw new Error("Payload de lote inválido.");
  }

  const defaultsNorm = {
    codigoVerificacao: rootVerif != null ? String(rootVerif) : undefined,
  };

  const itens = rows.map((raw, i) =>
    validateBatchItem(normalizeBatchItem(raw, defaultsNorm), i, validateOptions)
  );

  return { itens, meta, codigoVerificacao: defaultsNorm.codigoVerificacao };
}

export async function loadBatchFromFile(filePath, defaults = {}, validateOptions = {}) {
  const abs = path.resolve(filePath);
  let text = await fs.readFile(abs, "utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  const lower = abs.toLowerCase();

  if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) {
    const rows = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("//") || line.startsWith("#")) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (e) {
        throw new Error(`NDJSON linha ${i + 1}: ${e.message}`);
      }
      rows.push(obj);
    }
    const parsed = parseBatchPayload(rows, defaults, validateOptions);
    return { path: abs, ...parsed };
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON inválido em ${abs}: ${e.message}`);
  }

  const parsed = parseBatchPayload(parsedJson, defaults, validateOptions);
  return { path: abs, ...parsed };
}

/**
 * Filtra itens para lançamento / revisão.
 * Por omissão exclui status descartado e segurado.
 */
export function filterBatchItems(itens, options = {}) {
  const minConviccao =
    options.minConviccao != null && options.minConviccao !== ""
      ? Number(options.minConviccao)
      : null;
  const maxConviccao =
    options.maxConviccao != null && options.maxConviccao !== ""
      ? Number(options.maxConviccao)
      : null;
  const regras = options.regras
    ? String(options.regras)
        .split(",")
        .map((r) => normalizeRegra(r.trim()))
        .filter(Boolean)
    : null;

  let statusIncluir = options.statusIncluir
    ? String(options.statusIncluir)
        .split(",")
        .map((s) => normalizeStatus(s.trim()))
    : null;
  const statusExcluir = options.statusExcluir
    ? String(options.statusExcluir)
        .split(",")
        .map((s) => normalizeStatus(s.trim()))
    : ["descartado", "segurado"];

  // Se o utilizador pediu incluir-segurados, remove segurado da exclusão padrão
  if (options.incluirSegurados) {
    const excl = statusExcluir.filter((s) => s !== "segurado");
    statusExcluir.length = 0;
    statusExcluir.push(...excl);
  }

  const selected = [];
  const rejected = [];

  for (let i = 0; i < itens.length; i++) {
    const it = itens[i];
    const reasons = [];

    if (statusIncluir && !statusIncluir.includes(it.status)) {
      reasons.push(`status=${it.status} fora de incluir`);
    }
    if (statusExcluir.includes(it.status)) {
      reasons.push(`status=${it.status} excluído`);
    }
    if (regras && (!it.regra || !regras.includes(it.regra))) {
      reasons.push(`regra=${it.regra || "∅"} fora do filtro`);
    }
    if (minConviccao != null) {
      if (it.conviccao == null) {
        reasons.push("sem conviccao");
      } else if (it.conviccao < minConviccao) {
        reasons.push(`conviccao ${it.conviccao} < ${minConviccao}`);
      }
    }
    if (maxConviccao != null && it.conviccao != null && it.conviccao > maxConviccao) {
      reasons.push(`conviccao ${it.conviccao} > ${maxConviccao}`);
    }

    if (reasons.length) {
      rejected.push({ index: i, reasons, item: it });
    } else {
      selected.push({ index: i, item: it });
    }
  }

  return { selected, rejected };
}

export function summarizeBatch(itens) {
  const byRegra = {};
  const byStatus = {};
  const byFaixa = { "95-100": 0, "80-94": 0, "50-79": 0, "0-49": 0, sem: 0 };
  let sumConv = 0;
  let nConv = 0;

  for (const it of itens) {
    const r = it.regra || "(sem regra)";
    byRegra[r] = (byRegra[r] || 0) + 1;
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    if (it.conviccao == null) {
      byFaixa.sem++;
    } else {
      nConv++;
      sumConv += it.conviccao;
      if (it.conviccao >= 95) byFaixa["95-100"]++;
      else if (it.conviccao >= 80) byFaixa["80-94"]++;
      else if (it.conviccao >= 50) byFaixa["50-79"]++;
      else byFaixa["0-49"]++;
    }
  }

  return {
    total: itens.length,
    comConviccao: nConv,
    semConviccao: itens.length - nConv,
    conviccaoMedia: nConv ? Math.round((sumConv / nConv) * 10) / 10 : null,
    byRegra,
    byStatus,
    byFaixa,
  };
}

export function buildExportPayload(codigoVerificacao, selectedEntries, meta = {}) {
  return {
    codigoVerificacao: codigoVerificacao != null ? Number(codigoVerificacao) || codigoVerificacao : undefined,
    meta: {
      ...meta,
      geradoEm: new Date().toISOString(),
      filtro: meta.filtro || undefined,
    },
    itens: selectedEntries.map(({ item }) => {
      const out = {
        codigo: Number(item.codigo),
        dataFato: item.dataFato,
        numeroDocumento: item.numeroDocumento,
        observacao: item.observacao,
      };
      if (item.regra) out.regra = item.regra;
      if (item.conviccao != null) out.conviccao = item.conviccao;
      if (item.status) out.status = item.status;
      if (item.livro) out.livro = item.livro;
      if (item.evidencia) out.evidencia = item.evidencia;
      if (item.motivoIncerteza) out.motivoIncerteza = item.motivoIncerteza;
      if (item.seq != null) out.seq = item.seq;
      return out;
    }),
  };
}

export function parseBatchCliFlags(args) {
  const flags = {
    dryRun: false,
    continueOnError: false,
    delayMs: 150,
    from: 0,
    log: null,
    autorizado: false,
    visivel: false,
    minConviccao: null,
    maxConviccao: null,
    regras: null,
    statusIncluir: null,
    statusExcluir: null,
    incluirSegurados: false,
    exigirConviccao: false,
    exigirRegra: false,
    exportPath: null,
  };
  const positional = [];

  for (const a of args) {
    if (a === "--visivel=true") {
      flags.visivel = true;
      continue;
    }
    if (a === "--dry-run=true" || a === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    if (a === "--continue-on-error=true" || a === "--continue-on-error") {
      flags.continueOnError = true;
      continue;
    }
    if (a === "--autorizado=true" || a === "--autorizado") {
      flags.autorizado = true;
      continue;
    }
    if (a === "--incluir-segurados=true" || a === "--incluir-segurados") {
      flags.incluirSegurados = true;
      continue;
    }
    if (a === "--exigir-conviccao=true" || a === "--exigir-conviccao") {
      flags.exigirConviccao = true;
      continue;
    }
    if (a === "--exigir-regra=true" || a === "--exigir-regra") {
      flags.exigirRegra = true;
      continue;
    }
    if (a.startsWith("--delay-ms=")) {
      flags.delayMs = Math.max(0, parseInt(a.slice("--delay-ms=".length), 10) || 0);
      continue;
    }
    if (a.startsWith("--from=")) {
      flags.from = Math.max(0, parseInt(a.slice("--from=".length), 10) || 0);
      continue;
    }
    if (a.startsWith("--log=")) {
      flags.log = a.slice("--log=".length) || null;
      continue;
    }
    if (a.startsWith("--min-conviccao=")) {
      flags.minConviccao = Number(a.slice("--min-conviccao=".length));
      continue;
    }
    if (a.startsWith("--max-conviccao=")) {
      flags.maxConviccao = Number(a.slice("--max-conviccao=".length));
      continue;
    }
    if (a.startsWith("--regra=") || a.startsWith("--regras=")) {
      const v = a.includes("--regras=")
        ? a.slice("--regras=".length)
        : a.slice("--regra=".length);
      flags.regras = v;
      continue;
    }
    if (a.startsWith("--status=")) {
      flags.statusIncluir = a.slice("--status=".length);
      continue;
    }
    if (a.startsWith("--excluir-status=")) {
      flags.statusExcluir = a.slice("--excluir-status=".length);
      continue;
    }
    if (a.startsWith("--export=")) {
      flags.exportPath = a.slice("--export=".length) || null;
      continue;
    }
    positional.push(a);
  }

  return { flags, positional };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
