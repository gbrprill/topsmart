// Catálogo de produtos e estoque no servidor: o mesmo para o site, o balcão e qualquer aparelho do admin.
//
// GET    /api/catalogo                    produtos com estoque, sem custo (público)
// GET    /api/catalogo?img=ID&v=          foto do produto (público, guardada em cache pelo navegador)
// GET    /api/catalogo?admin=1            produtos com custo e estoque mínimo (admin)
// PUT    /api/catalogo?id=                cria ou edita um produto { ...produto, image?: dataURL, por } (admin)
// DELETE /api/catalogo?id=                exclui o produto (admin)
// POST   /api/catalogo?acao=importar      envia produtos do navegador para o servidor, em lotes { produtos, por } (admin)

import { hasRedis, redis, str, num, isAdmin } from "./_shared.js";
import { K, getJSON, setJSON, getCatalogo, getEstoque, moverEstoque } from "./_pdv.js";

const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMG = 900_000; // ~650 KB de imagem; o painel já reduz para 700px

// só os campos conhecidos, com limites; estoque fica fora (vai para o hash de estoque)
function limpar(p, atual = {}) {
  const preco = (v, d) => (v === undefined ? d : Math.max(0, Math.min(1e6, num(v))));
  const out = {
    id: atual.id || str(p.id, 120),
    slug: atual.slug || str(p.slug, 140) || str(p.id, 120),
    name: str(p.name, 160) || atual.name || "",
    code: (str(p.code, 20) || atual.code || "").toUpperCase(),
    sku: str(p.sku, 40) || atual.sku || "",
    cat: str(p.cat, 40) || atual.cat || "pecas",
    brand: p.brand === undefined ? atual.brand || "" : str(p.brand, 40),
    models: Array.isArray(p.models) ? p.models.map((m) => str(m, 60)).filter(Boolean).slice(0, 40) : atual.models || [],
    price: preco(p.price, atual.price || 0),
    priceLoj: preco(p.priceLoj, atual.priceLoj ?? 0),
    promo: p.promo === undefined ? atual.promo ?? null : p.promo ? preco(p.promo, null) : null,
    cost: preco(p.cost, atual.cost || 0),
    min: p.min === undefined ? atual.min || 0 : Math.max(0, Math.min(9999, parseInt(p.min, 10) || 0)),
    featured: p.featured === undefined ? !!atual.featured : !!p.featured,
    isNew: p.isNew === undefined ? !!atual.isNew : !!p.isNew,
    variants: Array.isArray(p.variants) ? p.variants.slice(0, 20).map((v) => [str(v[0], 60), num(v[1])]) : p.variants === null ? null : atual.variants ?? null,
    image: atual.image ?? null,
    createdAt: atual.createdAt || (Number.isFinite(+p.createdAt) && +p.createdAt > 0 ? +p.createdAt : Date.now()),
  };
  // caminho de imagem do próprio site (assets/...) pode ser guardado direto
  if (typeof p.image === "string" && /^assets\/[\w./-]+$/.test(p.image)) out.image = p.image;
  return out;
}

// guarda a foto enviada como data URL e devolve o endereço público dela
async function salvarImagem(id, dataUrl) {
  if (typeof dataUrl !== "string" || !DATA_URL.test(dataUrl)) return null;
  if (dataUrl.length > MAX_IMG) throw Object.assign(new Error("Foto grande demais. Use uma imagem menor."), { status: 413 });
  await redis("SET", K.img(id), dataUrl);
  return `/api/catalogo?img=${encodeURIComponent(id)}&v=${Date.now().toString(36)}`;
}

const publico = ({ cost, min, ...p }, stock) => ({ ...p, stock });

