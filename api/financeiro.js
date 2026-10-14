// Financeiro: despesas e contas a pagar, posição e ajuste de estoque, e o dashboard. Tudo restrito ao admin.
//
// GET    /api/financeiro?r=despesas                       despesas + categorias
// POST   /api/financeiro?r=despesas                       lança despesa { descricao, categoria, valor, vencimento, ... }
// PUT    /api/financeiro?r=despesas&id=                   edita despesa
// DELETE /api/financeiro?r=despesas&id=                   exclui despesa
// POST   /api/financeiro?r=despesas&acao=pagar&id=        { pagoEm, forma, doCaixa, lojaId, por }
// POST   /api/financeiro?r=despesas&acao=desfazer&id=     volta a despesa para "a pagar"
// GET    /api/financeiro?r=estoque                        produtos com estoque, última venda e movimentações
// POST   /api/financeiro?r=estoque&acao=ajuste            { productId, contagem, motivo, por }
// GET    /api/financeiro?r=dashboard&from=ISO&to=ISO&lojaId=

import { randomUUID } from "node:crypto";
import { hasRedis, redis, str, num, isAdmin } from "./_shared.js";
import { K, FORMAS_RECEBER, getJSON, setJSON, mget, getSetup, resumo, getCatalogo, getEstoque, moverEstoque, diaBR, hojeBR, BR_OFFSET } from "./_pdv.js";

// "fornecedor" é pagamento de mercadoria: sai do caixa, mas não é despesa na DRE (o custo já entra pelo CMV)
export const CATEGORIAS = {
  aluguel: "Aluguel", energia: "Energia", agua: "Água", internet: "Internet e telefone", salarios: "Salários",
  prolabore: "Pró-labore", impostos: "Impostos", taxas: "Taxas de cartão e banco", manutencao: "Manutenção",
  marketing: "Marketing", sistemas: "Sistemas", outros: "Outros", fornecedor: "Mercadoria (fornecedor)",
};
const FORMAS_PAG = ["dinheiro", "pix", "credito", "debito", "boleto", "transferencia"];
const isoDia = /^\d{4}-\d{2}-\d{2}$/;

const lerDespesa = (b, atual = {}) => ({
  id: atual.id || randomUUID(),
  descricao: str(b.descricao, 120) || atual.descricao || "",
  categoria: CATEGORIAS[b.categoria] ? b.categoria : atual.categoria || "outros",
  valor: b.valor === undefined ? atual.valor || 0 : Math.max(0, Math.min(1e7, num(b.valor))),
  vencimento: isoDia.test(b.vencimento || "") ? b.vencimento : atual.vencimento || hojeBR(),
  lojaId: b.lojaId === undefined ? atual.lojaId || "" : str(b.lojaId, 40),
  fornecedorId: b.fornecedorId === undefined ? atual.fornecedorId || null : str(b.fornecedorId, 60) || null,
  compraId: b.compraId === undefined ? atual.compraId || null : str(b.compraId, 60) || null,
  recorrente: b.recorrente === undefined ? atual.recorrente || null : b.recorrente === "mensal" ? "mensal" : null,
  obs: b.obs === undefined ? atual.obs || "" : str(b.obs, 300),
  pagoEm: atual.pagoEm || null, forma: atual.forma || null, doCaixa: atual.doCaixa || null, proximaId: atual.proximaId || null,
  criadaEm: atual.criadaEm || new Date().toISOString(), por: atual.por || str(b.por, 60) || null,
});

