// Regras dos cupons de desconto, usadas pelo site (pedidos), pelo balcão e pela tela de cupons.
// Arquivo com "_" não vira rota na Vercel.
import { redis, str, num } from "./_shared.js";

// a versão de revisão (preview) usa chaves separadas
const P = process.env.VERCEL_ENV === "production" ? "ts:" : "ts:rev:";
export const CK = {
  lista: `${P}cupons`,
  uso: (code) => `${P}cupom_uso:${code}`,
  cli: (code) => `${P}cupom_cli:${code}`,
};

export const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
const soDigitos = (s) => String(s || "").replace(/\D/g, "");

export async function getCupons() {
  const raw = await redis("GET", CK.lista);
  return raw ? JSON.parse(raw) : [];
}

// limpa e valida o que vem do painel
export function limparCupom(c) {
  const tipo = c.tipo === "valor" ? "valor" : "pct";
  const valor = num(c.valor);
  const data = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || "") ? d : "");
  return {
    code: normCode(c.code),
    descricao: str(c.descricao, 80),
    tipo,
    valor: tipo === "pct" ? Math.min(100, Math.max(0, valor)) : Math.max(0, Math.min(1e6, valor)),
    maxDesconto: Math.max(0, Math.min(1e6, num(c.maxDesconto))) || 0,
    minimo: Math.max(0, Math.min(1e6, num(c.minimo))) || 0,
    inicio: data(c.inicio),
    fim: data(c.fim),
    limite: Math.max(0, Math.min(1e6, parseInt(c.limite, 10) || 0)),
    porCliente: !!c.porCliente,
    canal: ["site", "balcao"].includes(c.canal) ? c.canal : "ambos",
    publico: ["cliente", "lojista"].includes(c.publico) ? c.publico : "todos",
    ativo: c.ativo !== false,
    criadoEm: str(c.criadoEm, 30) || new Date().toISOString(),
    // produtos na promoção e o desconto máximo por unidade de cada um (lucro na hora de criar o cupom),
    // separado para preço de cliente e de lojista. Produto fora da lista não ganha desconto.
    produtos: limparProdutos(c.produtos),
  };
}

function limparProdutos(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const [id, lim] of Object.entries(p).slice(0, 3000)) {
    const k = str(id, 120);
    if (!k || !lim) continue;
    out[k] = { cli: Math.max(0, Math.min(1e6, num(lim.cli))), loj: Math.max(0, Math.min(1e6, num(lim.loj))) };
  }
  return out;
}

// data de hoje no horário de Brasília (as datas do cupom são do calendário da loja)
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

export function descreverCupom(c) {
  const v = c.tipo === "pct" ? `${String(c.valor).replace(".", ",")}% de desconto` : `R$ ${c.valor.toFixed(2).replace(".", ",")} de desconto`;
  return c.descricao || v;
}

// confere se o cupom vale para este pedido e calcula o desconto (não consome o uso).
// itens: [{ productId, qty, sub }]. O desconto de cada item nunca passa do lucro guardado no cupom.
export async function avaliarCupom(codeRaw, { itens = [], subtotal, canal, tipoCliente, clienteKey }) {
  const code = normCode(codeRaw);
  if (!code) return { ok: false, error: "Digite o código do cupom" };
  const c = (await getCupons()).find((x) => x.code === code);
  if (!c || !c.ativo) return { ok: false, error: "Cupom inválido ou encerrado" };
  if (c.canal !== "ambos" && c.canal !== canal) return { ok: false, error: c.canal === "site" ? "Este cupom vale só para pedidos pelo site" : "Este cupom vale só na loja física" };
  if (c.publico !== "todos" && c.publico !== (tipoCliente === "lojista" ? "lojista" : "cliente")) return { ok: false, error: c.publico === "lojista" ? "Cupom exclusivo para lojistas" : "Cupom exclusivo para clientes (CPF)" };
  const hoje = hojeBR();
  if (c.inicio && hoje < c.inicio) return { ok: false, error: `Cupom válido a partir de ${c.inicio.split("-").reverse().join("/")}` };
  if (c.fim && hoje > c.fim) return { ok: false, error: "Cupom vencido" };
  if (c.minimo && subtotal + 0.001 < c.minimo) return { ok: false, error: `Pedido mínimo de R$ ${c.minimo.toFixed(2).replace(".", ",")} para este cupom` };
  if (c.limite) {
    const usados = Number(await redis("GET", CK.uso(code))) || 0;
    if (usados >= c.limite) return { ok: false, error: "Este cupom já atingiu o limite de usos" };
  }
  if (c.porCliente && (await jaUsou(code, clienteKey))) return { ok: false, error: "Você já usou este cupom" };
  const lado = tipoCliente === "lojista" ? "loj" : "cli";
  const elegiveis = (itens || []).filter((it) => c.produtos?.[it.productId] && c.produtos[it.productId][lado] > 0);
  if (!elegiveis.length) return { ok: false, error: "Nenhum produto do carrinho está nesta promoção" };
  const teto = (it) => c.produtos[it.productId][lado] * (Number(it.qty) || 1);
  let desconto;
  if (c.tipo === "pct") {
    desconto = elegiveis.reduce((s, it) => s + Math.min((num(it.sub) * c.valor) / 100, teto(it)), 0);
  } else {
    const subElegivel = elegiveis.reduce((s, it) => s + num(it.sub), 0);
    desconto = Math.min(c.valor, subElegivel, elegiveis.reduce((s, it) => s + teto(it), 0));
  }
  if (c.tipo === "pct" && c.maxDesconto) desconto = Math.min(desconto, c.maxDesconto);
  desconto = num(Math.min(desconto, subtotal));
  if (desconto <= 0) return { ok: false, error: "Este cupom não dá desconto neste pedido" };
  return { ok: true, cupom: c, desconto, descricao: descreverCupom(c), itensNaPromo: elegiveis.length };
}