export default async function handler(req, res) {
  if (!hasRedis()) return res.status(503).json({ error: "Armazenamento não configurado" });
  const q = req.query, b = req.body || {};
  try {
    // ---------- foto ----------
    if (req.method === "GET" && q.img) {
      const raw = await redis("GET", K.img(str(q.img, 120)));
      const m = raw && DATA_URL.exec(raw);
      if (!m) { res.setHeader("Cache-Control", "no-store"); return res.status(404).end(); }
      // o endereço muda (v=) quando a foto muda, então pode ficar em cache por muito tempo
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Type", m[1]);
      return res.status(200).end(Buffer.from(m[2], "base64"));
    }
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const [cat, est] = await Promise.all([getCatalogo(), getEstoque()]);
      if (q.admin) {
        if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });
        return res.status(200).json({ produtos: cat.map((p) => ({ ...p, stock: est[p.id] ?? 0 })) });
      }
      return res.status(200).json({ produtos: cat.map((p) => publico(p, est[p.id] ?? 0)) });
    }

    if (!isAdmin(req)) return res.status(401).json({ error: "Acesso restrito ao admin" });

    if (req.method === "PUT") {
      const id = str(q.id, 120);
      if (!id) return res.status(400).json({ error: "Produto sem identificação" });
      const cat = await getCatalogo();
      const atual = cat.find((p) => p.id === id);
      const prod = limpar({ ...b, id }, atual);
      if (!prod.name) return res.status(400).json({ error: "Informe o nome do produto" });
      if (!prod.code) return res.status(400).json({ error: "Informe o código do produto" });
      if (cat.some((p) => p.id !== id && p.code === prod.code)) return res.status(409).json({ error: "Código já usado em outro produto" });
      if (!atual && cat.some((p) => p.slug === prod.slug)) prod.slug = `${prod.slug}-${Date.now().toString(36).slice(-4)}`;
      const url = await salvarImagem(id, b.image);
      if (url) prod.image = url;
      if (!prod.image) return res.status(400).json({ error: "Adicione uma foto do produto" });
      if (prod.promo != null && prod.promo >= prod.price) prod.promo = null;
      const lista = atual ? cat.map((p) => (p.id === id ? prod : p)) : [prod, ...cat];
      await setJSON(K.catalogo, lista);
      // estoque digitado no cadastro: vira movimentação (cadastro ou ajuste), para o histórico bater
      let stock = (await getEstoque())[id] ?? 0;
      if (b.stock !== undefined) {
        const novo = parseInt(b.stock, 10);
        if (Number.isInteger(novo) && novo >= 0 && novo !== stock) {
          const r = await moverEstoque([{ productId: id, name: prod.name, code: prod.code, delta: novo - stock }], atual ? "ajuste" : "cadastro", null, b.por);
          stock = r[id] ?? stock;
        }
      }
      return res.status(atual ? 200 : 201).json({ produto: { ...prod, stock } });
    }

    if (req.method === "DELETE") {
      const id = str(q.id, 120);
      const cat = await getCatalogo();
      if (!cat.some((p) => p.id === id)) return res.status(404).json({ error: "Produto não encontrado" });
      await setJSON(K.catalogo, cat.filter((p) => p.id !== id));
      await redis("DEL", K.img(id));
      await redis("HDEL", K.estoque, id);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && q.acao === "importar") {
      const novos = (Array.isArray(b.produtos) ? b.produtos : []).slice(0, 25);
      if (!novos.length) return res.status(400).json({ error: "Nenhum produto enviado" });
      const cat = await getCatalogo();
      const est = await getEstoque();
      const movs = [];
      for (const p of novos) {
        const id = str(p.id, 120);
        if (!id || !str(p.name, 160)) continue;
        const atual = cat.find((x) => x.id === id);
        // produto antigo sem data de cadastro: conta como antigo (entra na conta de produtos parados)
        const prod = limpar({ ...p, createdAt: p.createdAt || 1 }, atual);
        const url = await salvarImagem(id, p.image);
        if (url) prod.image = url;
        if (atual) cat[cat.indexOf(atual)] = prod; else cat.push(prod);
        // estoque só entra na primeira vez; depois manda o que está no servidor
        const stock = Math.max(0, parseInt(p.stock, 10) || 0);
        if (!(id in est) && stock) movs.push({ productId: id, name: prod.name, code: prod.code, delta: stock });
        if (!(id in est)) est[id] = 0;
      }
      await setJSON(K.catalogo, cat);
      if (movs.length) await moverEstoque(movs, "cadastro", "importação", b.por);
      return res.status(200).json({ total: cat.length });
    }

    return res.status(400).json({ error: "Requisição inválida" });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: "Erro no catálogo" });
  }
}
