// Cupons de desconto.
//
// POST /api/coupons { code, itens, canal, tipo }                                confere um cupom (público, com limite)
// GET /api/coupons                                                              lista com usos (admin)
// PUT /api/coupons  { cupons: [...] }                                           salva a lista (admin)

import { hasRedis, isAdmin, rateLimit, num } from "./_shared.js";
import { getCupons, limparCupom, avaliarCupom, usosDosCupons, CK } from "./_cupons.js";
import { redis } from "./_shared.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!hasRedis()) return res.status(503).json({ error: "Armazenamento não configurado" });
  try {
    if (req.method === "POST") {
      const b = req.body || {};
      const itens = (Array.isArray(b.itens) ? b.itens : []).slice(0, 200).map((it) => ({ productId: String(it.productId || "").slice(0, 120), qty: Math.max(1, parseInt(it.qty, 10) || 1), sub: Math.max(0, num(it.sub)) }));
      // 30 consultas a cada 10 minutos por IP: impede testar códigos no chute
      if (!(await rateLimit(req, "cupom", 30, 600))) return res.status(429).json({ ok: false, error: "Muitas tentativas. Aguarde alguns minutos." });
      const r = await avaliarCupom(b.code, {
        itens, subtotal: itens.reduce((s, it) => s + it.sub, 0),
        canal: b.canal === "balcao" ? "balcao" : "site",
        tipoCliente: b.tipo === "lojista" ? "lojista" : "cliente",
        // "um uso por cliente" é conferido só ao fechar o pedido, para a consulta pública não revelar quem usou
      });
      return res.status(200).json(r.ok ? { ok: true, code: r.cupom.code, desconto: r.desconto, descricao: r.descricao, itensNaPromo: r.itensNaPromo } : { ok: false, error: r.error });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });

    if (req.method === "GET") {
      const cupons = await getCupons();
      return res.status(200).json({ cupons, usos: await usosDosCupons(cupons) });
    }
    if (req.method === "PUT") {
      const lista = (Array.isArray(req.body?.cupons) ? req.body.cupons : []).slice(0, 300).map(limparCupom).filter((c) => c.code && c.valor > 0);
      const codes = new Set();
      for (const c of lista) {
        if (codes.has(c.code)) return res.status(400).json({ error: `Código repetido: ${c.code}` });
        codes.add(c.code);
      }
      // cupom apagado: zera o contador para o código poder ser recriado do zero
      const antigos = await getCupons();
      for (const a of antigos) if (!codes.has(a.code)) { await redis("DEL", CK.uso(a.code)); await redis("DEL", CK.cli(a.code)); }
      await redis("SET", CK.lista, JSON.stringify(lista));
      return res.status(200).json({ cupons: lista, usos: await usosDosCupons(lista) });
    }
    res.setHeader("Allow", "GET, POST, PUT");
    return res.status(405).json({ error: "Método não permitido" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro nos cupons" });
  }
}
