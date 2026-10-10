// API de pedidos da Top Smart (Vercel Function).
// Guarda os pedidos no Redis (Upstash) para que o admin veja, em qualquer aparelho,
// os pedidos feitos pelos clientes, e seja notificado.
//
// POST   /api/orders                      cliente gera o pedido (recebe código e token)
// PATCH  /api/orders?code=TS-000001       cliente confirma dados (entrega, pagamento...) com o token
// GET    /api/orders?mine=CODE:TOKEN,...  cliente consulta o status dos próprios pedidos
// GET    /api/orders?since=N              admin lista pedidos (header x-admin-key)
// PUT    /api/orders?code=TS-000001       admin muda o status (header x-admin-key)

import { randomUUID, timingSafeEqual } from "node:crypto";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

const K = {
  seq: "ts:order_seq",
  ver: "ts:orders_ver",
  list: "ts:orders",
  order: (code) => `ts:order:${code}`,
};
const STATUSES = ["NEW", "IN_PROGRESS", "DONE", "CANCELED"];
const DELIVERY = ["retirada", "entrega"];
const PAYMENT = ["credito", "debito", "pix", "dinheiro"];

async function redis(...command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);
const publicOrder = ({ token, ...o }) => o;

function isAdmin(req) {
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  const expected = Buffer.from(ADMIN_KEY);
  return ADMIN_KEY.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

function cleanAddress(a) {
  if (!a || typeof a !== "object") return null;
  const out = {
    cep: str(a.cep, 9), rua: str(a.rua), numero: str(a.numero, 20), complemento: str(a.complemento, 80),
    bairro: str(a.bairro, 80), cidade: str(a.cidade, 80), uf: str(a.uf, 2),
  };
  return out.rua && out.numero ? out : null;
}

async function getOrder(code) {
  const raw = await redis("GET", K.order(code));
  return raw ? JSON.parse(raw) : null;
}
async function saveOrder(order) {
  await redis("SET", K.order(order.code), JSON.stringify(order));
  return redis("INCR", K.ver);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: "Armazenamento de pedidos não configurado" });

  try {
    const code = str(req.query.code, 20).toUpperCase();

    // ---- cliente gera o pedido ----
    if (req.method === "POST") {
      const b = req.body || {};
      const items = Array.isArray(b.items) ? b.items.slice(0, 100).map((it) => ({
        name: str(it.name, 160), variant: str(it.variant, 60) || null,
        qty: Math.max(1, Math.min(999, parseInt(it.qty, 10) || 1)), unit: num(it.unit),
      })).filter((it) => it.name) : [];
      if (!items.length) return res.status(400).json({ error: "Carrinho vazio" });
      items.forEach((it) => (it.sub = num(it.unit * it.qty)));
      const c = b.customer || {};
      const customer = {
        type: c.type === "lojista" ? "lojista" : "cliente",
        name: str(c.name, 120), razao: str(c.razao, 160), doc: str(c.doc, 20),
        phone: str(c.phone, 20), email: str(c.email, 120), address: cleanAddress(c.address),
      };
      if (!customer.name && !customer.razao) return res.status(400).json({ error: "Cliente sem nome" });

      const seq = await redis("INCR", K.seq);
      const order = {
        code: `TS-${String(seq).padStart(6, "0")}`,
        seq,
        createdAt: new Date().toISOString(),
        status: "NEW",
        stage: "PENDING", // gerado, aguardando o cliente confirmar entrega e pagamento
        customer,
        items,
        subtotal: num(items.reduce((s, it) => s + it.sub, 0)),
        checkout: null,
        token: randomUUID(),
      };
      await redis("LPUSH", K.list, order.code);
      const ver = await saveOrder(order);
      return res.status(201).json({ order: publicOrder(order), token: order.token, ver });
    }

    // ---- cliente confirma entrega, pagamento e observação ----
    if (req.method === "PATCH") {
      const order = code && (await getOrder(code));
      if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
      const b = req.body || {};
      if (str(b.token, 60) !== order.token) return res.status(403).json({ error: "Sem permissão" });
      const delivery = DELIVERY.includes(b.delivery) ? b.delivery : null;
      const payment = PAYMENT.includes(b.payment) ? b.payment : null;
      if (!delivery || !payment) return res.status(400).json({ error: "Escolha entrega e forma de pagamento" });
      if (delivery === "entrega" && !order.customer.address) return res.status(400).json({ error: "Sem endereço cadastrado para entrega" });
      order.checkout = { name: str(b.name, 160), phone: str(b.phone, 20), note: str(b.note, 300), delivery, payment };
      order.stage = "CONFIRMED";
      order.confirmedAt = new Date().toISOString();
      await saveOrder(order);
      return res.status(200).json({ order: publicOrder(order) });
    }

    // ---- admin muda status ----
    if (req.method === "PUT") {
      if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });
      const order = code && (await getOrder(code));
      if (!order) return res.status(404).json({ error: "Pedido não encontrado" });
      const status = (req.body || {}).status;
      if (!STATUSES.includes(status)) return res.status(400).json({ error: "Status inválido" });
      order.status = status;
      const ver = await saveOrder(order);
      return res.status(200).json({ order: publicOrder(order), ver });
    }

    if (req.method === "GET") {
      // cliente: status dos próprios pedidos, provando posse com o token
      if (req.query.mine) {
        const pairs = String(req.query.mine).split(",").slice(0, 30).map((p) => p.split(":"));
        const raws = pairs.length ? await redis("MGET", ...pairs.map(([c]) => K.order(str(c, 20).toUpperCase()))) : [];
        const orders = raws.map((raw, i) => {
          const o = raw && JSON.parse(raw);
          return o && o.token === pairs[i][1] ? publicOrder(o) : null;
        }).filter(Boolean);
        return res.status(200).json({ orders });
      }

      // admin: lista. Com ?since=N só busca tudo se algo mudou (economiza comandos no polling).
      if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });
      const ver = Number(await redis("GET", K.ver)) || 0;
      if (req.query.since !== undefined && Number(req.query.since) === ver) return res.status(200).json({ ver, changed: false });
      const codes = await redis("LRANGE", K.list, 0, 199);
      const raws = codes.length ? await redis("MGET", ...codes.map(K.order)) : [];
      const orders = raws.filter(Boolean).map((raw) => publicOrder(JSON.parse(raw)));
      return res.status(200).json({ ver, changed: true, orders });
    }

    res.setHeader("Allow", "GET, POST, PATCH, PUT");
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao acessar os pedidos" });
  }
}
