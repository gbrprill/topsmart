// Ponto de venda (venda balcão), caixa diário, lojas e vendedores. Tudo restrito ao admin.
//
// GET    /api/pdv?r=setup                        lojas, vendedores e caixas abertos
// PUT    /api/pdv?r=setup                        salva lojas e vendedores
// POST   /api/pdv?r=caixa&acao=abrir             { lojaId, fundo }
// POST   /api/pdv?r=caixa&acao=movimento&id=     { tipo: sangria|suprimento, valor, motivo }
// POST   /api/pdv?r=caixa&acao=fechar&id=        { contado, obs }
// GET    /api/pdv?r=caixas&lojaId=               últimos caixas (com resumo calculado no servidor)
// GET    /api/pdv?r=caixa&id=                    um caixa com as vendas dele
// POST   /api/pdv?r=venda                        registra venda ou devolução no caixa aberto da loja
// POST   /api/pdv?r=venda&acao=cancelar&code=    cancela uma venda (não conta mais no caixa)
// GET    /api/pdv?r=vendas&from=ISO&to=ISO&lojaId=  vendas do período (relatórios)

import { randomUUID } from "node:crypto";
import { hasRedis, redis, str, num, isAdmin } from "./_shared.js";

// a versão de revisão (preview) usa chaves separadas para não misturar com a produção
const P = process.env.VERCEL_ENV === "production" ? "ts:pdv:" : "ts:pdvrev:";
const K = {
  setup: `${P}setup`,
  caixa: (id) => `${P}caixa:${id}`,
  caixas: `${P}caixas`,
  aberto: (lojaId) => `${P}aberto:${lojaId}`,
  venda: (code) => `${P}venda:${code}`,
  vendas: `${P}vendas`,
  seq: `${P}venda_seq`,
};
const FORMAS = ["dinheiro", "pix", "credito", "debito", "fiado"];
const DEFAULT_SETUP = { lojas: [{ id: "eng", nome: "Top Smart ENG" }], vendedores: [] };

const getJSON = async (key) => { const raw = await redis("GET", key); return raw ? JSON.parse(raw) : null; };
const setJSON = (key, v) => redis("SET", key, JSON.stringify(v));
async function mget(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 200) out.push(...(await redis("MGET", ...keys.slice(i, i + 200))));
  return out.map((r) => (r ? JSON.parse(r) : null));
}

// resumo do caixa: tudo calculado a partir das vendas e movimentos, nunca digitado
function resumo(caixa, vendas) {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0]));
  let bruto = 0, devolvido = 0, qtdVendas = 0, qtdDevolucoes = 0;
  for (const v of vendas) {
    if (v.status === "CANCELADA") continue;
    const sinal = v.tipo === "devolucao" ? -1 : 1;
    if (sinal > 0) { bruto += v.total; qtdVendas++; } else { devolvido += v.total; qtdDevolucoes++; }
    for (const p of v.pagamentos) porForma[p.forma] = num((porForma[p.forma] || 0) + sinal * p.valor);
  }
  const sangrias = caixa.movimentos.filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
  const suprimentos = caixa.movimentos.filter((m) => m.tipo === "suprimento").reduce((s, m) => s + m.valor, 0);
  const dinheiroEsperado = num(caixa.fundo + porForma.dinheiro + suprimentos - sangrias);
  return {
    porForma, bruto: num(bruto), devolvido: num(devolvido), liquido: num(bruto - devolvido),
    qtdVendas, qtdDevolucoes, sangrias: num(sangrias), suprimentos: num(suprimentos), dinheiroEsperado,
    diferenca: caixa.contado == null ? null : num(caixa.contado - dinheiroEsperado),
  };
}

