/**
 * Análise offline de `dados_voluntarios.json` (apoio a 29.08 / 29.09 / 29.10).
 * Não detecta 29.11 (assinatura) nem 29.14 (caligrafia) — só PDF.
 */

/**
 * @param {object[]} data linhas do JSON RH004
 * @param {string} competencia MM/AAAA
 */
export function analisarVoluntariosJson(data, competencia) {
  const [mes] = String(competencia || "").split("/");
  const mm = String(mes || "").padStart(2, "0");
  const rows = (Array.isArray(data) ? data : []).filter((l) => {
    const d = String(l.dataRegistro || "");
    return d.includes(`/${mm}/`) || Boolean(d.match(new RegExp(`\\/${mm}\\/\\d{2}$`)));
  });

  const mapRow = (l) => ({
    data: l.dataRegistro,
    livro: l.voluntario || l.livro || "?",
    nome: l.nome,
    entrada: l.entrada,
    saida: l.saida,
    funcaoCodigo: l.funcaoCodigo,
  });

  const semFuncao = rows.filter((l) => l.funcaoCodigo == null || l.funcaoCodigo === "");
  const semSaida = rows.filter(
    (l) => l.entrada && (!l.saida || String(l.saida).trim() === "")
  );
  const semNome = rows.filter((l) => !l.nome || String(l.nome).trim() === "");

  function reps(field) {
    const g = {};
    for (const l of rows) {
      const livro = l.voluntario || l.livro || "?";
      const val = l[field];
      if (!val) continue;
      const k = `${livro} | ${l.dataRegistro} | ${field}=${val}`;
      g[k] = (g[k] || 0) + 1;
    }
    return Object.entries(g)
      .filter(([, c]) => c >= 4)
      .map(([k, c]) => ({
        chave: k,
        ocorrencias: c,
        apontamentos: c - 3,
        regra: "29.09",
        codigoErpTipico: 281,
      }));
  }

  const foraOrdem = [];
  const byKey = {};
  for (const l of rows) {
    const k = `${l.voluntario || l.livro || "?"}|${l.dataRegistro}`;
    if (!byKey[k]) byKey[k] = [];
    byKey[k].push(l);
  }
  for (const [k, list] of Object.entries(byKey)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1].entrada;
      const b = list[i].entrada;
      if (a && b && a > b) {
        foraOrdem.push({
          chave: k,
          prev: a,
          cur: b,
          nome: list[i].nome,
          regra: "29.09",
          codigoErpTipico: 281,
          tipo: "ordem_entrada_json",
        });
      }
    }
  }

  const repsEntrada = reps("entrada");
  const repsSaida = reps("saida");

  return {
    competencia: `${mm}/${String(competencia).split("/")[1] || ""}`,
    totalMes: rows.length,
    aviso:
      "JSON só apoia 29.08/29.09/29.10. Assinatura (29.11), caligrafia (29.14), ordem no livro e linhas em branco exigem PDF.",
    candidatos: {
      "29.08": {
        codigoErpTipico: 280,
        total: semFuncao.length,
        sample: semFuncao.slice(0, 20).map(mapRow),
      },
      "29.10": {
        codigoErpTipico: 282,
        total: semSaida.length,
        sample: semSaida.slice(0, 15).map(mapRow),
      },
      "29.09_repeticao": {
        codigoErpTipico: 281,
        entrada: repsEntrada,
        saida: repsSaida,
        totalApontamentos:
          repsEntrada.reduce((s, r) => s + r.apontamentos, 0) +
          repsSaida.reduce((s, r) => s + r.apontamentos, 0),
      },
      "29.09_ordem_json": {
        codigoErpTipico: 281,
        total: foraOrdem.length,
        sample: foraOrdem.slice(0, 25),
        nota: "Ordem no JSON pode divergir do PDF; confirmar sentido de leitura no livro.",
      },
    },
    semNome: {
      total: semNome.length,
      sample: semNome.slice(0, 10).map(mapRow),
    },
  };
}
