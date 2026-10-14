// Aviso de pedido no WhatsApp do dono da loja (arquivo com "_" não vira rota na Vercel).
//
// O envio sai do servidor no momento em que o pedido chega, então funciona mesmo
// com o painel do admin fechado. Se o WhatsApp falhar, o pedido é salvo normalmente.
//
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   WHATSAPP_PROVIDER   "callmebot" (padrão, grátis) ou "zapi"
//   WHATSAPP_TO         número do dono com DDI e DDD, só dígitos. Ex.: 5533999999999
//                       (sem a variável, vai para o número padrão da loja: (19) 97828-3417)
//                       (aceita vários separados por vírgula)
//   SITE_URL            opcional, endereço do site para o link "Ver pedido". Ex.: https://topsmart.com.br
//
//   CallMeBot:  CALLMEBOT_APIKEY   chave que o CallMeBot manda no WhatsApp do dono na ativação
//               (com vários números: uma chave por número, na mesma ordem, separadas por vírgula)
//   Z-API:      ZAPI_INSTANCE, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN   (painel da Z-API)

const PAYMENT_LABEL = { credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix", dinheiro: "Dinheiro" };
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const digits = (v) => String(v || "").replace(/\D/g, "");
const list = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);

const fmtAddress = (a) =>
  a ? `${a.rua}, ${a.numero}${a.complemento ? ` - ${a.complemento}` : ""}, ${a.bairro}, ${a.cidade}/${a.uf}, CEP ${a.cep}` : "";

function fmtDate(iso) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
  return host ? `https://${host}` : "";
}

// Texto da mensagem. kind = "new" (pedido gerado) ou "confirmed" (cliente escolheu entrega e pagamento).
export function orderMessage(o, kind = "new", url = "") {
  const c = o.customer || {};
  const isLojista = c.type === "lojista";
  const lines = [];
  // a mensagem passa por um serviço de terceiro (CallMeBot/Z-API): CPF, CNPJ e e-mail ficam só no painel

  lines.push(kind === "new" ? `🛒 *NOVO PEDIDO ${o.code}*` : `✅ *PEDIDO ${o.code} CONFIRMADO PELO CLIENTE*`);
  lines.push(fmtDate(kind === "new" ? o.createdAt : o.confirmedAt || o.createdAt));
  lines.push("");

  lines.push(`*Cliente${isLojista ? " (lojista)" : ""}:* ${isLojista ? c.razao || c.name : c.name}`);
  if (isLojista && c.name && c.razao) lines.push(`Responsável: ${c.name}`);
  if (c.phone) lines.push(`Telefone: ${c.phone}${digits(c.phone).length >= 10 ? ` (wa.me/55${digits(c.phone).replace(/^55(?=\d{10,11}$)/, "")})` : ""}`);
  lines.push("");

  lines.push("*Itens:*");
  (o.items || []).forEach((it) => {
    lines.push(`• ${it.qty}x ${it.name}${it.variant ? ` (${it.variant})` : ""} | ${brl(it.unit)} = ${brl(it.sub)}`);
  });
  lines.push("");

  if (o.cupom) {
    lines.push(`Subtotal: ${brl(o.subtotal)}`);
    lines.push(`Cupom ${o.cupom.code}: -${brl(o.cupom.desconto)}`);
  }
  lines.push(`*Total: ${brl(o.total ?? o.subtotal)}*`);

  if (o.checkout) {
    const k = o.checkout;
    lines.push("");
    lines.push(`*Pagamento:* ${PAYMENT_LABEL[k.payment] || k.payment}`);
    lines.push(k.delivery === "entrega" ? `*Entrega:* ${fmtAddress(c.address)}` : "*Retirada na loja*");
    if (k.name && k.name !== c.name) lines.push(`Recebe/retira: ${k.name}`);
    if (k.phone && digits(k.phone) !== digits(c.phone)) lines.push(`Contato: ${k.phone}`);
    if (k.note) lines.push(`Obs.: ${k.note}`);
  } else if (c.address) {
    lines.push("");
    lines.push(`Endereço cadastrado: ${fmtAddress(c.address)}`);
    lines.push("_Aguardando o cliente escolher entrega e pagamento._");
  }

  if (url) {
    lines.push("");
    lines.push(`Ver pedido: ${url}/#/admin?aba=pedidos`);
  }
  return lines.join("\n");
}

// ---------- provedores ----------
async function sendCallMeBot(to, text, i) {
  const keys = list(process.env.CALLMEBOT_APIKEY);
  const apikey = keys[i] || keys[0];
  if (!apikey) throw new Error("CALLMEBOT_APIKEY ausente");
  const url = `https://api.callmebot.com/whatsapp.php?phone=${to}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const body = await r.text();
  // o CallMeBot responde 200 mesmo em alguns erros; confere o texto
  if (!r.ok || /error|invalid|not\s+valid/i.test(body)) throw new Error(`CallMeBot ${r.status}: ${body.replace(/<[^>]+>/g, " ").trim().slice(0, 200)}`);
}

async function sendZapi(to, text) {
  const { ZAPI_INSTANCE: inst, ZAPI_TOKEN: token, ZAPI_CLIENT_TOKEN: client } = process.env;
  if (!inst || !token) throw new Error("ZAPI_INSTANCE/ZAPI_TOKEN ausentes");
  const r = await fetch(`https://api.z-api.io/instances/${inst}/token/${token}/send-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(client ? { "Client-Token": client } : {}) },
    body: JSON.stringify({ phone: to, message: text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Z-API ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// número que recebe os pedidos quando WHATSAPP_TO não está configurado na Vercel
const WHATSAPP_PADRAO = "5519978283417";
const destinos = () => list(process.env.WHATSAPP_TO || WHATSAPP_PADRAO);

export const whatsappConfigured = () => destinos().length > 0;

// Envia o texto para todos os números de WHATSAPP_TO. Nunca lança erro: só registra no log.
export async function notifyOwner(text) {
  const numbers = destinos().map(digits).filter((n) => n.length >= 10);
  if (!numbers.length) return { sent: 0, skipped: true };
  const provider = (process.env.WHATSAPP_PROVIDER || "callmebot").toLowerCase();
  const results = await Promise.allSettled(numbers.map((to, i) => (provider === "zapi" ? sendZapi(to, text) : sendCallMeBot(to, text, i))));
  results.forEach((r) => r.status === "rejected" && console.error("[whatsapp]", r.reason?.message || r.reason));
  return { sent: results.filter((r) => r.status === "fulfilled").length, failed: results.filter((r) => r.status === "rejected").length };
}

export async function notifyOrderWhatsApp(order, kind, req) {
  try {
    return await notifyOwner(orderMessage(order, kind, siteUrl(req)));
  } catch (err) {
    console.error("[whatsapp]", err);
    return { sent: 0, failed: 1 };
  }
}