// mesmo dia no mês seguinte (31/01 vira 28 ou 29/02)
function proximoMes(dia) {
  const [y, m, d] = dia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

async function listaDespesas() {
  const ids = await redis("LRANGE", K.despesas, 0, 4999);
  return (await mget(ids.map(K.desp))).filter(Boolean);
}
async function todasVendas() {
  const codes = await redis("LRANGE", K.vendas, 0, 9999);
  return (await mget(codes.map(K.venda))).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasRedis()) return res.status(503).json({ error: "Armazenamento não configurado" });
  if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });
  const r = str(req.query.r, 20), acao = str(req.query.acao, 20), id = str(req.query.id, 60), b = req.body || {};
  try {
    // ---------- despesas ----------
    if (r === "despesas" && req.method === "GET") {
      return res.status(200).json({ despesas: await listaDespesas(), categorias: CATEGORIAS });
    }
    if (r === "despesas" && req.method === "POST" && !acao) {
      const d = lerDespesa(b);
      if (d.descricao.length < 2) return res.status(400).json({ error: "Descreva a despesa" });
      if (!(d.valor > 0)) return res.status(400).json({ error: "Informe o valor" });
      await setJSON(K.desp(d.id), d);
      await redis("LPUSH", K.despesas, d.id);
      return res.status(201).json({ despesa: d });
    }
    if (r === "despesas" && req.method === "PUT") {
      const atual = await getJSON(K.desp(id));
      if (!atual) return res.status(404).json({ error: "Despesa não encontrada" });
      const d = lerDespesa(b, atual);
      if (d.descricao.length < 2) return res.status(400).json({ error: "Descreva a despesa" });
      if (!(d.valor > 0)) return res.status(400).json({ error: "Informe o valor" });
      if (atual.doCaixa && d.valor !== atual.valor) return res.status(409).json({ error: "Esta despesa saiu do caixa. Desfaça o pagamento antes de mudar o valor." });
      await setJSON(K.desp(id), d);
      return res.status(200).json({ despesa: d });
    }
    if (r === "despesas" && req.method === "DELETE") {
      const atual = await getJSON(K.desp(id));
      if (!atual) return res.status(404).json({ error: "Despesa não encontrada" });
      if (atual.doCaixa) return res.status(409).json({ error: "Esta despesa saiu do caixa. Desfaça o pagamento antes de excluir." });
      await redis("DEL", K.desp(id));
      await redis("LREM", K.despesas, 0, id);
      return res.status(200).json({ ok: true });
    }
    if (r === "despesas" && req.method === "POST" && acao === "pagar") {
      const d = await getJSON(K.desp(id));
      if (!d) return res.status(404).json({ error: "Despesa não encontrada" });
      if (d.pagoEm) return res.status(409).json({ error: "Esta despesa já está paga" });
      const forma = FORMAS_PAG.includes(b.forma) ? b.forma : "pix";
      d.pagoEm = isoDia.test(b.pagoEm || "") ? b.pagoEm : hojeBR();
      d.forma = forma;
      // pago com o dinheiro da gaveta: vira retirada no caixa aberto, para o caixa bater
      if (b.doCaixa) {
        if (forma !== "dinheiro") return res.status(400).json({ error: "Só dá para tirar do caixa o que foi pago em dinheiro" });
        const lojaId = str(b.lojaId, 40) || d.lojaId;
        const caixaId = lojaId && (await redis("GET", K.aberto(lojaId)));
        if (!caixaId) return res.status(409).json({ error: "Abra o caixa da loja para pagar com o dinheiro da gaveta" });
        const caixa = await getJSON(K.caixa(caixaId));
        const movId = randomUUID();
        caixa.movimentos.push({ id: movId, tipo: "sangria", valor: d.valor, motivo: `Despesa: ${d.descricao}`, despesaId: d.id, em: new Date().toISOString(), por: str(b.por, 60) || null });
        (caixa.log ||= []).push({ em: new Date().toISOString(), acao: "retirada", por: str(b.por, 60) || null, valor: d.valor });
        await setJSON(K.caixa(caixaId), caixa);
        d.doCaixa = { caixaId, movId };
      }
      // recorrente: já deixa lançada a do mês seguinte
      let proxima = null;
      if (d.recorrente && !d.proximaId) {
        proxima = { ...lerDespesa({}, { ...d, id: randomUUID(), criadaEm: null }), vencimento: proximoMes(d.vencimento), pagoEm: null, forma: null, doCaixa: null, proximaId: null, compraId: null };
        await setJSON(K.desp(proxima.id), proxima);
        await redis("LPUSH", K.despesas, proxima.id);
        d.proximaId = proxima.id;
      }
      await setJSON(K.desp(id), d);
      return res.status(200).json({ despesa: d, proxima });
    }
    if (r === "despesas" && req.method === "POST" && acao === "desfazer") {
      const d = await getJSON(K.desp(id));
      if (!d?.pagoEm) return res.status(409).json({ error: "Esta despesa não está paga" });
      if (d.doCaixa) {
        const caixa = await getJSON(K.caixa(d.doCaixa.caixaId));
        if (caixa?.status !== "ABERTO") return res.status(409).json({ error: "O caixa em que ela foi paga já foi fechado" });
        caixa.movimentos = caixa.movimentos.filter((m) => m.id !== d.doCaixa.movId);
        (caixa.log ||= []).push({ em: new Date().toISOString(), acao: "estorno", por: str(b.por, 60) || null, valor: d.valor });
        await setJSON(K.caixa(caixa.id), caixa);
      }
      Object.assign(d, { pagoEm: null, forma: null, doCaixa: null });
      await setJSON(K.desp(id), d);
      return res.status(200).json({ despesa: d });
    }

    // ---------- estoque ----------
    if (r === "estoque" && req.method === "GET") {
      const [cat, est, vendas, movs] = await Promise.all([getCatalogo(), getEstoque(), todasVendas(), redis("LRANGE", K.estmov, 0, 499)]);
      const ultimaVenda = {};
      for (const v of vendas) {
        if (v.status === "CANCELADA" || v.tipo === "devolucao") continue;
        v.itens.forEach((it) => { if (it.productId && !(ultimaVenda[it.productId] > v.criadaEm)) ultimaVenda[it.productId] = v.criadaEm; });
      }
      return res.status(200).json({
        produtos: cat.map((p) => ({ ...p, stock: est[p.id] ?? 0, ultimaVenda: ultimaVenda[p.id] || null })),
        movimentos: movs.map((m) => JSON.parse(m)),
      });
    }
    if (r === "estoque" && req.method === "POST" && acao === "ajuste") {
      const cat = await getCatalogo();
      const p = cat.find((x) => x.id === str(b.productId, 120));
      if (!p) return res.status(404).json({ error: "Produto não encontrado" });
      const contagem = parseInt(b.contagem, 10);
      if (!Number.isInteger(contagem) || contagem < 0 || contagem > 99999) return res.status(400).json({ error: "Informe a quantidade contada" });
      const atual = (await getEstoque())[p.id] ?? 0;
      if (contagem === atual) return res.status(200).json({ stock: atual, igual: true });
      const saldos = await moverEstoque([{ productId: p.id, name: p.name, code: p.code, delta: contagem - atual }], "ajuste", str(b.motivo, 120) || "Contagem", b.por);
      return res.status(200).json({ stock: saldos[p.id] });
    }

    // ---------- dashboard ----------
    if (r === "dashboard" && req.method === "GET") {
      return res.status(200).json(await dashboard(req.query));
    }

    return res.status(400).json({ error: "Requisição inválida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro no financeiro" });
  }
}

