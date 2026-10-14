// Ponto de venda (venda balcão), caixa diário, lojas e vendedores. Tudo restrito ao admin.
//
// GET    /api/pdv?r=setup                        lojas, vendedores e caixas abertos
// PUT    /api/pdv?r=setup                        salva lojas, vendedores e taxas da maquininha
// POST   /api/pdv?r=caixa&acao=abrir             { lojaId, fundo, por }
// POST   /api/pdv?r=caixa&acao=movimento&id=     { tipo: sangria|suprimento, valor, motivo, por }
// POST   /api/pdv?r=caixa&acao=fechar&id=        { contado, obs, por }
// GET    /api/pdv?r=caixas&lojaId=               últimos caixas (com resumo calculado no servidor)
// GET    /api/pdv?r=caixa&id=                    um caixa com as vendas dele
// POST   /api/pdv?r=venda                        registra venda, troca ou devolução no caixa aberto da loja
// GET    /api/pdv?r=clientes                     clientes cadastrados no balcão
// POST   /api/pdv?r=clientes                     cadastra cliente novo { nome, doc, telefone, tipo }
// PUT    /api/pdv?r=clientes&id=                 edita dados do cliente
// POST   /api/pdv?r=clientes&acao=credito&id=    ajuste manual de crédito na loja { valor (+/-), motivo }
// POST   /api/pdv?r=clientes&acao=receber&id=    recebe fiado no caixa aberto { valor, forma, lojaId, por }
// GET    /api/pdv?r=fornecedores                 fornecedores + últimas entradas de estoque
// PUT    /api/pdv?r=fornecedores                 salva a lista de fornecedores
// POST   /api/pdv?r=compra                       registra entrada de estoque { fornecedorId, nota, data, itens, atualizaCusto }
// POST   /api/pdv?r=venda&acao=cancelar&code=    cancela uma venda (não conta mais no caixa)
// GET    /api/pdv?r=vendas&from=ISO&to=ISO&lojaId=  vendas do período (relatórios)

import { randomUUID } from "node:crypto";
import { hasRedis, redis, str, num, isAdmin } from "./_shared.js";
import { avaliarCupom, consumirCupom, liberarCupom, chaveCliente } from "./_cupons.js";
import { K, FORMAS, FORMAS_RECEBER, getJSON, setJSON, mget, getSetup, resumo, getCatalogo, moverEstoque, movsDaVenda } from "./_pdv.js";

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

// soma (ou tira) o fiado que o cliente deve à loja; devolve o saldo devedor novo
async function moverFiado(clienteId, valor, motivo, ref) {
  const lista = (await getJSON(K.clientes)) || [];
  const cad = lista.find((x) => x.id === clienteId);
  if (!cad) return null;
  const antes = cad.fiado || 0;
  cad.fiado = Math.max(0, num(antes + valor));
  // desde quando a dívida está em aberto (para mostrar o fiado mais antigo)
  if (antes <= 0 && cad.fiado > 0) cad.fiadoDesde = new Date().toISOString();
  if (cad.fiado <= 0) cad.fiadoDesde = null;
  cad.fiadoExtrato = [{ em: new Date().toISOString(), valor: num(valor), motivo: str(motivo, 120), ref: ref || null }, ...(cad.fiadoExtrato || [])].slice(0, 60);
  await setJSON(K.clientes, lista);
  return cad.fiado;
}

