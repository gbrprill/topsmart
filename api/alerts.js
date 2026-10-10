// "Avise-me": clientes pedem aviso quando um produto esgotado voltar ao estoque.
//
// POST   /api/alerts               cliente registra o pedido de aviso (e-mail e/ou WhatsApp)
// GET    /api/alerts               admin lista os pedidos de aviso (Authorization: Bearer <sessão do admin>)
// PUT    /api/alerts?id=...        admin marca como avisado ou pendente (Authorization: Bearer <sessão do admin>)
// DELETE /api/alerts?id=...        admin remove o pedido de aviso (Authorization: Bearer <sessão do admin>)

import { randomUUID } from "node:crypto";
import { hasRedis, redis, bumpVersion, str, isAdmin, rateLimit } from "./_shared.js";

const LIST = "ts:alerts";
const key = (id) => `ts:alert:${id}`;
const CHANNELS = ["email", "whatsapp"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasRedis()) return res.status(503).json({ error: "Armazenamento não configurado" });

  try {
    if (req.method === "POST") {
      if (!(await rateLimit(req, "alert", 20, 3600))) return res.status(429).json({ error: "Muitos avisos seguidos. Tente de novo mais tarde." });
      const b = req.body || {};
      const product = b.product || {};
      const alert = {
        product: { id: str(product.id, 120), name: str(product.name, 160), code: str(product.code, 20) },
        name: str(b.name, 120),
        email: str(b.email, 120).toLowerCase(),
        phone: str(b.phone, 20),
        channels: Array.isArray(b.channels) ? [...new Set(b.channels.filter((c) => CHANNELS.includes(c)))] : [],
        customerType: b.customerType === "lojista" ? "lojista" : "cliente",
      };
      if (!alert.product.id || !alert.product.name) return res.status(400).json({ error: "Produto inválido" });
      if (!alert.channels.length) return res.status(400).json({ error: "Escolha e-mail e/ou WhatsApp" });
      if (alert.channels.includes("email") && !/^\S+@\S+\.\S+$/.test(alert.email)) return res.status(400).json({ error: "E-mail inválido" });
      if (alert.channels.includes("whatsapp") && alert.phone.replace(/\D/g, "").length < 10) return res.status(400).json({ error: "WhatsApp inválido" });

      // não duplica: mesmo produto + mesmo contato ainda pendente só atualiza os canais
      const dedupe = `ts:alert_idx:${alert.product.id}:${alert.email || alert.phone.replace(/\D/g, "")}`;
      const existingId = await redis("GET", dedupe);
      if (existingId) {
        const raw = await redis("GET", key(existingId));
        if (raw) {
          const prev = JSON.parse(raw);
          if (prev.status === "PENDING") {
            Object.assign(prev, { channels: alert.channels, email: alert.email, phone: alert.phone, name: alert.name || prev.name, updatedAt: new Date().toISOString() });
            await redis("SET", key(prev.id), JSON.stringify(prev));
            await bumpVersion();
            return res.status(200).json({ alert: prev, duplicate: true });
          }
        }
      }

      Object.assign(alert, { id: randomUUID(), status: "PENDING", createdAt: new Date().toISOString() });
      await redis("SET", key(alert.id), JSON.stringify(alert));
      await redis("SET", dedupe, alert.id);
      await redis("LPUSH", LIST, alert.id);
      await bumpVersion();
      return res.status(201).json({ alert });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });

    if (req.method === "GET") {
      const ids = await redis("LRANGE", LIST, 0, 499);
      const raws = ids.length ? await redis("MGET", ...ids.map(key)) : [];
      return res.status(200).json({ alerts: raws.filter(Boolean).map((r) => JSON.parse(r)) });
    }

    const id = str(req.query.id, 60);
    const raw = id && (await redis("GET", key(id)));
    if (!raw) return res.status(404).json({ error: "Aviso não encontrado" });
    const alert = JSON.parse(raw);

    if (req.method === "PUT") {
      const status = (req.body || {}).status;
      if (!["PENDING", "NOTIFIED"].includes(status)) return res.status(400).json({ error: "Status inválido" });
      alert.status = status;
      alert.notifiedAt = status === "NOTIFIED" ? new Date().toISOString() : null;
      await redis("SET", key(id), JSON.stringify(alert));
      const ver = await bumpVersion();
      return res.status(200).json({ alert, ver });
    }

    if (req.method === "DELETE") {
      await redis("DEL", key(id));
      await redis("LREM", LIST, 0, id);
      const ver = await bumpVersion();
      return res.status(200).json({ ok: true, ver });
    }

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao acessar os avisos" });
  }
}