// ======================================================================
// DASHBOARD: indicadores calculados a partir das vendas, caixas, compras, despesas e estoque
// ======================================================================
const DIA = 86400_000;
const pct = (a, b) => (b ? num((a / b) * 100) : 0);

// vendas do período: receita, CMV, produtos, formas, vendedores, dia da semana e hora
function agregar(vendas, taxas, catPorId) {
  const A = { bruta: 0, devolucoes: 0, cupons: 0, taxas: 0, cmv: 0, perdas: 0, nVendas: 0, nDevol: 0, nTrocas: 0, brutaVendas: 0, qtd: 0 };
  const prods = {}, formas = {}, vends = {}, porDia = {}, semana = Array(7).fill(0), hora = Array(24).fill(0), cats = {};
  for (const v of vendas) {
    const dia = diaBR(v.criadaEm);
    let liq = 0;
    const conta = (it, sinal) => {
      const k = it.productId || `${it.name}|${it.code}`;
      const p = (prods[k] ||= { id: it.productId || null, name: it.name, code: it.code, qtd: 0, valor: 0, custo: 0 });
      const custo = it.custo * it.qty;
      p.qtd += sinal * it.qty; p.valor += sinal * it.sub;
      A.qtd += sinal * it.qty;
      if (sinal > 0) { A.bruta += it.sub; A.cmv += custo; p.custo += custo; }
      else {
        A.devolucoes += it.sub;
        // volta bom: o custo volta para o estoque; com defeito, vira perda (fica no CMV)
        if (it.estado === "defeito") A.perdas += custo; else { A.cmv -= custo; p.custo -= custo; }
      }
      const cat = catPorId[it.productId] || "outros";
      cats[cat] = (cats[cat] || 0) + sinal * it.sub;
      liq += sinal * it.sub;
    };
    if (v.tipo === "devolucao") { A.nDevol++; v.itens.forEach((it) => conta(it, -1)); }
    else {
      if (v.tipo === "troca") A.nTrocas++; else { A.nVendas++; A.brutaVendas += v.itens.reduce((s, it) => s + it.sub, 0) - (v.cupom?.desconto || 0); }
      v.itens.forEach((it) => conta(it, 1));
    }
    (v.devolvidos || []).forEach((it) => conta(it, -1));
    if (v.cupom) { A.cupons += v.cupom.desconto; liq -= v.cupom.desconto; }
    const s = v.tipo === "devolucao" || (v.tipo === "troca" && v.diferenca < 0) ? -1 : 1;
    v.pagamentos.forEach((pg) => {
      formas[pg.forma] = (formas[pg.forma] || 0) + s * pg.valor;
      if (pg.forma === "credito" || pg.forma === "debito") A.taxas += (s * pg.valor * (taxas[pg.forma] || 0)) / 100;
    });
    const vd = (vends[v.vendedor?.nome || "Sem vendedor"] ||= { nome: v.vendedor?.nome || "Sem vendedor", vendas: 0, valor: 0 });
    if (v.tipo === "venda") vd.vendas++;
    vd.valor += liq;
    porDia[dia] = (porDia[dia] || 0) + liq;
    const t = new Date(Date.parse(v.criadaEm) - BR_OFFSET);
    semana[t.getUTCDay()] += liq; hora[t.getUTCHours()] += liq;
  }
  A.liquida = A.bruta - A.devolucoes - A.cupons - A.taxas;
  A.lucroBruto = A.liquida - A.cmv;
  A.ticket = A.nVendas ? A.brutaVendas / A.nVendas : 0;
  Object.keys(A).forEach((k) => (A[k] = num(A[k])));
  const lista = Object.values(prods).map((p) => ({ ...p, valor: num(p.valor), custo: num(p.custo), lucro: num(p.valor - p.custo), margem: pct(p.valor - p.custo, p.valor) }));
  return {
    A, lista, formas: Object.fromEntries(Object.entries(formas).map(([k, v]) => [k, num(v)])),
    vendedores: Object.values(vends).map((v) => ({ ...v, valor: num(v.valor), ticket: v.vendas ? num(v.valor / v.vendas) : 0 })).sort((a, b) => b.valor - a.valor),
    porDia, semana: semana.map(num), hora: hora.map(num), cats,
  };
}

