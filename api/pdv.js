// Ponto de venda (venda balcão), caixa diário, lojas e vendedores. Tudo restrito ao admin.
//
// GET    /api/pdv?r=setup                        lojas, vendedores e caixas abertos
// PUT    /api/pdv?r=setup                        salva lojas e vendedores
// POST   /api/pdv?r=caixa&acao=abrir             { lojaId, fundo }
// POST   /api/pdv?r=caixa&acao=movimento&id=     { tipo: sangria|suprimento, valor, motivo }
// POST   /api/pdv?r=caixa&acao=fechar&id=        { contado, obs }
// GET    /api/pdv?r=caixas&lojaId=               últimos caixas (com resumo calculado no servidor)
// GET    /api/pdv?r=caixa&id=                    um caixa com as vendas dele
// POST   /api/pdv?r=venda                        registra venda, troca ou devolução no caixa aberto da loja
// GET    /api/pdv?r=clientes                     clientes cadastrados no balcão
// POST   /api/pdv?r=clientes                     cadastra cliente novo { nome, doc, telefone, tipo }
// PUT    /api/pdv?r=clientes&id=                 edita dados do cliente
// POST   /api/pdv?r=clientes&acao=credito&id=    ajuste manual de crédito na loja { valor (+/-), motivo }
// GET    /api/pdv?r=fornecedores                 fornecedores + últimas entradas de estoque
// PUT    /api/pdv?r=fornecedores                 salva a lista de fornecedores
// POST   /api/pdv?r=compra                       registra entrada de estoque { fornecedorId, nota, data, itens }
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
  clientes: `${P}clientes`,
  fornecedores: `${P}fornecedores`,
  compra: (id) => `${P}compra:${id}`,
  compras: `${P}compras`,
};
// credito_loja: saldo do cliente na loja (gerado em trocas/devoluções, usado como pagamento)
const FORMAS = ["dinheiro", "pix", "credito", "debito", "fiado", "credito_loja"];
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
  const sangrias = caixa.movimentos.filter((m) => m.tipo === "sangria").reduce((s, m) => s + m.valor, 0);
  const suprimentos = caixa.movimentos.filter((m) => m.tipo === "suprimento").reduce((s, m) => s + m.valor, 0);
  const dinheiroEsperado = num(caixa.fundo + porForma.dinheiro + suprimentos - sangrias);
  return {
    porForma, bruto: num(bruto), devolvido: num(devolvido), liquido: num(bruto - devolvido),
    qtdVendas, qtdDevolucoes, qtdTrocas, sangrias: num(sangrias), suprimentos: num(suprimentos), dinheiroEsperado,
    diferenca: caixa.contado == null ? null : num(caixa.contado - dinheiroEsperado),
  };
}