const logCaixa = (caixa, acao, por, extra = {}) => (caixa.log ||= []).push({ em: new Date().toISOString(), acao, por: str(por, 60) || null, ...extra });

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
      const setup = await getSetup();
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
      const atual = await getSetup();
      const taxa = (v, d) => (v === undefined ? d : Math.max(0, Math.min(20, num(v))));
      const taxas = { credito: taxa(b.taxas?.credito, atual.taxas?.credito || 0), debito: taxa(b.taxas?.debito, atual.taxas?.debito || 0) };
      await setJSON(K.setup, { lojas, vendedores, taxas });
      return res.status(200).json({ lojas, vendedores, taxas });
    }

    // ---------- caixa ----------
    if (r === "caixa" && req.method === "POST" && acao === "abrir") {
      const setup = await getSetup();
      const loja = setup.lojas.find((l) => l.id === str(b.lojaId, 40));
      if (!loja) return res.status(400).json({ error: "Loja inválida" });
      if (await redis("GET", K.aberto(loja.id))) return res.status(409).json({ error: "Já existe um caixa aberto nesta loja. Feche-o antes de abrir outro." });
      const fundo = Math.max(0, Math.min(1e6, num(b.fundo)));
      const caixa = { id: randomUUID(), lojaId: loja.id, lojaNome: loja.nome, status: "ABERTO", abertoEm: new Date().toISOString(), abertoPor: str(b.por, 60) || null, fundo, movimentos: [], vendas: [], contado: null, fechadoEm: null, fechadoPor: null, obs: "", log: [] };
      logCaixa(caixa, "abriu", b.por, { valor: fundo });
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
        caixa.movimentos.push({ id: randomUUID(), tipo, valor, motivo: str(b.motivo, 120), em: new Date().toISOString(), por: str(b.por, 60) || null });
        logCaixa(caixa, tipo === "sangria" ? "retirada" : "reforco", b.por, { valor });
      } else {
        const contado = num(b.contado);
        if (!(contado >= 0 && contado <= 1e7)) return res.status(400).json({ error: "Informe o dinheiro contado na gaveta" });
        Object.assign(caixa, { status: "FECHADO", contado, fechadoEm: new Date().toISOString(), fechadoPor: str(b.por, 60) || null, obs: str(b.obs, 300) });
        logCaixa(caixa, "fechou", b.por, { valor: contado });
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
      if (venda.fiadoMov && venda.cliente?.id) await moverFiado(venda.cliente.id, -venda.fiadoMov, `Cancelamento ${venda.code}`, venda.code);
      if (venda.cupom) await liberarCupom(venda.cupom.code, venda.cupom.clienteKey);
      // o estoque volta exatamente ao que estava antes da venda
      const estoque = venda.estoqueMov?.length
        ? await moverEstoque(venda.estoqueMov.map((m) => ({ ...m, delta: -m.delta })), "cancelamento", venda.code, b.por)
        : {};
      await setJSON(K.venda(venda.code), venda);
      return res.status(200).json({ venda, estoque });
    }
    if (r === "venda" && req.method === "POST") {
      const setup = await getSetup();
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
      // cupom de desconto: só em venda; o servidor confere e calcula
      let cupom = null;
      if (tipo === "venda" && b.cupom) {
        const cli0 = b.cliente || {};
        const av = await avaliarCupom(b.cupom, { itens, subtotal: levado, canal: "balcao", tipoCliente: cli0.tipo, clienteKey: chaveCliente(cli0) });
        if (!av.ok) return res.status(400).json({ error: `Cupom: ${av.error}` });
        cupom = { code: av.cupom.code, desconto: av.desconto, descricao: av.descricao, cupomObj: av.cupom, clienteKey: chaveCliente(cli0) };
      }
      const total = tipo === "troca" ? Math.abs(diferenca) : num(levado - (cupom?.desconto || 0));

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
      // fiado vira conta a receber do cliente: precisa do cadastro para cobrar depois
      const noFiado = num(pagamentos.filter((p) => p.forma === "fiado").reduce((s, p) => s + p.valor, 0));
      if (noFiado && !cliente?.id) return res.status(400).json({ error: "Venda no fiado precisa de cliente cadastrado. Cadastre o cliente primeiro." });
      if (noFiado && !((await getJSON(K.clientes)) || []).some((x) => x.id === cliente.id)) return res.status(400).json({ error: "Cliente do fiado não encontrado. Cadastre o cliente primeiro." });

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

      if (cupom) {
        const uso = await consumirCupom(cupom.cupomObj, cupom.clienteKey);
        if (!uso.ok) {
          return res.status(400).json({ error: `Cupom: ${uso.error}` });
        }
        delete cupom.cupomObj;
      }
      const seq = await redis("INCR", K.seq);
      const venda = {
        code: `${{ devolucao: "DV", troca: "TR", venda: "VB" }[tipo]}-${String(seq).padStart(6, "0")}`,
        tipo, status: "CONCLUIDA", criadaEm: new Date().toISOString(), lojaId, lojaNome: setup.lojas.find((l) => l.id === lojaId)?.nome || "",
        caixaId, vendedor: { id: vendedor.id, nome: vendedor.nome }, cliente, itens, total, pagamentos, troco, obs: str(b.obs, 300),
        ...(tipo === "troca" ? { devolvidos, diferenca, levado, voltou } : {}),
        ...(creditoMov ? { creditoMov } : {}),
        ...(cupom ? { cupom, subtotal: levado } : {}),
      };
      if (creditoMov) venda.creditoSaldo = await moverCredito(cliente.id, creditoMov, devolvendoDinheiro ? `Crédito gerado na ${tipo}` : "Usado na compra", venda.code);
      if (noFiado) { venda.fiadoMov = noFiado; venda.fiadoSaldo = await moverFiado(cliente.id, noFiado, "Compra no fiado", venda.code); }
      // estoque no servidor: o que sai baixa; o que volta bom entra; com defeito não volta
      const estoque = await moverEstoque(movsDaVenda(venda), tipo, venda.code, b.por || vendedor.nome);
      venda.estoqueMov = movsDaVenda(venda).filter((m) => m.productId in estoque);
      await setJSON(K.venda(venda.code), venda);
      await redis("LPUSH", K.vendas, venda.code);
      const caixa = await getJSON(K.caixa(caixaId));
      caixa.vendas.push(venda.code);
      await setJSON(K.caixa(caixaId), caixa);
      return res.status(201).json({ venda, estoque });
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
    if (r === "clientes" && req.method === "POST" && acao === "receber") {
      const valor = num(b.valor), forma = FORMAS_RECEBER.includes(b.forma) ? b.forma : null;
      if (!forma) return res.status(400).json({ error: "Escolha como o cliente pagou" });
      const lista = (await getJSON(K.clientes)) || [];
      const cad = lista.find((x) => x.id === str(req.query.id, 60));
      if (!cad) return res.status(404).json({ error: "Cliente não encontrado" });
      if (!(valor > 0) || valor > (cad.fiado || 0) + 0.001) return res.status(400).json({ error: `Valor inválido. ${cad.nome} deve ${num(cad.fiado || 0).toFixed(2).replace(".", ",")}` });
      const caixaId = await redis("GET", K.aberto(str(b.lojaId, 40)));
      if (!caixaId) return res.status(409).json({ error: "Abra o caixa desta loja para receber o fiado" });
      const caixa = await getJSON(K.caixa(caixaId));
      caixa.movimentos.push({ id: randomUUID(), tipo: "recebimento", forma, valor, motivo: `Fiado de ${cad.nome}`, clienteId: cad.id, em: new Date().toISOString(), por: str(b.por, 60) || null });
      logCaixa(caixa, "recebimento", b.por, { valor, forma });
      await setJSON(K.caixa(caixaId), caixa);
      const fiado = await moverFiado(cad.id, -valor, `Pagou no ${forma === "dinheiro" ? "dinheiro" : forma === "pix" ? "Pix" : "cartão"}`, null);
      return res.status(200).json({ fiado });
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
      // estoque e custo no servidor (o catálogo é o mesmo para todos os aparelhos)
      const estoque = await moverEstoque(itens.map((it) => ({ ...it, delta: it.qty })), "entrada", compra.id, b.por || forn.nome);
      const custos = {};
      if (b.atualizaCusto) {
        const cat = await getCatalogo();
        itens.forEach((it) => { const p = cat.find((x) => x.id === it.productId); if (p && it.custo > 0) { p.cost = it.custo; custos[p.id] = it.custo; } });
        if (Object.keys(custos).length) await setJSON(K.catalogo, cat);
      }
      await setJSON(K.compra(compra.id), compra);
      await redis("LPUSH", K.compras, compra.id);
      return res.status(201).json({ compra, estoque, custos });
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