async function vendasDoCaixa(caixa) {
  return (await mget(caixa.vendas.map(K.venda))).filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasRedis()) return res.status(503).json({ error: "Armazenamento não configurado" });
  if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });

  const r = str(req.query.r, 20), acao = str(req.query.acao, 20), b = req.body || {};
  try {
    // ---------- lojas e vendedores ----------
    if (r === "setup" && req.method === "GET") {
      const setup = (await getJSON(K.setup)) || DEFAULT_SETUP;
      const abertos = {};
      for (const l of setup.lojas) {
        const id = await redis("GET", K.aberto(l.id));
        if (id) abertos[l.id] = await getJSON(K.caixa(id));
      }
      return res.status(200).json({ ...setup, abertos });
    }
    if (r === "setup" && req.method === "PUT") {
      const lojas = (Array.isArray(b.lojas) ? b.lojas : []).slice(0, 20)
        .map((l) => ({ id: str(l.id, 40) || randomUUID().slice(0, 8), nome: str(l.nome, 60) })).filter((l) => l.nome);
      if (!lojas.length) return res.status(400).json({ error: "Cadastre pelo menos uma loja" });
      const ids = new Set(lojas.map((l) => l.id));
      const vendedores = (Array.isArray(b.vendedores) ? b.vendedores : []).slice(0, 100)
        .map((v) => ({ id: str(v.id, 40) || randomUUID().slice(0, 8), nome: str(v.nome, 60), lojaId: str(v.lojaId, 40), ativo: v.ativo !== false }))
        .filter((v) => v.nome && ids.has(v.lojaId));
      await setJSON(K.setup, { lojas, vendedores });
      return res.status(200).json({ lojas, vendedores });
    }

    // ---------- caixa ----------
    if (r === "caixa" && req.method === "POST" && acao === "abrir") {
      const setup = (await getJSON(K.setup)) || DEFAULT_SETUP;
      const loja = setup.lojas.find((l) => l.id === str(b.lojaId, 40));
      if (!loja) return res.status(400).json({ error: "Loja inválida" });
      if (await redis("GET", K.aberto(loja.id))) return res.status(409).json({ error: "Já existe um caixa aberto nesta loja. Feche-o antes de abrir outro." });
      const fundo = Math.max(0, Math.min(1e6, num(b.fundo)));
      const caixa = { id: randomUUID(), lojaId: loja.id, lojaNome: loja.nome, status: "ABERTO", abertoEm: new Date().toISOString(), fundo, movimentos: [], vendas: [], contado: null, fechadoEm: null, obs: "" };
      // SET NX garante um único caixa aberto por loja mesmo com dois cliques ao mesmo tempo
      const ok = await redis("SET", K.aberto(loja.id), caixa.id, "NX");
      if (ok !== "OK") return res.status(409).json({ error: "Já existe um caixa aberto nesta loja." });
      await setJSON(K.caixa(caixa.id), caixa);
      await redis("LPUSH", K.caixas, caixa.id);
      return res.status(201).json({ caixa, resumo: resumo(caixa, []) });
    }
    if (r === "caixa" && req.method === "POST" && (acao === "movimento" || acao === "fechar")) {
      const caixa = await getJSON(K.caixa(str(req.query.id, 60)));
      if (!caixa) return res.status(404).json({ error: "Caixa não encontrado" });
      if (caixa.status !== "ABERTO") return res.status(409).json({ error: "Este caixa já foi fechado" });
      if (acao === "movimento") {
        const tipo = b.tipo === "suprimento" ? "suprimento" : "sangria";
        const valor = num(b.valor);
        if (!(valor > 0 && valor <= 1e6)) return res.status(400).json({ error: "Valor inválido" });
        caixa.movimentos.push({ id: randomUUID(), tipo, valor, motivo: str(b.motivo, 120), em: new Date().toISOString() });
      } else {
        const contado = num(b.contado);
        if (!(contado >= 0 && contado <= 1e7)) return res.status(400).json({ error: "Informe o dinheiro contado na gaveta" });
        Object.assign(caixa, { status: "FECHADO", contado, fechadoEm: new Date().toISOString(), obs: str(b.obs, 300) });
        await redis("DEL", K.aberto(caixa.lojaId));
      }
      await setJSON(K.caixa(caixa.id), caixa);
      return res.status(200).json({ caixa, resumo: resumo(caixa, await vendasDoCaixa(caixa)) });
    }
    if (r === "caixa" && req.method === "GET") {
      const caixa = await getJSON(K.caixa(str(req.query.id, 60)));
      if (!caixa) return res.status(404).json({ error: "Caixa não encontrado" });
      const vendas = await vendasDoCaixa(caixa);
      return res.status(200).json({ caixa, vendas, resumo: resumo(caixa, vendas) });
    }
    if (r === "caixas" && req.method === "GET") {
      const ids = await redis("LRANGE", K.caixas, 0, 59);
      const lojaId = str(req.query.lojaId, 40);
      const caixas = (await mget(ids.map(K.caixa))).filter((c) => c && (!lojaId || c.lojaId === lojaId));
      const todas = await mget(caixas.flatMap((c) => c.vendas).map(K.venda));
      const porCodigo = Object.fromEntries(todas.filter(Boolean).map((v) => [v.code, v]));
      return res.status(200).json({ caixas: caixas.map((c) => ({ caixa: c, resumo: resumo(c, c.vendas.map((code) => porCodigo[code]).filter(Boolean)) })) });
    }

    // ---------- vendas ----------
    if (r === "venda" && req.method === "POST" && acao === "cancelar") {
      const venda = await getJSON(K.venda(str(req.query.code, 20).toUpperCase()));
      if (!venda) return res.status(404).json({ error: "Venda não encontrada" });
      const caixa = await getJSON(K.caixa(venda.caixaId));
      if (caixa?.status !== "ABERTO") return res.status(409).json({ error: "Só dá para cancelar vendas do caixa aberto" });
      venda.status = "CANCELADA"; venda.canceladaEm = new Date().toISOString(); venda.motivoCancelamento = str(b.motivo, 120);
      await setJSON(K.venda(venda.code), venda);
      return res.status(200).json({ venda });
    }
    if (r === "venda" && req.method === "POST") {
      const setup = (await getJSON(K.setup)) || DEFAULT_SETUP;
      const lojaId = str(b.lojaId, 40);
      const caixaId = await redis("GET", K.aberto(lojaId));
      if (!caixaId) return res.status(409).json({ error: "Abra o caixa desta loja antes de vender" });
      const vendedor = setup.vendedores.find((v) => v.id === str(b.vendedorId, 40) && v.lojaId === lojaId);
      if (!vendedor) return res.status(400).json({ error: "Escolha o vendedor" });
      const tipo = b.tipo === "devolucao" ? "devolucao" : "venda";

      const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 200).map((it) => {
        const qty = Math.max(1, Math.min(9999, parseInt(it.qty, 10) || 1));
        const unit = Math.max(0, Math.min(1e6, num(it.unit)));
        const desconto = Math.max(0, Math.min(unit * qty, num(it.desconto)));
        return {
          productId: str(it.productId, 120), name: str(it.name, 160), code: str(it.code, 20), variant: str(it.variant, 60) || null,
          qty, unit, desconto, custo: Math.max(0, Math.min(1e6, num(it.custo))), sub: num(unit * qty - desconto),
        };
      }).filter((it) => it.name);
      if (!itens.length) return res.status(400).json({ error: "Adicione pelo menos um produto" });
      const total = num(itens.reduce((s, it) => s + it.sub, 0));

      const pagamentos = (Array.isArray(b.pagamentos) ? b.pagamentos : []).slice(0, 6)
        .map((p) => ({ forma: FORMAS.includes(p.forma) ? p.forma : null, valor: Math.max(0, num(p.valor)) }))
        .filter((p) => p.forma && p.valor > 0);
      const pago = num(pagamentos.reduce((s, p) => s + p.valor, 0));
      // dinheiro pode passar do total (troco); as outras formas precisam fechar exatamente
      const naoDinheiro = num(pagamentos.filter((p) => p.forma !== "dinheiro").reduce((s, p) => s + p.valor, 0));
      if (naoDinheiro > total + 0.001) return res.status(400).json({ error: "Pagamentos em Pix, cartão ou fiado passam do total" });
      if (pago + 0.001 < total) return res.status(400).json({ error: `Faltam ${(total - pago).toFixed(2).replace(".", ",")} para fechar o pagamento` });
      if (tipo === "devolucao" && pagamentos.some((p) => p.forma === "fiado")) return res.status(400).json({ error: "Devolução não pode ser em fiado" });
      const troco = num(pago - total);
      // o troco sai do dinheiro recebido: no caixa entra só o que ficou
      if (troco > 0) {
        const din = pagamentos.find((p) => p.forma === "dinheiro");
        din.recebido = din.valor; din.valor = num(din.valor - troco);
      }

      const c = b.cliente || {};
      const cliente = c.nome ? { nome: str(c.nome, 120), doc: str(c.doc, 20), telefone: str(c.telefone, 20), tipo: c.tipo === "lojista" ? "lojista" : "cliente" } : null;
      if (pagamentos.some((p) => p.forma === "fiado") && !cliente) return res.status(400).json({ error: "Venda no fiado precisa de cliente identificado" });

      const seq = await redis("INCR", K.seq);
      const venda = {
        code: `${tipo === "devolucao" ? "DV" : "VB"}-${String(seq).padStart(6, "0")}`,
        tipo, status: "CONCLUIDA", criadaEm: new Date().toISOString(), lojaId, lojaNome: setup.lojas.find((l) => l.id === lojaId)?.nome || "",
        caixaId, vendedor: { id: vendedor.id, nome: vendedor.nome }, cliente, itens, total, pagamentos, troco, obs: str(b.obs, 300),
      };
      await setJSON(K.venda(venda.code), venda);
      await redis("LPUSH", K.vendas, venda.code);
      const caixa = await getJSON(K.caixa(caixaId));
      caixa.vendas.push(venda.code);
      await setJSON(K.caixa(caixaId), caixa);
      return res.status(201).json({ venda });
    }
    if (r === "vendas" && req.method === "GET") {
      const from = Date.parse(req.query.from) || 0, to = Date.parse(req.query.to) || Date.now();
      const lojaId = str(req.query.lojaId, 40);
      const codes = await redis("LRANGE", K.vendas, 0, 4999);
      const vendas = (await mget(codes.map(K.venda))).filter((v) => {
        if (!v) return false;
        const t = Date.parse(v.criadaEm);
        return t >= from && t <= to && (!lojaId || v.lojaId === lojaId);
      });
      return res.status(200).json({ vendas });
    }

    return res.status(400).json({ error: "Requisição inválida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro no ponto de venda" });
  }
}