// soma (ou tira) crédito do cliente e guarda o extrato; devolve o saldo novo
async function moverCredito(clienteId, valor, motivo, ref, permitirNegativo = false) {
  const lista = (await getJSON(K.clientes)) || [];
  const cad = lista.find((x) => x.id === clienteId);
  if (!cad) return null;
  cad.credito = num((cad.credito || 0) + valor);
  if (cad.credito < 0 && !permitirNegativo) cad.credito = 0;
  cad.extrato = [{ em: new Date().toISOString(), valor: num(valor), motivo: str(motivo, 120), ref: ref || null }, ...(cad.extrato || [])].slice(0, 60);
  await setJSON(K.clientes, lista);
  return cad.credito;
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
      return res.status(200).json({ ...setup, abertos, clientes: (await getJSON(K.clientes)) || [] });
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
      if (venda.status === "CANCELADA") return res.status(409).json({ error: "Esta venda já foi cancelada" });
      venda.status = "CANCELADA"; venda.canceladaEm = new Date().toISOString(); venda.motivoCancelamento = str(b.motivo, 120);
      // desfaz o crédito na loja que essa venda gerou ou consumiu
      if (venda.creditoMov && venda.cliente?.id) await moverCredito(venda.cliente.id, -venda.creditoMov, `Cancelamento ${venda.code}`, venda.code, true);
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
      const tipo = ["devolucao", "troca"].includes(b.tipo) ? b.tipo : "venda";

      const lerItens = (lista, comEstado) => (Array.isArray(lista) ? lista : []).slice(0, 200).map((it) => {
        const qty = Math.max(1, Math.min(9999, parseInt(it.qty, 10) || 1));
        const unit = Math.max(0, Math.min(1e6, num(it.unit)));
        const desconto = Math.max(0, Math.min(unit * qty, num(it.desconto)));
        const item = {
          productId: str(it.productId, 120), name: str(it.name, 160), code: str(it.code, 20), variant: str(it.variant, 60) || null,
          qty, unit, desconto, custo: Math.max(0, Math.min(1e6, num(it.custo))), sub: num(unit * qty - desconto),
        };
        // estado do produto que voltou: "bom" volta ao estoque, "defeito" não volta
        if (comEstado) item.estado = it.estado === "defeito" ? "defeito" : "bom";
        return item;
      }).filter((it) => it.name);

      // venda: itens saem. devolução: itens voltam. troca: "devolvidos" voltam e "itens" saem.
      const itens = lerItens(b.itens, tipo === "devolucao");
      const devolvidos = tipo === "troca" ? lerItens(b.devolvidos, true) : [];
      if (!itens.length) return res.status(400).json({ error: tipo === "troca" ? "Adicione o produto que o cliente vai levar" : "Adicione pelo menos um produto" });
      if (tipo === "troca" && !devolvidos.length) return res.status(400).json({ error: "Adicione o produto que o cliente devolveu" });
      const levado = num(itens.reduce((s, it) => s + it.sub, 0));
      const voltou = num(devolvidos.reduce((s, it) => s + it.sub, 0));
      const diferenca = tipo === "troca" ? num(levado - voltou) : null;
      const total = tipo === "troca" ? Math.abs(diferenca) : levado;

      const pagamentos = (Array.isArray(b.pagamentos) ? b.pagamentos : []).slice(0, 6)
        .map((p) => ({ forma: FORMAS.includes(p.forma) ? p.forma : null, valor: Math.max(0, num(p.valor)) }))
        .filter((p) => p.forma && p.valor > 0);
      const pago = num(pagamentos.reduce((s, p) => s + p.valor, 0));
      // dinheiro pode passar do total (troco); as outras formas precisam fechar exatamente
      const naoDinheiro = num(pagamentos.filter((p) => p.forma !== "dinheiro").reduce((s, p) => s + p.valor, 0));
      if (naoDinheiro > total + 0.001) return res.status(400).json({ error: "Pagamentos em Pix, cartão, fiado ou crédito passam do total" });
      if (pago + 0.001 < total) return res.status(400).json({ error: `Faltam ${(total - pago).toFixed(2).replace(".", ",")} para fechar o pagamento` });
      const devolvendoDinheiro = tipo === "devolucao" || (tipo === "troca" && diferenca < 0);
      if (devolvendoDinheiro && pagamentos.some((p) => p.forma === "fiado")) return res.status(400).json({ error: "Valor devolvido ao cliente não pode ser em fiado" });
      if (total === 0 && pagamentos.length) pagamentos.length = 0;
      const troco = num(pago - total);
      // o troco sai do dinheiro recebido: no caixa entra só o que ficou
      if (troco > 0) {
        const din = pagamentos.find((p) => p.forma === "dinheiro");
        din.recebido = din.valor; din.valor = num(din.valor - troco);
      }

      const c = b.cliente || {};
      const cliente = c.nome ? { id: str(c.id, 60) || null, nome: str(c.nome, 120), doc: str(c.doc, 20), telefone: str(c.telefone, 20), tipo: c.tipo === "lojista" ? "lojista" : "cliente" } : null;
      if (pagamentos.some((p) => p.forma === "fiado") && !cliente) return res.status(400).json({ error: "Venda no fiado precisa de cliente identificado" });

      // crédito na loja: na devolução/troca vira saldo do cliente; na venda, usa o saldo
      const usoCredito = num(pagamentos.filter((p) => p.forma === "credito_loja").reduce((s, p) => s + p.valor, 0));
      let creditoMov = 0;
      if (usoCredito) {
        const lista = (await getJSON(K.clientes)) || [];
        const cad = cliente?.id && lista.find((x) => x.id === cliente.id);
        if (!cad) return res.status(400).json({ error: "Crédito na loja precisa de cliente cadastrado. Cadastre o cliente primeiro." });
        creditoMov = devolvendoDinheiro ? usoCredito : -usoCredito;
        if (creditoMov < 0 && (cad.credito || 0) + 0.001 < usoCredito) return res.status(400).json({ error: `${cad.nome} tem só ${num(cad.credito || 0).toFixed(2).replace(".", ",")} de crédito` });
      }

      const seq = await redis("INCR", K.seq);
      const venda = {
        code: `${{ devolucao: "DV", troca: "TR", venda: "VB" }[tipo]}-${String(seq).padStart(6, "0")}`,
        tipo, status: "CONCLUIDA", criadaEm: new Date().toISOString(), lojaId, lojaNome: setup.lojas.find((l) => l.id === lojaId)?.nome || "",
        caixaId, vendedor: { id: vendedor.id, nome: vendedor.nome }, cliente, itens, total, pagamentos, troco, obs: str(b.obs, 300),
        ...(tipo === "troca" ? { devolvidos, diferenca, levado, voltou } : {}),
        ...(creditoMov ? { creditoMov } : {}),
      };
      if (creditoMov) venda.creditoSaldo = await moverCredito(cliente.id, creditoMov, devolvendoDinheiro ? `Crédito gerado na ${tipo}` : "Usado na compra", venda.code);
      await setJSON(K.venda(venda.code), venda);
      await redis("LPUSH", K.vendas, venda.code);
      const caixa = await getJSON(K.caixa(caixaId));
      caixa.vendas.push(venda.code);
      await setJSON(K.caixa(caixaId), caixa);
      return res.status(201).json({ venda });
    }
    // ---------- clientes do balcão ----------
    if (r === "clientes" && req.method === "GET") {
      return res.status(200).json({ clientes: (await getJSON(K.clientes)) || [] });
    }
    if (r === "clientes" && req.method === "POST" && acao === "credito") {
      const valor = num(b.valor);
      if (!valor || Math.abs(valor) > 1e6) return res.status(400).json({ error: "Informe o valor do ajuste" });
      const lista = (await getJSON(K.clientes)) || [];
      const cad = lista.find((x) => x.id === str(req.query.id, 60));
      if (!cad) return res.status(404).json({ error: "Cliente não encontrado" });
      if ((cad.credito || 0) + valor < -0.001) return res.status(400).json({ error: "O crédito não pode ficar negativo" });
      const saldo = await moverCredito(cad.id, valor, str(b.motivo, 120) || "Ajuste manual", null);
      return res.status(200).json({ credito: saldo });
    }
    if (r === "clientes" && req.method === "PUT") {
      const lista = (await getJSON(K.clientes)) || [];
      const cad = lista.find((x) => x.id === str(req.query.id, 60));
      if (!cad) return res.status(404).json({ error: "Cliente não encontrado" });
      const nome = str(b.nome, 120);
      if (nome.length < 2) return res.status(400).json({ error: "Informe o nome do cliente" });
      Object.assign(cad, { nome, doc: str(b.doc, 20), telefone: str(b.telefone, 20), tipo: b.tipo === "lojista" ? "lojista" : "cliente" });
      await setJSON(K.clientes, lista);
      return res.status(200).json({ cliente: cad });
    }

    // ---------- fornecedores e entradas de estoque ----------
    if (r === "fornecedores" && req.method === "GET") {
      const ids = await redis("LRANGE", K.compras, 0, 499);
      return res.status(200).json({ fornecedores: (await getJSON(K.fornecedores)) || [], compras: (await mget(ids.map(K.compra))).filter(Boolean) });
    }
    if (r === "fornecedores" && req.method === "PUT") {
      const fornecedores = (Array.isArray(b.fornecedores) ? b.fornecedores : []).slice(0, 500).map((x) => ({
        id: str(x.id, 60) || randomUUID(), nome: str(x.nome, 120), doc: str(x.doc, 20), telefone: str(x.telefone, 20),
        contato: str(x.contato, 80), cidade: str(x.cidade, 80), obs: str(x.obs, 300), criadoEm: str(x.criadoEm, 30) || new Date().toISOString(),
      })).filter((x) => x.nome);
      await setJSON(K.fornecedores, fornecedores);
      return res.status(200).json({ fornecedores });
    }
    if (r === "compra" && req.method === "POST") {
      const fornecedores = (await getJSON(K.fornecedores)) || [];
      const forn = fornecedores.find((x) => x.id === str(b.fornecedorId, 60));
      if (!forn) return res.status(400).json({ error: "Escolha o fornecedor" });
      const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 300).map((it) => {
        const qty = Math.max(1, Math.min(99999, parseInt(it.qty, 10) || 1));
        const custo = Math.max(0, Math.min(1e6, num(it.custo)));
        return { productId: str(it.productId, 120), name: str(it.name, 160), code: str(it.code, 20), qty, custo, sub: num(qty * custo) };
      }).filter((it) => it.name);
      if (!itens.length) return res.status(400).json({ error: "Adicione os produtos que chegaram" });
      const data = /^\d{4}-\d{2}-\d{2}$/.test(b.data || "") ? b.data : new Date().toISOString().slice(0, 10);
      const compra = {
        id: randomUUID(), criadaEm: new Date().toISOString(), data, nota: str(b.nota, 40), obs: str(b.obs, 300),
        lojaId: str(b.lojaId, 40), fornecedor: { id: forn.id, nome: forn.nome }, itens, total: num(itens.reduce((s, it) => s + it.sub, 0)),
      };
      await setJSON(K.compra(compra.id), compra);
      await redis("LPUSH", K.compras, compra.id);
      return res.status(201).json({ compra });
    }

    if (r === "clientes" && req.method === "POST") {
      const cli = {
        id: randomUUID(), nome: str(b.nome, 120), doc: str(b.doc, 20), telefone: str(b.telefone, 20),
        email: str(b.email, 120).toLowerCase(), tipo: b.tipo === "lojista" ? "lojista" : "cliente", criadoEm: new Date().toISOString(),
        credito: 0, extrato: [],
      };
      if (cli.nome.length < 2) return res.status(400).json({ error: "Informe o nome do cliente" });
      const lista = (await getJSON(K.clientes)) || [];
      const soDig = (s) => String(s || "").replace(/\D/g, "");
      const repetido = lista.find((x) => (cli.doc && soDig(x.doc) === soDig(cli.doc)) || (cli.telefone && soDig(x.telefone) === soDig(cli.telefone) && soDig(cli.telefone).length >= 10));
      if (repetido) return res.status(200).json({ cliente: repetido, existente: true });
      lista.unshift(cli);
      await setJSON(K.clientes, lista.slice(0, 5000));
      return res.status(201).json({ cliente: cli });
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
