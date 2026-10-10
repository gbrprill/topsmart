// Funções compartilhadas pelas APIs (arquivos com "_" não viram rota na Vercel).
import { timingSafeEqual } from "node:crypto";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const ADMIN_KEY = process.env.ADMIN_KEY || "";

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
export const VER_KEY = "ts:orders_ver";
export const bumpVersion = () => redis("INCR", VER_KEY);

export const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const num = (v) => (Number.isFinite(+v) ? Math.round(+v * 100) / 100 : 0);

export function isAdmin(req) {
  const given = Buffer.from(String(req.headers["x-admin-key"] || ""));
  const expected = Buffer.from(ADMIN_KEY);
  return ADMIN_KEY.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}