async function dashboard(q) {
  const to = Date.parse(q.to) || Date.now();
  const from = Date.parse(q.from) || to - 30 * DIA;
  const len = Math.max(DIA, to - from);
  const prevFrom = from - len, prevTo = from - 1;
  const lojaId = str(q.lojaId, 40);
  const daLoja = (x) => !lojaId || !x.lojaId || x.lojaId === lojaId;
  const deDia = diaBR(new Date(from).toISOString()), ateDia = diaBR(new Date(to).toISOString());
  const hoje = hojeBR();

  const [setup, cat, est, vendasAll, caixaIds, compraIds, despesas, clientes, fornecedores] = await Promise.all([
    getSetup(), getCatalogo(), getEstoque(), todasVendas(), redis("LRANGE", K.caixas, 0, 999), redis("LRANGE", K.compras, 0, 999),
    listaDespesas(), getJSON(K.clientes), getJSON(K.fornecedores),
  ]);
  const taxas = setup.taxas || {};
  const catPorId = Object.fromEntries(cat.map((p) => [p.id, p.cat]));
  const validas = vendasAll.filter((v) => v.status !== "CANCELADA" && (!lojaId || v.lojaId === lojaId));
  const noPeriodo = (v, a, b) => { const t = Date.parse(v.criadaEm); return t >= a && t <= b; };
  const atual = agregar(validas.filter((v) => noPeriodo(v, from, to)), taxas, catPorId);
  const anterior = agregar(validas.filter((v) => noPeriodo(v, prevFrom, prevTo)), taxas, catPorId);

  // despesas por competência (vencimento) e por caixa (pagamento)
  const desp = despesas.filter(daLoja);
  const operacional = (d) => d.categoria !== "fornecedor";
  const entre = (dia, a, b) => dia >= a && dia <= b;
  const despPeriodo = (a, b) => desp.filter((d) => operacional(d) && entre(d.vencimento, a, b));
  const porCategoria = {};
  despPeriodo(deDia, ateDia).forEach((d) => (porCategoria[d.categoria] = num((porCategoria[d.categoria] || 0) + d.valor)));
  const despOp = num(Object.values(porCategoria).reduce((s, v) => s + v, 0));
  const despOpAnt = num(despPeriodo(diaBR(new Date(prevFrom).toISOString()), diaBR(new Date(prevTo).toISOString())).reduce((s, d) => s + d.valor, 0));

  const kpi = (A, d) => ({
    bruta: A.bruta, liquida: A.liquida, cmv: A.cmv, lucroBruto: A.lucroBruto, margemBruta: pct(A.lucroBruto, A.liquida),
    despesas: d, lucroLiquido: num(A.lucroBruto - d), margemLiquida: pct(A.lucroBruto - d, A.liquida), ticket: num(A.ticket), nVendas: A.nVendas,
  });

  // caixas do período: fiado recebido, retiradas, sobras e faltas
  const caixas = (await mget(caixaIds.map(K.caixa))).filter((c) => c && (!lojaId || c.lojaId === lojaId));
  const fluxo = {};
  const f = (dia) => (fluxo[dia] ||= { entradas: 0, saidas: 0 });
  for (const v of validas.filter((x) => noPeriodo(x, from, to))) {
    const s = v.tipo === "devolucao" || (v.tipo === "troca" && v.diferenca < 0) ? -1 : 1;
    v.pagamentos.filter((p) => FORMAS_RECEBER.includes(p.forma)).forEach((p) => {
      if (s > 0) f(diaBR(v.criadaEm)).entradas += p.valor; else f(diaBR(v.criadaEm)).saidas += p.valor;
    });
  }
  let recebidoFiado = 0, retiradasAvulsas = 0, sobra = 0, falta = 0, nCaixas = 0;
  const esquecidos = [];
  for (const c of caixas) {
    for (const m of c.movimentos || []) {
      if (!entre(diaBR(m.em), deDia, ateDia)) continue;
      if (m.tipo === "recebimento") { recebidoFiado += m.valor; f(diaBR(m.em)).entradas += m.valor; }
      // retirada que não é despesa lançada (a despesa paga já entra abaixo)
      if (m.tipo === "sangria" && !m.despesaId) { retiradasAvulsas += m.valor; f(diaBR(m.em)).saidas += m.valor; }
    }
    if (!entre(diaBR(c.abertoEm), deDia, ateDia)) continue;
    nCaixas++;
    if (c.status === "FECHADO" && c.contado != null) {
      const vendasCx = validas.filter((v) => v.caixaId === c.id);
      const dif = resumo(c, vendasCx).diferenca || 0;
      if (dif > 0) sobra += dif; else falta -= dif;
    }
    const fim = c.fechadoEm || new Date().toISOString();
    if (diaBR(fim) !== diaBR(c.abertoEm)) esquecidos.push({ abertoEm: c.abertoEm, fechadoEm: c.fechadoEm, lojaNome: c.lojaNome, dias: Math.round((Date.parse(fim) - Date.parse(c.abertoEm)) / DIA) });
  }
  let pagoFornecedor = 0, pagoDespesas = 0;
  desp.filter((d) => d.pagoEm && entre(d.pagoEm, deDia, ateDia)).forEach((d) => {
    f(d.pagoEm).saidas += d.valor;
    if (d.categoria === "fornecedor") pagoFornecedor += d.valor; else pagoDespesas += d.valor;
  });
  const entradas = num(Object.values(fluxo).reduce((s, x) => s + x.entradas, 0));
  const saidas = num(Object.values(fluxo).reduce((s, x) => s + x.saidas, 0) + atual.A.taxas);

  // ponto de equilíbrio do mês corrente
  const mesIni = hoje.slice(0, 8) + "01";
  const [yy, mm] = hoje.split("-").map(Number);
  const diasMes = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const diasPassados = Number(hoje.slice(8, 10));
  const mesIniMs = Date.parse(`${mesIni}T00:00:00-03:00`);
  const mes = agregar(validas.filter((v) => Date.parse(v.criadaEm) >= mesIniMs), taxas, catPorId).A;
  const despMes = num(despPeriodo(mesIni, `${hoje.slice(0, 8)}31`).reduce((s, d) => s + d.valor, 0));
  const mc = mes.liquida > 0 ? mes.lucroBruto / mes.liquida : atual.A.liquida > 0 ? atual.A.lucroBruto / atual.A.liquida : 0;
  const projecao = diasPassados ? (mes.liquida / diasPassados) * diasMes : 0;
  const equilibrio = {
    despesasMes: despMes, margemContribuicao: num(mc * 100), pontoEquilibrio: mc > 0 ? num(despMes / mc) : null,
    vendidoMes: mes.liquida, projecao: num(projecao), lucroProjetado: num(projecao * mc - despMes), diasPassados, diasMes,
  };

  // contas a pagar e a receber
  const emDias = (n) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
  const abertas = desp.filter((d) => !d.pagoEm).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const somaV = (l) => num(l.reduce((s, d) => s + d.valor, 0));
  const pagar = {
    vencidas: somaV(abertas.filter((d) => d.vencimento < hoje)), qtdVencidas: abertas.filter((d) => d.vencimento < hoje).length,
    semana: somaV(abertas.filter((d) => entre(d.vencimento, hoje, emDias(7)))), mes: somaV(abertas.filter((d) => entre(d.vencimento, hoje, emDias(30)))),
    proximas: abertas.slice(0, 8).map(({ id, descricao, categoria, valor, vencimento }) => ({ id, descricao, categoria, valor, vencimento })),
  };
  const devedores = (clientes || []).filter((c) => c.fiado > 0).sort((a, b) => b.fiado - a.fiado);
  const receber = {
    fiado: somaV(devedores.map((c) => ({ valor: c.fiado }))), qtd: devedores.length,
    clientes: devedores.slice(0, 8).map((c) => ({ id: c.id, nome: c.nome, valor: c.fiado, desde: c.fiadoDesde || null })),
    maisAntigo: devedores.map((c) => c.fiadoDesde).filter(Boolean).sort()[0] || null,
    creditoLoja: num((clientes || []).reduce((s, c) => s + (c.credito || 0), 0)), recebidoPeriodo: num(recebidoFiado),
  };

  // estoque
  const ultimaVenda = {};
  for (const v of vendasAll) if (v.status !== "CANCELADA" && v.tipo !== "devolucao") v.itens.forEach((it) => { if (it.productId && !(ultimaVenda[it.productId] > v.criadaEm)) ultimaVenda[it.productId] = v.criadaEm; });
  const limite60 = Date.now() - 60 * DIA;
  let valorCusto = 0, valorVenda = 0, unidades = 0;
  const semEstoque = [], abaixoMin = [], negativos = [], parados = [];
  for (const p of cat) {
    const s = est[p.id] ?? 0, preco = p.promo ?? p.price;
    const item = { id: p.id, name: p.name, code: p.code, stock: s, min: p.min || 0, cost: p.cost || 0 };
    if (s > 0) { valorCusto += s * (p.cost || 0); valorVenda += s * preco; unidades += s; }
    if (s < 0) negativos.push(item);
    if (s <= 0) semEstoque.push(item);
    else if (p.min && s <= p.min) abaixoMin.push(item);
    const ult = ultimaVenda[p.id] ? Date.parse(ultimaVenda[p.id]) : 0;
    if (s > 0 && ult < limite60 && (p.createdAt || 0) < limite60) parados.push({ ...item, valor: num(s * (p.cost || 0)), ultimaVenda: ultimaVenda[p.id] || null });
  }
  parados.sort((a, b) => b.valor - a.valor);
  const dias = Math.max(1, Math.round(len / DIA));
  const cmvDia = atual.A.cmv / dias;
  // curva ABC por faturamento: A até 80%, B até 95%, C o resto
  const vendidos = atual.lista.filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const totalVend = vendidos.reduce((s, p) => s + p.valor, 0);
  let acc = 0;
  const abc = vendidos.map((p) => { acc += p.valor; const share = totalVend ? acc / totalVend : 0; return { ...p, classe: share <= 0.8 || acc === p.valor ? "A" : share <= 0.95 ? "B" : "C" }; });
  const classe = (c) => { const l = abc.filter((p) => p.classe === c); return { produtos: l.length, valor: num(l.reduce((s, p) => s + p.valor, 0)) }; };
  const estoque = {
    valorCusto: num(valorCusto), valorVenda: num(valorVenda), lucroPotencial: num(valorVenda - valorCusto), unidades, skus: cat.length,
    semEstoque: semEstoque.length, abaixoMin: abaixoMin.length, negativos: negativos.slice(0, 10),
    listaSemEstoque: semEstoque.slice(0, 10), listaAbaixoMin: abaixoMin.slice(0, 10),
    parados: parados.length, valorParado: num(parados.reduce((s, p) => s + p.valor, 0)), listaParados: parados.slice(0, 10),
    giro: valorCusto ? num(atual.A.cmv / valorCusto) : null, coberturaDias: cmvDia > 0 ? Math.round(valorCusto / cmvDia) : null,
    abc: { A: classe("A"), B: classe("B"), C: classe("C"), lista: abc.slice(0, 15) },
  };

  // compras do período e quanto delas ainda não tem pagamento lançado
  const compras = (await mget(compraIds.map(K.compra))).filter((c) => c && daLoja(c) && entre(c.data, deDia, ateDia));
  const pagas = new Set(desp.filter((d) => d.compraId && d.pagoEm).map((d) => d.compraId));
  const porForn = {};
  compras.forEach((c) => { const x = (porForn[c.fornecedor.id] ||= { nome: c.fornecedor.nome, total: 0, compras: 0 }); x.total = num(x.total + c.total); x.compras++; });

  const nomeForn = Object.fromEntries((fornecedores || []).map((x) => [x.id, x.nome]));
  return {
    periodo: { de: deDia, ate: ateDia, dias, anteriorDe: diaBR(new Date(prevFrom).toISOString()), anteriorAte: diaBR(new Date(prevTo).toISOString()) },
    taxas,
    kpi: kpi(atual.A, despOp), kpiAnterior: kpi(anterior.A, despOpAnt),
    dre: { ...atual.A, despesas: porCategoria, despesasTotal: despOp, resultado: num(atual.A.lucroBruto - despOp) },
    categorias: CATEGORIAS,
    porDia: Object.entries(atual.porDia).map(([dia, v]) => ({ dia, valor: num(v) })).sort((a, b) => a.dia.localeCompare(b.dia)),
    fluxo: {
      entradas, saidas, saldo: num(entradas - saidas), recebidoFiado: num(recebidoFiado), retiradas: num(retiradasAvulsas),
      pagoDespesas: num(pagoDespesas), pagoFornecedor: num(pagoFornecedor), taxas: atual.A.taxas,
      dias: Object.entries(fluxo).map(([dia, x]) => ({ dia, entradas: num(x.entradas), saidas: num(x.saidas) })).sort((a, b) => a.dia.localeCompare(b.dia)),
    },
    formas: atual.formas,
    equilibrio, pagar, receber, estoque,
    produtos: {
      top: [...atual.lista].sort((a, b) => b.valor - a.valor).slice(0, 10),
      lucro: [...atual.lista].sort((a, b) => b.lucro - a.lucro).slice(0, 10),
      piores: atual.lista.filter((p) => p.valor > 0).sort((a, b) => a.margem - b.margem).slice(0, 8),
      categorias: Object.entries(atual.cats).map(([cat, valor]) => ({ cat, valor: num(valor) })).sort((a, b) => b.valor - a.valor),
    },
    vendedores: atual.vendedores, semana: atual.semana, hora: atual.hora,
    controle: {
      devolucoes: atual.A.devolucoes, taxaDevolucao: pct(atual.A.devolucoes, atual.A.bruta), perdas: atual.A.perdas, nDevol: atual.A.nDevol, nTrocas: atual.A.nTrocas,
      caixas: nCaixas, sobra: num(sobra), falta: num(falta), esquecidos, cupons: atual.A.cupons,
    },
    compras: {
      total: num(compras.reduce((s, c) => s + c.total, 0)), qtd: compras.length,
      semPagamento: num(compras.filter((c) => !pagas.has(c.id)).reduce((s, c) => s + c.total, 0)),
      fornecedores: Object.values(porForn).sort((a, b) => b.total - a.total), nomeForn,
    },
  };
}