// chaves para "um uso por cliente": documento, telefone e e-mail. Repetir qualquer um deles já conta como o
// mesmo cliente, então trocar só o CPF (ou só o telefone) não libera um segundo uso.
export const chaveCliente = (cli) => {
  const doc = soDigitos(cli?.doc), tel = soDigitos(cli?.telefone || cli?.phone).slice(-11), mail = String(cli?.email || "").trim().toLowerCase();
  return [doc.length >= 11 && `doc:${doc}`, tel.length >= 10 && `tel:${tel}`, mail.includes("@") && `mail:${mail}`].filter(Boolean);
};
const listaChaves = (k) => (Array.isArray(k) ? k : k ? [k] : []);
async function jaUsou(code, clienteKey) {
  const ks = listaChaves(clienteKey);
  if (!ks.length) return false;
  // também confere o formato antigo (só números ou e-mail, sem prefixo)
  const todas = [...new Set([...ks, ...ks.map((k) => k.replace(/^(doc|tel|mail):/, ""))])];
  const r = await redis("SMISMEMBER", CK.cli(code), ...todas);
  return (r || []).some((x) => Number(x) === 1);
}

// reserva o uso do cupom (atômico no Redis); devolve erro se acabou ou se o cliente já usou
export async function consumirCupom(c, clienteKey) {
  const ks = listaChaves(clienteKey);
  if (c.porCliente) {
    if (!ks.length) return { ok: false, error: "Este cupom precisa de cliente identificado (CPF/CNPJ ou telefone)" };
    if (await jaUsou(c.code, ks)) return { ok: false, error: "Este cliente já usou este cupom" };
    // reserva cada chave; se alguma já existia, desfaz só as que esta chamada criou
    const novos = [];
    for (const k of ks) if (Number(await redis("SADD", CK.cli(c.code), k)) === 1) novos.push(k);
    if (novos.length < ks.length) {
      if (novos.length) await redis("SREM", CK.cli(c.code), ...novos);
      return { ok: false, error: "Este cliente já usou este cupom" };
    }
  }
  const n = await redis("INCR", CK.uso(c.code));
  if (c.limite && n > c.limite) {
    await redis("DECR", CK.uso(c.code));
    if (c.porCliente) await redis("SREM", CK.cli(c.code), ...ks);
    return { ok: false, error: "Este cupom acabou de atingir o limite de usos" };
  }
  return { ok: true };
}

// devolve o uso quando o pedido/venda é cancelado
export async function liberarCupom(code, clienteKey) {
  const n = await redis("DECR", CK.uso(code));
  if (n < 0) await redis("SET", CK.uso(code), 0);
  const ks = listaChaves(clienteKey);
  if (ks.length) await redis("SREM", CK.cli(code), ...ks);
}

export async function usosDosCupons(cupons) {
  if (!cupons.length) return {};
  const vals = await redis("MGET", ...cupons.map((c) => CK.uso(c.code)));
  return Object.fromEntries(cupons.map((c, i) => [c.code, Number(vals[i]) || 0]));
}
