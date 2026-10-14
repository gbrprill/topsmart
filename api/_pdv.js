// Chaves e funções do ponto de venda usadas por mais de uma rota (pdv, catalogo, financeiro).
// Arquivos com "_" não viram rota na Vercel.
import { redis, num, str } from "./_shared.js";

// a versão de revisão (preview) usa chaves separadas para não misturar com a produção
export const P = process.env.VERCEL_ENV === "production" ? "ts:pdv:" : "ts:pdvrev:";
export const K = {
  setup: `${P}setup`,
  caixa: (id) => `${P}caixa:${id}`,
  caixas: `${P}caixas`,
  aberto: (lojaId) => `${P}aberto:${lojaId}`,
  venda: (code) => `${P}venda:${code}`,
  vendas: `${P}vendas`,
  seq: `${P}venda_seq`,
  clientes: `${P}clientes`,
  fornecedores: `${P}fornecedores`,
  compra: (id) => `${P}compra:${id}`,
  compras: `${P}compras`,
  // catálogo: lista de produtos sem foto; foto em chave própria; estoque num hash (HINCRBY é atômico)
  catalogo: `${P}catalogo`,
  img: (id) => `${P}img:${id}`,
  estoque: `${P}estoque`,
  estmov: `${P}estmov`,
  desp: (id) => `${P}desp:${id}`,
  despesas: `${P}despesas`,
};
// credito_loja: saldo do cliente na loja (gerado em trocas/devoluções, usado como pagamento)
export const FORMAS = ["dinheiro", "pix", "credito", "debito", "fiado", "credito_loja"];
// formas que entram de verdade no caixa (dinheiro na gaveta ou na conta)
export const FORMAS_RECEBER = ["dinheiro", "pix", "credito", "debito"];
export const DEFAULT_SETUP = { lojas: [{ id: "eng", nome: "Top Smart ENG" }], vendedores: [], taxas: { credito: 0, debito: 0 } };

export const getJSON = async (key) => { const raw = await redis("GET", key); return raw ? JSON.parse(raw) : null; };
export const setJSON = (key, v) => redis("SET", key, JSON.stringify(v));
export async function mget(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 200) out.push(...(await redis("MGET", ...keys.slice(i, i + 200))));
  return out.map((r) => (r ? JSON.parse(r) : null));
}
export const getSetup = async () => ({ ...DEFAULT_SETUP, ...((await getJSON(K.setup)) || {}) });

// resumo do caixa: tudo calculado a partir das vendas e movimentos, nunca digitado
export function resumo(caixa, vendas) {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  let bruto = 0, devolvido = 0, qtdVendas = 0, qtdDevolucoes = 0, qtdTrocas = 0;
  for (const v of vendas) {
    if (v.status === "CANCELADA") continue;
    // troca: conta como venda se o cliente pagou diferença, como devolução se recebeu de volta
    const sinal = v.tipo === "devolucao" || (v.tipo === "troca" && v.diferenca < 0) ? -1 : 1;
    if (v.tipo === "troca") qtdTrocas++;
    else if (sinal > 0) qtdVendas++; else qtdDevolucoes++;
    if (sinal > 0) bruto += v.total; else devolvido += v.total;
    for (const p of v.pagamentos) porForma[p.forma] = num((porForma[p.forma] || 0) + sinal * p.valor);
  }
  const movs = caixa.movimentos || [];
  const sangrias = movs.filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
  const suprimentos = movs.filter((m) => m.tipo === "suprimento").reduce((s, m) => s + m.valor, 0);
  // fiado recebido: entra no caixa pela forma usada, mas não é venda nova
  const recebimentos = Object.fromEntries(FORMAS_RECEBER.map((f) => [f, 0]));
  movs.filter((m) => m.tipo === "recebimento").forEach((m) => (recebimentos[m.forma] = num((recebimentos[m.forma] || 0) + m.valor)));
  const recebido = num(Object.values(recebimentos).reduce((s, v) => s + v, 0));
  // o que entrou de verdade em cada forma: vendas + fiado recebido
  const entradas = Object.fromEntries(FORMAS_RECEBER.map((f) => [f, num(porForma[f] + recebimentos[f])]));
  const dinheiroEsperado = num(caixa.fundo + entradas.dinheiro + suprimentos - sangrias);
  return {
    porForma, entradas, recebimentos, recebido, bruto: num(bruto), devolvido: num(devolvido), liquido: num(bruto - devolvido),
    qtdVendas, qtdDevolucoes, qtdTrocas, sangrias: num(sangrias), suprimentos: num(suprimentos), dinheiroEsperado,
    diferenca: caixa.contado == null ? null : num(caixa.contado - dinheiroEsperado),
  };
}

// ---------- catálogo e estoque ----------
export const getCatalogo = async () => (await getJSON(K.catalogo)) || [];
export async function getEstoque() {
  const flat = (await redis("HGETALL", K.estoque)) || [];
  const out = {};
  // Upstash devolve HGETALL como lista [campo, valor, campo, valor...]
  if (Array.isArray(flat)) for (let i = 0; i < flat.length; i += 2) out[flat[i]] = parseInt(flat[i + 1], 10) || 0;
  else Object.entries(flat).forEach(([k, v]) => (out[k] = parseInt(v, 10) || 0));
  return out;
}

// movimenta o estoque e guarda o histórico. movs: [{ productId, name, code, delta }]
// devolve { [productId]: saldo } só dos produtos que existem no catálogo
export async function moverEstoque(movs, motivo, ref, por) {
  const ids = new Set((await getCatalogo()).map((p) => p.id));
  const saldos = {};
  const log = [];
  for (const m of movs) {
    const delta = parseInt(m.delta, 10) || 0;
    if (!delta || !ids.has(m.productId)) continue;
    const saldo = await redis("HINCRBY", K.estoque, m.productId, delta);
    saldos[m.productId] = saldo;
    log.push(JSON.stringify({ em: new Date().toISOString(), productId: m.productId, name: str(m.name, 160), code: str(m.code, 20), delta, saldo, motivo, ref: ref || null, por: str(por, 60) || null }));
  }
  if (log.length) {
    await redis("LPUSH", K.estmov, ...log);
    await redis("LTRIM", K.estmov, 0, 9999);
  }
  return saldos;
}

// soma itens iguais e devolve as movimentações de estoque de uma venda, troca ou devolução
export function movsDaVenda(venda) {
  const movs = [];
  if (venda.tipo === "devolucao") venda.itens.forEach((it) => it.estado !== "defeito" && movs.push({ ...it, delta: it.qty }));
  else venda.itens.forEach((it) => movs.push({ ...it, delta: -it.qty }));
  (venda.devolvidos || []).forEach((it) => it.estado !== "defeito" && movs.push({ ...it, delta: it.qty }));
  return movs.filter((m) => m.productId).map(({ productId, name, code, delta }) => ({ productId, name, code, delta }));
}

// dia no fuso de Brasília (UTC-3, sem horário de verão desde 2019)
export const BR_OFFSET = 3 * 3600_000;
export const diaBR = (iso) => new Date(Date.parse(iso) - BR_OFFSET).toISOString().slice(0, 10);
export const hojeBR = () => diaBR(new Date().toISOString());
