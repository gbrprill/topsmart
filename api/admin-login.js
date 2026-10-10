// Login do admin, validado no servidor.
// A senha fica só nas variáveis de ambiente da Vercel (ADMIN_EMAIL / ADMIN_PASSWORD), nunca no site.
//
// POST /api/admin-login  { email, password }  ->  { token, exp, name }

import { hasRedis, rateLimit, safeEqual, signAdminToken, str } from "./_shared.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido" });
  }
  if (!hasRedis() || !ADMIN_EMAIL || ADMIN_PASSWORD.length < 12) {
    return res.status(503).json({ error: "Login do admin não configurado" });
  }

  try {
    // 5 tentativas a cada 15 minutos por IP: impede adivinhar a senha por força bruta
    if (!(await rateLimit(req, "admin-login", 5, 900))) {
      return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos." });
    }
    const b = req.body || {};
    const okEmail = safeEqual(str(b.email, 120).toLowerCase(), ADMIN_EMAIL);
    const okPass = safeEqual(typeof b.password === "string" ? b.password : "", ADMIN_PASSWORD);
    if (!okEmail || !okPass) return res.status(401).json({ error: "E-mail ou senha incorretos" });

    const { token, exp } = signAdminToken(12);
    return res.status(200).json({ token, exp, name: "Administrador Top Smart" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro ao entrar" });
  }
}
