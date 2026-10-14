// Teste do aviso de pedidos no WhatsApp do dono.
//
// POST /api/whatsapp-test   (Authorization: Bearer <sessão do admin>)
// Manda uma mensagem de exemplo, no mesmo formato de um pedido real, para WHATSAPP_TO.

import { isAdmin } from "./_shared.js";
import { notifyOwner, orderMessage, siteUrl, whatsappConfigured } from "./_whatsapp.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }
  if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });
  if (!whatsappConfigured()) return res.status(503).json({ error: "WHATSAPP_TO não configurado" });

  const exemplo = {
    code: "TS-TESTE",
    createdAt: new Date().toISOString(),
    customer: { type: "cliente", name: "Cliente de teste", phone: "(33) 99999-0000", email: "teste@exemplo.com" },
    items: [
      { name: "Tela iPhone 11", variant: "Preta", qty: 1, unit: 289.9, sub: 289.9 },
      { name: "Película 3D", qty: 2, unit: 15, sub: 30 },
    ],
    subtotal: 319.9,
    total: 319.9,
    checkout: null,
  };
  const r = await notifyOwner(`*[TESTE]*\n${orderMessage(exemplo, "new", siteUrl(req))}`);
  if (!r.sent) return res.status(502).json({ error: "Não foi possível enviar. Veja os logs da função na Vercel.", ...r });
  return res.status(200).json({ ok: true, ...r });
}
