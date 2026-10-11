// Funções compartilhadas pelas APIs (arquivos com "_" não viram rota na Vercel).
import { createHmac, timingSafeEqual } from "node:crypto";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// Segredo que assina as sessões do admin. Sem ele, nenhuma rota de admin funciona (falha fechada).
const SESSION_SECRET = process.env.SESSION_SECRET || "";

export const hasRedis = () => Boolean(REDIS_URL && REDIS_TOKEN);

export async function redis(...command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

// contador único de mudanças: o painel do admin só baixa tudo de novo quando ele muda
// fora de produção (preview e vercel dev) pedidos e avise-me usam chaves separadas
export const KP = process.env.VERCEL_ENV === "production" ? "ts:" : "ts:rev:";
export const VER_KEY = `${KP}orders_ver`;
export const bumpVersion = () => redis("INCR", VER_KEY);

export const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);

export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- sessão do admin: token assinado (HMAC-SHA256) com validade ----------
const b64url = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");

export function signAdminToken(hours = 12) {
  if (SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET ausente ou curto");
  const payload = b64url(JSON.stringify({ role: "ADMIN", exp: Date.now() + hours * 3600_000 }));
  return { token: `${payload}.${sign(payload)}`, exp: Date.now() + hours * 3600_000 };
}

export function isAdmin(req) {
  if (SESSION_SECRET.length < 32) return false;
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.role === "ADMIN" && Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

// ---------- limite de requisições por IP (janela fixa no Redis) ----------
export function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "anon").split(",")[0].trim().slice(0, 64);
}

// devolve true se ainda pode; false se passou do limite
export async function rateLimit(req, bucket, limit, windowSec) {
  const key = `ts:rl:${bucket}:${clientIp(req)}`;
  const count = await redis("INCR", key);
  if (count === 1) await redis("EXPIRE", key, windowSec);
  return count <= limit;
}
