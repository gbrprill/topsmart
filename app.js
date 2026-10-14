// Esboço navegável do site Top Smart.
// Tudo roda no navegador: produtos cadastrados, carrinho, contas e pedidos ficam no localStorage.
// Na versão final isso vira Next.js + Prisma + Auth.js, conforme o briefing.
(() => {
  const { categories, brands, whatsapp } = window.STORE;
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");

  // ---------- utilidades ----------
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = (v) => brl.format(v).replace(/ /g, " ");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (id, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const digits = (v) => String(v || "").replace(/\D/g, "");
  const slugify = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  const masks = {
    phone(v) {
      const d = digits(v).slice(0, 11);
      if (d.length <= 2) return d;
      if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
      if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    },
    cpf(v) {
      const d = digits(v).slice(0, 11);
      return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    },
    cep: (v) => digits(v).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2"),
    code: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20),
    cnpj(v) {
      const d = digits(v).slice(0, 14);
      return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
    },
  };
  function validCPF(v) {
    const d = digits(v);
    if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
    for (const len of [9, 10]) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += +d[i] * (len + 1 - i);
      if (((sum * 10) % 11) % 10 !== +d[len]) return false;
    }
    return true;
  }
  function validCNPJ(v) {
    const d = digits(v);
    if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
    for (const len of [12, 13]) {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((s, wi, i) => s + wi * +d[i], 0);
      const r = sum % 11 < 2 ? 0 : 11 - (sum % 11);
      if (r !== +d[len]) return false;
    }
    return true;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 2400);
  }

  // ---------- produtos (seed + cadastrados no admin) ----------
  const SEED_VERSION = 2;
  let products;
  if (store.get("ts_seed_v", 0) !== SEED_VERSION || !store.get("ts_products", null)) {
    products = window.STORE.products.map((p) => ({ ...p, image: p.image || null }));
    store.set("ts_products", products);
    store.set("ts_seed_v", SEED_VERSION);
  } else {
    products = store.get("ts_products", []);
  }
  // categoria Tampas (out/2026): tampas saem de Componentes e entram os novos exemplos de tampa
  if (!store.get("ts_mig_tampas", false)) {
    products.forEach((p) => { if (p.cat === "pecas" && /^tampa/i.test(p.name)) { p.cat = "tampas"; if (/^PC\d/.test(p.code || "")) p.code = "TP" + p.code.slice(2); } });
    window.STORE.products.filter((p) => p.cat === "tampas" && !products.some((x) => x.id === p.id)).forEach((p) => products.push({ ...p, image: null }));
    store.set("ts_mig_tampas", true);
  }
  // amostra de produtos com foto (out/2026): entra também em catálogos já salvos no navegador
  if (!store.get("ts_mig_amostra", false)) {
    window.STORE.products.filter((p) => p.image && !products.some((x) => x.id === p.id)).forEach((p) => products.push({ ...p }));
    store.set("ts_mig_amostra", true);
  }
  // Todo produto tem código e dois preços: consumidor (price) e lojista (priceLoj).
  const CODE_PREFIX = { telas: "TL", peliculas: "PL", capinhas: "CP", baterias: "BT", carregadores: "CR", acessorios: "AC", tampas: "TP", pecas: "PC" };
  products.forEach((p, i) => {
    p.code ||= (CODE_PREFIX[p.cat] || "TS") + (digits(p.sku) || 3000 + i);
    p.priceLoj ??= Math.round(p.price * 0.8 * 10) / 10;
    // custo de exemplo (55% do preço) só para os produtos de demonstração; o admin edita no cadastro
    p.cost ??= Math.round(p.price * 0.55 * 10) / 10;
  });
  const saveProducts = () => store.set("ts_products", products);
  saveProducts();
  const catBy = (slug) => categories.find((c) => c.slug === slug) || categories[categories.length - 1];
  const prodBy = (id) => products.find((p) => p.id === id);
  const isLojista = () => session()?.type === "lojista";
  // Lojista logado vê o preço de lojista; os demais veem o preço de consumidor (com promoção, se houver).
  const basePrice = (p) => isLojista() ? (p.priceLoj ?? p.price) : (p.promo ?? p.price);
  const fullName = (p) => p.code ? `${p.name} - ${p.code}` : p.name;
  // Valores só aparecem para quem está logado (cliente ou lojista). Estoque e produtos aparecem para todos.
  const canSeePrice = () => !!session();
  const loginHref = () => `#/login?volta=${encodeURIComponent(location.hash || "#/")}`;
  const lockHTML = (label = "Entrar para ver o preço") => `<a class="price-lock" href="${loginHref()}">${icon("i-lock")}<span>${label}</span></a>`;
  const media = (p) => p.image ? `<img src="${p.image}" alt="${esc(p.name)}" loading="lazy">` : icon(catBy(p.cat).icon);

  // ---------- contas ----------
  // Usuário administrador já criado. Na versão final: senha com bcrypt no banco, nunca no código.
  // O admin entra pelo servidor (/api/admin-login). Nenhuma senha de admin fica no código do site.
  const users = () => store.get("ts_users", []);
  const adminAuth = () => {
    const t = store.get("ts_admin_token", null);
    return t && t.exp > Date.now() ? `Bearer ${t.token}` : "";
  };
  const session = () => store.get("ts_session", null);
  function login(user) {
    const { password, ...safe } = user;
    store.set("ts_session", safe);
    const hour = new Date().getHours();
    const greet = hour < 12 ? "BOM DIA" : hour < 18 ? "BOA TARDE" : "BOA NOITE";
    const first = (user.type === "lojista" ? user.fantasia || user.razao : user.name).split(" ")[0];
    const s = document.createElement("div");
    s.className = "splash";
    s.innerHTML = `<div><div class="splash__mark">${icon("i-check")}</div><small>${greet}</small><h2>Olá, ${esc(first)}!</h2><p class="muted">Abrindo seu catálogo…</p></div>`;
    document.body.append(s);
    setTimeout(() => s.remove(), 2500);
  }
  const displayName = (s) => s.type === "lojista" ? (s.fantasia || s.razao) : s.name;

  // ---------- carrinho ----------
  let cart = store.get("ts_cart", []);
  const lineKey = (id, v) => `${id}|${v ?? ""}`;
  function itemPrice(p, variant) {
    const delta = p.variants?.find(([n]) => n === variant)?.[1] || 0;
    return basePrice(p) + delta;
  }
  const cartLines = () => cart.map((l) => {
    const p = prodBy(l.id);
    return p ? { ...l, p, unit: itemPrice(p, l.variant), sub: itemPrice(p, l.variant) * l.qty } : null;
  }).filter(Boolean);
  const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);
  const cartTotal = () => cartLines().reduce((s, l) => s + l.sub, 0);

  // ---------- cupom de desconto (o servidor confere e calcula; aqui só mostra) ----------
  let cupom = store.get("ts_cupom", null); // { ok, code, desconto, descricao, base } ou { ok:false, code, error }
  let cupomChecando = false;
  const cartKey = () => `${cartLines().map((l) => `${l.id}:${l.variant}:${l.qty}:${l.unit}`).join("|")}#${session()?.type || ""}`;
  const descontoCupom = () => (cupom?.ok && cupom.base === cartKey() ? cupom.desconto : 0);
  const totalComCupom = () => Math.max(0, cartTotal() - descontoCupom());
  async function aplicarCupom(codeRaw) {
    const code = String(codeRaw || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (!code) return;
    if (!location.protocol.startsWith("http")) { cupom = { ok: false, code, error: "Cupom só funciona no site publicado" }; return syncCartUI(); }
    cupomChecando = true; syncCartUI();
    try {
      const r = await fetch("/api/coupons", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, canal: "site", tipo: session()?.type === "lojista" ? "lojista" : "cliente", itens: cartLines().map((l) => ({ productId: l.id, qty: l.qty, sub: l.sub })) }),
      });
      const d = await r.json();
      cupom = d.ok ? { ok: true, code: d.code, desconto: d.desconto, descricao: d.descricao, itensNaPromo: d.itensNaPromo, base: cartKey() } : { ok: false, code, error: d.error || "Cupom inválido" };
    } catch { cupom = { ok: false, code, error: "Não foi possível conferir o cupom agora" }; }
    cupomChecando = false;
    store.set("ts_cupom", cupom);
    syncCartUI();
  }
  function cupomHTML() {
    if (!canSeePrice() || !cart.length) return "";
    if (cupomChecando) return `<div class="cupom cupom--load">${icon("i-tag")}Conferindo cupom…</div>`;
    if (cupom?.ok && cupom.base === cartKey()) {
      return `<div class="cupom cupom--ok">${icon("i-tag")}<span><b>${esc(cupom.code)}</b><small>${esc(cupom.descricao)}</small></span><button class="text-btn" data-cupom-remove aria-label="Remover cupom">Remover</button></div>`;
    }
    return `<form class="cupom-form" data-cupom-form novalidate>
      <input name="cupom" value="${esc(cupom && !cupom.ok ? cupom.code : "")}" placeholder="Cupom de desconto" aria-label="Cupom de desconto" autocomplete="off" autocapitalize="characters" maxlength="24">
      <button class="btn btn--ghost btn--sm">Aplicar</button>
      ${cupom && !cupom.ok ? `<span class="cupom-err">${esc(cupom.error)}</span>` : ""}
    </form>`;
  }
  const totaisHTML = () => {
    const d = descontoCupom();
    return `${d ? `<div class="total-line total-line--sub"><span>Subtotal</span><span>${money(cartTotal())}</span></div>
      <div class="total-line total-line--desc"><span>Cupom ${esc(cupom.code)}</span><span>-${money(d)}</span></div>` : ""}
      <div class="total-line"><span>Total</span><strong>${money(totalComCupom())}</strong></div>`;
  };
  function saveCart() { store.set("ts_cart", cart); syncCartUI(); }
  function addToCart(id, variant = null, qty = 1) {
    const p = prodBy(id);
    if (!p || p.stock <= 0) return;
    if (p.variants && !variant) variant = p.variants[0][0];
    const k = lineKey(id, variant);
    const line = cart.find((l) => lineKey(l.id, l.variant) === k);
    const current = line ? line.qty : 0;
    const next = Math.min(p.stock, current + qty);
    if (next === current) return toast(`Só temos ${p.stock} em estoque`);
    if (line) line.qty = next; else cart.push({ id, variant, qty: next });
    saveCart();
    const badge = $("#cart-count");
    badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump");
    toast(`${fullName(p)}${variant ? " – " + variant : ""} adicionado`);
  }
  function setQty(key, qty) {
    const line = cart.find((l) => lineKey(l.id, l.variant) === key);
    if (!line) return;
    const p = prodBy(line.id);
    if (qty <= 0 || !p) cart = cart.filter((l) => l !== line);
    else line.qty = Math.min(qty, p.stock);
    saveCart();
  }

  function cartItemHTML(l) {
    const k = lineKey(l.id, l.variant);
    return `<div class="citem">
      <div class="row__thumb">${media(l.p)}</div>
      <div>
        <div class="citem__name">${esc(fullName(l.p))}</div>
        ${l.variant ? `<div class="citem__var">${esc(l.variant)}</div>` : ""}
        ${l.p.stock <= 0 ? `<div class="citem__out">${icon("i-lock")}Esgotou agora. Remova para fechar o pedido.
          <button class="text-btn" data-alert="${l.p.id}">${hasMyAlert(l.p.id) ? "Aviso ativado" : "Avise-me"}</button></div>` : ""}
        <div class="citem__line" ${l.p.stock <= 0 ? 'style="opacity:.5"' : ""}>
          <div class="qty qty--sm">
            <button data-qty="${esc(k)}" data-d="-1" aria-label="Diminuir">${icon("i-minus")}</button>
            <span>${l.qty}</span>
            <button data-qty="${esc(k)}" data-d="1" aria-label="Aumentar">${icon("i-plus")}</button>
          </div>
          <strong>${canSeePrice() ? money(l.sub) : ""}</strong>
          <button class="citem__remove" data-remove="${esc(k)}" aria-label="Remover">${icon("i-trash")}</button>
        </div>
      </div>
    </div>`;
  }

  const lockedCartHTML = () => `
      <p class="lock-note">${icon("i-lock")}Entre ou crie sua conta para ver os valores e enviar o pedido.</p>
      <a class="btn btn--primary btn--block" href="${loginHref()}">Entrar ou cadastrar</a>`;

  function syncCartUI() {
    const count = cartCount(), total = cartTotal();
    const badge = $("#cart-count");
    badge.textContent = count; badge.hidden = !count;
    const route = location.hash.split("?")[0];
    const hideBar = ["#/carrinho", "#/login", "#/cadastro", "#/admin"].includes(route) || route.startsWith("#/pedido");
    $("#cartbar").hidden = !count || hideBar;
    $("#cartbar-count").textContent = count;
    $("#cartbar-total").textContent = money(Math.max(0, total - descontoCupom()));
    // carrinho mudou depois de aplicar o cupom: confere de novo (o desconto depende dos itens)
    if (cupom?.ok && cupom.base !== cartKey() && !cupomChecando && cart.length && canSeePrice()) setTimeout(() => aplicarCupom(cupom.code), 0);
    $("#cartbar-total").hidden = !canSeePrice();

    const lines = cartLines();
    $("#drawer-body").innerHTML = lines.length
      ? lines.map(cartItemHTML).join("")
      : `<div class="empty" style="margin-top:24px">Seu carrinho está vazio.<br><a class="link-arrow" href="#/catalogo" style="margin-top:12px">Ver catálogo ${icon("i-arrow")}</a></div>`;
    $("#drawer-foot").innerHTML = !lines.length ? "" : canSeePrice() ? `
      ${cupomHTML()}
      ${totaisHTML()}
      <button class="btn btn--wa btn--block" data-send>${icon("i-check")}Fechar pedido</button>
      <a class="btn btn--ghost btn--block" href="#/carrinho">Ver carrinho completo</a>` : lockedCartHTML();

    if (route === "#/carrinho") renderCart();
  }

  function openDrawer() {
    $("#overlay").hidden = false;
    requestAnimationFrame(() => { $("#overlay").classList.add("is-open"); $("#drawer").classList.add("is-open"); });
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#cart-close").focus();
  }
  function closeDrawer() {
    $("#overlay").classList.remove("is-open"); $("#drawer").classList.remove("is-open");
    $("#drawer").setAttribute("aria-hidden", "true");
    setTimeout(() => ($("#overlay").hidden = true), 300);
  }

  // ---------- pedidos: API (Vercel + Redis) com modo local para testes em file:// ----------
  const REMOTE = location.protocol.startsWith("http");
  const ordersApi = {
    async req(method, query = "", body, admin = false) {
      const headers = { "Content-Type": "application/json" };
      if (admin) headers.Authorization = adminAuth();
      const r = await fetch(`/api/orders${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined, keepalive: method === "PATCH" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(data.error || "Falha na comunicação com a loja"), { status: r.status });
      return data;
    },
    async create(payload) {
      if (REMOTE) return this.req("POST", "", payload);
      // modo local (arquivo aberto direto no navegador): simula o servidor
      const all = store.get("ts_orders", []);
      const seq = store.get("ts_order_seq", 0) + 1;
      store.set("ts_order_seq", seq);
      const order = {
        ...payload, code: `TS-${String(seq).padStart(6, "0")}`, seq, createdAt: new Date().toISOString(),
        status: "NEW", stage: "PENDING", checkout: null, token: crypto.randomUUID(),
        subtotal: payload.items.reduce((s, it) => s + it.unit * it.qty, 0),
      };
      order.items = order.items.map((it) => ({ ...it, sub: it.unit * it.qty }));
      store.set("ts_orders", [order, ...all]);
      const { token, ...pub } = order;
      return { order: pub, token };
    },
    async confirm(code, body) {
      if (REMOTE) return this.req("PATCH", `?code=${encodeURIComponent(code)}`, body);
      const all = store.get("ts_orders", []);
      const o = all.find((x) => x.code === code);
      Object.assign(o, { checkout: { name: body.name, phone: body.phone, note: body.note, delivery: body.delivery, payment: body.payment }, stage: "CONFIRMED", confirmedAt: new Date().toISOString() });
      store.set("ts_orders", all);
      const { token, ...pub } = o;
      return { order: pub };
    },
    async mine(list) {
      if (!list.length) return { orders: [] };
      if (REMOTE) return this.req("GET", `?mine=${encodeURIComponent(list.map((o) => `${o.code}:${o.token}`).join(","))}`);
      const all = store.get("ts_orders", []);
      return { orders: all.filter((o) => list.some((m) => m.code === o.code)).map(({ token, ...o }) => o) };
    },
    async adminList(since) {
      if (REMOTE) return this.req("GET", since !== undefined ? `?since=${since}` : "", null, true);
      return { ver: Date.now(), changed: true, orders: store.get("ts_orders", []).filter((o) => o.stage).map(({ token, ...o }) => o) };
    },
    async setStatus(code, status) {
      if (REMOTE) return this.req("PUT", `?code=${encodeURIComponent(code)}`, { status }, true);
      const all = store.get("ts_orders", []);
      all.find((x) => x.code === code).status = status;
      store.set("ts_orders", all);
      return {};
    },
  };

  // ---------- Avise-me: API com modo local para testes em file:// ----------
  const alertsApi = {
    req: (method, query, body, admin) => fetchJSON(`/api/alerts${query || ""}`, method, body, admin),
    async create(payload) {
      if (REMOTE) return this.req("POST", "", payload);
      const all = store.get("ts_alerts", []);
      const alert = { ...payload, id: crypto.randomUUID(), status: "PENDING", createdAt: new Date().toISOString() };
      store.set("ts_alerts", [alert, ...all]);
      return { alert };
    },
    async list() {
      if (REMOTE) return this.req("GET", "", null, true);
      return { alerts: store.get("ts_alerts", []) };
    },
    async setStatus(id, status) {
      if (REMOTE) return this.req("PUT", `?id=${encodeURIComponent(id)}`, { status }, true);
      const all = store.get("ts_alerts", []);
      all.find((a) => a.id === id).status = status;
      store.set("ts_alerts", all);
      return {};
    },
    async remove(id) {
      if (REMOTE) return this.req("DELETE", `?id=${encodeURIComponent(id)}`, null, true);
      store.set("ts_alerts", store.get("ts_alerts", []).filter((a) => a.id !== id));
      return {};
    },
  };
  async function fetchJSON(url, method, body, admin) {
    const headers = { "Content-Type": "application/json" };
    if (admin) headers.Authorization = adminAuth();
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Falha na comunicação com a loja"), { status: r.status });
    return data;
  }

  // produtos que este aparelho já pediu aviso (só para mostrar "Aviso ativado")
  const myAlerts = () => store.get("ts_my_alerts", []);
  const hasMyAlert = (id) => myAlerts().includes(id);

  function openAlert(productId) {
    const p = prodBy(productId);
    if (!p) return;
    const f = $("#alert-form"), s = session();
    f.reset();
    f.dataset.product = p.id;
    f.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
    $("#alert-product").innerHTML = `<span class="row__thumb">${media(p)}</span><div><strong>${esc(fullName(p))}</strong><span class="stock stock--out">Esgotado</span></div>`;
    if (s && s.role !== "ADMIN") {
      f.name.value = s.type === "lojista" ? (s.fantasia || s.razao) : s.name;
      f.email.value = s.email || "";
      f.phone.value = s.phone || "";
    }
    syncAlertFields();
    $("#alert-submit").disabled = false;
    $("#alert-modal").showModal();
  }
  function syncAlertFields() {
    const f = $("#alert-form");
    const ch = [...f.querySelectorAll("[name=channel]:checked")].map((c) => c.value);
    $("#alert-email-field").hidden = !ch.includes("email");
    $("#alert-phone-field").hidden = !ch.includes("whatsapp");
    if (ch.length) $("#channel-err").textContent = "";
  }
  $("#alert-form").addEventListener("change", (e) => { if (e.target.name === "channel") syncAlertFields(); });
  $("#alert-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, p = prodBy(f.dataset.product);
    const channels = [...f.querySelectorAll("[name=channel]:checked")].map((c) => c.value);
    $("#channel-err").textContent = channels.length ? "" : "Marque e-mail, WhatsApp ou os dois";
    const rules = { name: req() };
    if (channels.includes("email")) rules.email = emailRule;
    if (channels.includes("whatsapp")) rules.phone = phoneRule;
    if (!validate(f, rules) || !channels.length || !p) return;
    const btn = $("#alert-submit");
    btn.disabled = true;
    try {
      await alertsApi.create({
        product: { id: p.id, name: p.name, code: p.code },
        name: f.name.value.trim(), channels,
        email: channels.includes("email") ? f.email.value.trim() : "",
        phone: channels.includes("whatsapp") ? f.phone.value.trim() : "",
        customerType: session()?.type === "lojista" ? "lojista" : "cliente",
      });
      store.set("ts_my_alerts", [...new Set([...myAlerts(), p.id])]);
      $("#alert-modal").close();
      toast(`Pronto! Avisaremos por ${channels.map((c) => (c === "email" ? "e-mail" : "WhatsApp")).join(" e ")} quando chegar.`);
      router();
    } catch (err) {
      btn.disabled = false;
      toast(err.message);
    }
  });

  // pedidos do cliente neste aparelho (código + token para consultar o status)
  const myOrders = () => store.get("ts_my_orders", []);
  function saveMyOrder(order, token) {
    const list = myOrders().filter((o) => o.code !== order.code);
    const prev = myOrders().find((o) => o.code === order.code);
    store.set("ts_my_orders", [{ ...order, token: token || prev?.token, owner: session()?.email || null }, ...list].slice(0, 50));
  }

  const PAYMENT_LABEL = { credito: "Cartão de crédito", debito: "Cartão de débito", pix: "Pix", dinheiro: "Dinheiro" };
  const STAGE_LABEL = { PENDING: "Aguardando dados", CONFIRMED: "Confirmado pelo cliente" };
  const fmtAddress = (a) => a ? `${a.rua}, ${a.numero}${a.complemento ? ` - ${a.complemento}` : ""}, ${a.bairro}, ${a.cidade}/${a.uf}, CEP ${a.cep}` : "";
  const deliveryText = (o) => !o.checkout ? "—" : o.checkout.delivery === "entrega" ? `Entregar no endereço cadastrado: ${fmtAddress(o.customer.address)}` : "Retirar na loja";

  // mensagem no formato pedido pelo cliente
  function buildMessage(o) {
    const c = o.customer, k = o.checkout || {};
    const lojista = c.type === "lojista";
    const items = o.items.map((it) =>
      `*${it.qty}x* ${it.name}${it.variant ? ` (${it.variant})` : ""} - *${money(it.sub)}*`).join("\n");
    return [
      `*PEDIDO ${o.code}*`,
      "",
      "Olá Top Smart, aqui está meu pedido:",
      "",
      lojista ? `Razão Social: ${k.name || c.razao}` : `Cliente: ${k.name || c.name}`,
      lojista ? `CNPJ: ${c.doc}` : `CPF: ${c.doc}`,
      `Telefone: ${k.phone || c.phone}`,
      "",
      "Produtos:",
      "",
      items,
      "",
      `Subtotal: *${money(o.subtotal)}*`,
      ...(o.cupom ? [`Cupom ${o.cupom.code}: *-${money(o.cupom.desconto)}*`, `Total: *${money(o.total)}*`] : []),
      `Forma de pagamento: ${PAYMENT_LABEL[k.payment] || "—"}`,
      "",
      `Entrega: ${deliveryText(o)}`,
      ...(k.note ? ["", `Observação: ${k.note}`] : []),
    ].join("\n");
  }
  const waLink = (o) => `https://wa.me/${whatsapp}?text=${encodeURIComponent(buildMessage(o))}`;

  // 1) cliente clica em "Fechar pedido": pede confirmação
  function startCheckout() {
    if (!cart.length) return;
    closeDrawer();
    if (!canSeePrice()) { toast("Entre na sua conta para enviar o pedido"); location.hash = loginHref(); return; }
    const out = cartLines().filter((l) => l.p.stock <= 0);
    if (out.length) { toast(`${fullName(out[0].p)} esgotou. Remova do carrinho ou toque em Avise-me.`); openDrawer(); return; }
    const lines = cartLines();
    $("#confirm-list").innerHTML = lines.map((l) => `<div class="total-line"><span>${l.qty}x ${esc(fullName(l.p))}${l.variant ? ` <small class="muted">(${esc(l.variant)})</small>` : ""}</span><span>${money(l.sub)}</span></div>`).join("")
      + (descontoCupom() ? `<div class="total-line confirm-total"><span>Subtotal</span><span>${money(cartTotal())}</span></div><div class="total-line"><span>Cupom ${esc(cupom.code)}</span><span class="pos">-${money(descontoCupom())}</span></div><div class="total-line"><span>Total</span><strong>${money(totalComCupom())}</strong></div>`
        : `<div class="total-line confirm-total"><span>Subtotal</span><strong>${money(cartTotal())}</strong></div>`);
    $("#confirm-yes").disabled = false;
    $("#confirm-yes").textContent = "Sim, fechar pedido";
    $("#confirm-modal").showModal();
  }

  // 2) confirmou: gera o pedido (número sequencial) para o cliente e para o admin
  let checkoutOrder = null;
  $("#confirm-yes").addEventListener("click", async () => {
    const btn = $("#confirm-yes");
    btn.disabled = true; btn.textContent = "Gerando pedido…";
    const s = session();
    const payload = {
      items: cartLines().map((l) => ({ productId: l.id, name: fullName(l.p), variant: l.variant, qty: l.qty, unit: l.unit })),
      cupom: descontoCupom() ? cupom.code : undefined,
      customer: {
        type: s.type === "lojista" ? "lojista" : "cliente",
        name: s.type === "lojista" ? s.responsavel : s.name, razao: s.razao || "",
        doc: s.type === "lojista" ? s.cnpj : s.cpf, phone: s.phone, email: s.email, address: s.address || null,
      },
    };
    try {
      const { order, token } = await ordersApi.create(payload);
      saveMyOrder(order, token);
      cupom = null; store.set("ts_cupom", null);
      cart = []; saveCart();
      $("#confirm-modal").close();
      toast(`Pedido ${order.code} gerado!`);
      openCheckout(order);
    } catch (err) {
      btn.disabled = false; btn.textContent = "Tentar de novo";
      toast(err.message || "Não foi possível gerar o pedido");
    }
  });

  // 3) "Quase lá": nome/razão, telefone, observação, entrega e pagamento
  function openCheckout(order) {
    checkoutOrder = order;
    const f = $("#checkout-form"), c = order.customer, k = order.checkout || {};
    f.reset();
    f.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
    $("#checkout-code").innerHTML = `${icon("i-check")}Pedido <strong>${esc(order.code)}</strong> gerado`;
    $("#checkout-name-label").textContent = c.type === "lojista" ? "Razão social" : "Nome";
    f.name.value = k.name || (c.type === "lojista" ? c.razao : c.name) || "";
    f.phone.value = k.phone || c.phone || "";
    f.note.value = k.note || "";
    $("#delivery-options").innerHTML = `
      <label class="opt-card"><input type="radio" name="delivery" value="retirada" ${k.delivery !== "entrega" ? "checked" : ""}><span>${icon("i-store")}<b>Retirar na loja</b><small>Pronta entrega no balcão</small></span></label>
      <label class="opt-card ${c.address ? "" : "is-disabled"}"><input type="radio" name="delivery" value="entrega" ${c.address ? "" : "disabled"} ${k.delivery === "entrega" ? "checked" : ""}><span>${icon("i-truck")}<b>Entregar no endereço</b><small>${c.address ? esc(fmtAddress(c.address)) : "Sem endereço no cadastro"}</small></span></label>`;
    if (k.payment) f.querySelector(`[name=payment][value=${k.payment}]`).checked = true;
    $("#checkout-modal").showModal();
  }

  $("#checkout-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target, o = checkoutOrder;
    if (!o) return;
    const ok = validate(f, { name: req(), phone: phoneRule });
    const delivery = f.querySelector("[name=delivery]:checked")?.value;
    const payment = f.querySelector("[name=payment]:checked")?.value;
    $("#delivery-err").textContent = delivery ? "" : "Escolha retirada ou entrega";
    $("#payment-err").textContent = payment ? "" : "Escolha a forma de pagamento";
    if (!ok || !delivery || !payment) return;
    const body = { token: myOrders().find((m) => m.code === o.code)?.token, name: f.name.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim(), delivery, payment };
    const confirmed = { ...o, checkout: { name: body.name, phone: body.phone, note: body.note, delivery, payment }, stage: "CONFIRMED" };
    // abre o WhatsApp na hora (dentro do clique, para o navegador não bloquear) e grava no servidor em paralelo
    window.open(waLink(confirmed), "_blank", "noopener");
    saveMyOrder(confirmed);
    ordersApi.confirm(o.code, body).catch((err) => toast(`Atenção: ${err.message}. A loja ainda recebe pelo WhatsApp.`));
    $("#checkout-modal").close();
    location.hash = `#/pedido/${o.code}`;
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-close-modal]");
    if (b) b.closest("dialog").close();
  });

  // ---------- componentes ----------
  function tags(p) {
    if (p.stock <= 0) return `<span class="card__tag">Esgotado</span>`;
    if (isLojista()) return `<span class="card__tag card__tag--promo">Preço lojista</span>`;
    if (p.promo) return `<span class="card__tag card__tag--promo">Oferta</span>`;
    if (p.isNew) return `<span class="card__tag">Novo</span>`;
    return "";
  }
  const priceHTML = (p) => {
    if (!canSeePrice()) return lockHTML("Ver preço");
    if (isLojista()) return `<span class="price"><small class="price__tag">Lojista</small>${money(basePrice(p))}</span>`;
    return p.promo ? `<span class="price"><s>${money(p.price)}</s>${money(p.promo)}</span>` : `<span class="price">${money(p.price)}</span>`;
  };
  function stockHTML(p) {
    if (p.stock <= 0) return `<span class="stock stock--out">Esgotado</span>`;
    if (p.stock <= 3) return `<span class="stock stock--low">Últimas ${p.stock}</span>`;
    return `<span class="stock">${p.stock} em estoque</span>`;
  }
  const addBtn = (p) => p.stock <= 0
    ? `<button class="alert-btn ${hasMyAlert(p.id) ? "is-on" : ""}" data-alert="${p.id}" aria-label="${hasMyAlert(p.id) ? "Aviso ativado para" : "Avise-me quando chegar"} ${esc(fullName(p))}">${icon(hasMyAlert(p.id) ? "i-check" : "i-bell")}<span>${hasMyAlert(p.id) ? "Avisaremos" : "Avise-me"}</span></button>`
    : `<button class="add-btn" data-add="${p.id}" aria-label="Adicionar ${esc(fullName(p))} ao carrinho">${icon("i-plus")}</button>`;

  const card = (p) => `<article class="card">
    <a href="#/produto/${p.slug}" class="card__media">${media(p)}${tags(p)}</a>
    <div class="card__body">
      <span class="card__cat">${esc(catBy(p.cat).name)}${p.brand ? " · " + esc(p.brand) : ""}</span>
      <a href="#/produto/${p.slug}" class="card__name">${esc(fullName(p))}</a>
      <div class="card__foot">${priceHTML(p)}${addBtn(p)}</div>
    </div>
  </article>`;

  const row = (p) => `<div class="row">
    <a href="#/produto/${p.slug}" class="row__thumb">${media(p)}</a>
    <div>
      <a href="#/produto/${p.slug}" class="row__name">${esc(fullName(p))}</a>
      <div class="row__meta"><span>${esc(catBy(p.cat).name)}</span>${stockHTML(p)}${p.variants ? `<span>${p.variants.length} opções</span>` : ""}</div>
    </div>
    <div class="row__right">${priceHTML(p)}${addBtn(p)}</div>
  </div>`;

  // ---------- header, menu e rodapé ----------
  function renderNav() {
    const brandLinks = (cat) => Object.keys(brands).map((b) =>
      `<a href="#/catalogo?${cat ? `cat=${cat}&` : ""}brand=${encodeURIComponent(b)}">${b}</a>`).join("");
    const items = categories.map((c) => `
      <li class="nav__item">
        <a class="nav__link" data-nav="${c.slug}" href="#/categoria/${c.slug}">${c.name}${icon("i-down")}</a>
        <div class="mega"><div class="container mega__inner">
          <div><div class="mega__title">${c.name}<small>${c.desc}</small></div><a class="link-arrow" href="#/categoria/${c.slug}">Ver tudo ${icon("i-arrow")}</a></div>
          <div class="mega__brands">${brandLinks(c.slug)}</div>
        </div></div>
      </li>`).join("");
    $("#nav-list").innerHTML = items + `
      <li class="nav__item">
        <a class="nav__link" data-nav="marcas" href="#/catalogo">Marcas${icon("i-down")}</a>
        <div class="mega"><div class="container mega__inner">
          <div><div class="mega__title">Marcas<small>Escolha a marca do aparelho</small></div><a class="link-arrow" href="#/catalogo">Catálogo completo ${icon("i-arrow")}</a></div>
          <div class="mega__brands">${brandLinks()}</div>
        </div></div>
      </li>`;
    $("#footer-cats").innerHTML = categories.map((c) => `<li><a href="#/categoria/${c.slug}">${c.name}</a></li>`).join("");
  }

  function renderHeader() {
    const route = location.hash.split("?")[0];
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const activeCat = route.startsWith("#/categoria/") ? route.split("/")[2] : params.get("cat");
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("is-active", a.dataset.nav === activeCat));
    const s = session();
    const link = $("#account-link");
    if (s) {
      link.href = s.role === "ADMIN" ? "#/admin" : "#/conta";
      $("#account-text").innerHTML = `<strong>Olá, ${esc(displayName(s).split(" ")[0])}</strong><small>${s.role === "ADMIN" ? "Painel admin" : "Minha conta"}</small>`;
      link.setAttribute("aria-label", s.role === "ADMIN" ? "Painel admin" : "Minha conta");
    } else {
      link.href = "#/login";
      $("#account-text").innerHTML = `<strong>Olá! Faça login</strong><small>Ou cadastre-se</small>`;
      link.setAttribute("aria-label", "Entrar ou cadastrar");
    }
  }

  // ---------- views ----------
  const perk = (ic, t, d) => `<div class="perk"><span class="perk__ic">${icon(ic)}</span><div><strong>${t}</strong><span>${d}</span></div></div>`;

  // card do banner de lojista: usa o produto real, se existir, para mostrar o preço de quem está logado
  function heroCard(ic, label, name) {
    const p = products.find((x) => x.name === name);
    const price = !canSeePrice() ? `<span class="price">${icon("i-lock")}</span>` : p ? `<span class="price">${money(basePrice(p))}</span>` : "";
    return `<div class="stack__card"><span class="row__thumb">${icon(ic)}</span><div><small>${label}</small><strong>${esc(name)}</strong></div>${price}</div>`;
  }

  function viewHome() {
    const featured = products.filter((p) => p.featured).slice(0, 8);
    const news = [...products].filter((p) => p.isNew).slice(0, 4);
    const minTela = Math.min(...products.filter((p) => p.cat === "telas" && p.stock > 0).map(basePrice));
    return `<div class="view">
      <section class="hero">
        <div class="container">
          <div class="slider" id="slider" aria-roledescription="carrossel" aria-label="Destaques da loja">
            <div class="slides">
              <article class="slide slide--dark is-active" aria-roledescription="slide" aria-label="1 de 3">
                <div class="slide__copy">
                  <span class="slide__eyebrow">Peças e componentes</span>
                  <h1>Aqui tem <em>inovação.</em></h1>
                  <p>Telas, baterias, películas e acessórios para o seu celular. Monte o pedido aqui e retire na loja.</p>
                  <div class="slide__ctas">
                    <a href="#/catalogo" class="btn btn--primary">${icon("i-bag")}Confira nossos produtos</a>
                    <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="btn btn--ghost" style="color:#fff;border-color:#333">${icon("i-wa")}Falar com a loja</a>
                  </div>
                </div>
                <div class="slide__visual" aria-hidden="true">
                  <div class="glow"></div>
                  <div class="phone-frame"><img src="assets/loja-balcao.jpg" alt=""></div>
                  <div class="chip chip--a"><span class="chip__ic">${icon("c-telas")}</span><div><strong>Telas OLED e Incell</strong>iPhone, Samsung, Motorola…</div></div>
                  <div class="chip chip--b"><span class="chip__ic">${icon("i-bolt")}</span><div><strong>Retire na hora</strong>pronta entrega</div></div>
                  <div class="chip chip--c"><span class="chip__ic">${icon("i-wa")}</span><div><strong>Pedido no WhatsApp</strong>rápido e sem cadastro de cartão</div></div>
                </div>
              </article>
              <article class="slide slide--blue" aria-roledescription="slide" aria-label="2 de 3">
                <div class="slide__copy">
                  <span class="slide__eyebrow">Para assistências técnicas</span>
                  <h2>É lojista? <em>Compre com CNPJ.</em></h2>
                  <p>Cadastre sua assistência e faça pedidos de peças com atendimento dedicado para quem conserta celular.</p>
                  <div class="slide__ctas">
                    <a href="#/login?tipo=lojista" class="btn btn--dark">${icon("i-store")}Cadastrar como lojista</a>
                  </div>
                </div>
                <div class="slide__visual" aria-hidden="true">
                  <div class="stack">
                    ${heroCard("c-telas", "Telas", "Tela iPhone 11")}
                    ${heroCard("c-baterias", "Baterias", "Bateria Galaxy A14")}
                    ${heroCard("c-pecas", "Componentes", "Conector de carga Galaxy A14")}
                  </div>
                </div>
              </article>
              <article class="slide slide--light" aria-roledescription="slide" aria-label="3 de 3">
                <div class="slide__copy">
                  <span class="slide__eyebrow">Telas e frontais</span>
                  <h2>Tela nova, <em>celular novo.</em></h2>
                  <p>Frontais para iPhone, Samsung, Motorola, Xiaomi e Infinix. Escolha a qualidade: Incell, OLED ou original.</p>
                  <div class="slide__ctas">
                    <a href="#/categoria/telas" class="btn btn--primary">Ver telas ${icon("i-arrow")}</a>
                  </div>
                </div>
                <div class="slide__visual" aria-hidden="true">
                  <div class="screens"><div class="screen"></div><div class="screen"></div><div class="screen"></div>
                    <div class="badge-price">${canSeePrice() ? `<small>a partir de</small><strong>${money(minTela)}</strong>` : `<small>${icon("i-lock")} preços para</small><strong>clientes cadastrados</strong>`}</div>
                  </div>
                </div>
              </article>
              <span class="slider__progress" id="slider-progress"></span>
            </div>
            <button class="slider__arrow slider__arrow--prev" data-slide="-1" aria-label="Banner anterior">${icon("i-left")}</button>
            <button class="slider__arrow slider__arrow--next" data-slide="1" aria-label="Próximo banner">${icon("i-right")}</button>
            <div class="slider__dots" role="tablist">${[0, 1, 2].map((i) => `<button role="tab" aria-label="Banner ${i + 1}" data-dot="${i}" class="${i === 0 ? "is-active" : ""}"></button>`).join("")}</div>
          </div>
          <div class="perks">
            ${perk("i-bolt", "Retirada na hora", "Pronta entrega na loja")}
            ${perk("i-wa", "Pedido pelo WhatsApp", "Sem pagamento online")}
            ${perk("i-store", "Área do lojista", "Cadastro com CNPJ")}
            ${perk("i-shield", "Garantia", "Em todas as peças")}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section__head"><h2>Destaques</h2><a class="link-arrow" href="#/catalogo">Catálogo completo ${icon("i-arrow")}</a></div>
          <div class="grid">${featured.map(card).join("")}</div>
        </div>
      </section>

      <section class="section section--surface">
        <div class="container">
          <div class="section__head"><h2>Departamentos</h2></div>
          <div class="banners">
            <a class="banner banner--dark" href="#/categoria/telas"><h3>Telas</h3><p>Que elevam o padrão do reparo</p><span class="banner__art">${icon("c-telas")}</span><span class="banner__go">${icon("i-arrow")}</span></a>
            <a class="banner" href="#/categoria/baterias"><h3>Baterias</h3><p>Mais horas longe da tomada</p><span class="banner__art">${icon("c-baterias")}</span><span class="banner__go">${icon("i-arrow")}</span></a>
            <a class="banner" href="#/categoria/peliculas"><h3>Películas</h3><p>Proteção do jeito certo</p><span class="banner__art">${icon("c-peliculas")}</span><span class="banner__go">${icon("i-arrow")}</span></a>
            <a class="banner banner--dark" href="#/categoria/pecas"><h3>Componentes</h3><p>Que sua bancada precisa</p><span class="banner__art">${icon("c-pecas")}</span><span class="banner__go">${icon("i-arrow")}</span></a>
          </div>
        </div>
      </section>

      ${news.length ? `<section class="section">
        <div class="container">
          <div class="section__head"><h2>Novidades</h2></div>
          <div class="grid">${news.map(card).join("")}</div>
        </div>
      </section>` : ""}

      <section class="section section--surface">
        <div class="container about">
          <div>
            <span class="slide__eyebrow" style="color:var(--primary)">A loja</span>
            <h2 style="margin-top:12px">Prontos para atender você</h2>
            <p>Loja física com balcão de atendimento e parede cheia de acessórios. Faça o pedido pelo site e passe para retirar, ou fale com a gente no WhatsApp.</p>
            <ul class="about__list">
              <li>${icon("i-check")}Telas, baterias e componentes para assistências</li>
              <li>${icon("i-check")}Capinhas, películas, fones e carregadores</li>
              <li>${icon("i-check")}Atendimento rápido pelo WhatsApp</li>
            </ul>
            <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="btn btn--wa">${icon("i-wa")}(33) 99941-4255</a>
          </div>
          <div class="about__photos">
            <img src="assets/loja-fachada.jpg" alt="Fachada da Top Smart" loading="lazy">
            <img src="assets/loja-interior.jpg" alt="Balcão de atendimento da Top Smart" loading="lazy">
            <img src="assets/loja-parede.jpg" alt="Parede de acessórios da Top Smart" loading="lazy">
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="pro">
            <div>
              <span class="slide__eyebrow">Seja um lojista parceiro</span>
              <h2 style="margin-top:12px">Tem assistência técnica?</h2>
              <p>Cadastre seu CNPJ e faça pedidos de peças para a sua bancada direto pelo site.</p>
              <a href="#/login?tipo=lojista" class="btn btn--primary">${icon("i-store")}Cadastrar minha loja</a>
            </div>
            <ul>
              <li>${icon("i-check")}Cadastro com CNPJ e razão social</li>
              <li>${icon("i-check")}Pedido identificado com os dados da sua empresa</li>
              <li>${icon("i-check")}Histórico de pedidos na sua conta</li>
            </ul>
          </div>
        </div>
      </section>
    </div>`;
  }

  // carrossel
  let sliderTimer;
  function initSlider() {
    clearInterval(sliderTimer);
    const root = $("#slider");
    if (!root) return;
    const slides = [...root.querySelectorAll(".slide")];
    const dots = [...root.querySelectorAll("[data-dot]")];
    const bar = $("#slider-progress");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;
    const go = (n) => {
      i = (n + slides.length) % slides.length;
      slides.forEach((s, k) => { s.classList.toggle("is-active", k === i); s.setAttribute("aria-hidden", k !== i); });
      dots.forEach((d, k) => { d.classList.toggle("is-active", k === i); d.setAttribute("aria-selected", k === i); });
      bar.classList.remove("is-running"); void bar.offsetWidth;
      if (!reduce) bar.classList.add("is-running");
    };
    const start = () => { if (reduce) return; clearInterval(sliderTimer); sliderTimer = setInterval(() => go(i + 1), 6000); };
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-slide],[data-dot]");
      if (!t) return;
      go(t.dataset.slide ? i + +t.dataset.slide : +t.dataset.dot);
      start();
    });
    root.addEventListener("mouseenter", () => { clearInterval(sliderTimer); bar.style.animationPlayState = "paused"; });
    root.addEventListener("mouseleave", () => { bar.style.animationPlayState = "running"; start(); });
    let x0 = null;
    root.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
    root.addEventListener("touchend", (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { go(i + (dx < 0 ? 1 : -1)); start(); }
      x0 = null;
    });
    go(0); start();
  }

  let catalogView = store.get("ts_view", "list");
  function viewCatalog(forcedCat) {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const f = {
      cat: forcedCat || params.get("cat") || "",
      brand: params.get("brand") || "",
      model: params.get("model") || "",
      q: params.get("q") || "",
      min: params.get("min") || "",
      max: params.get("max") || "",
      stock: params.get("stock") === "1",
      sort: params.get("sort") || "relevance",
    };
    // sem login, preço não entra em filtro nem ordenação (não dá para descobrir valores pela URL)
    if (!canSeePrice()) { f.min = f.max = ""; if (f.sort === "low" || f.sort === "high") f.sort = "relevance"; }
    const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    let list = products.filter((p) =>
      (!f.cat || p.cat === f.cat) &&
      (!f.brand || p.brand === f.brand) &&
      (!f.model || p.models.includes(f.model)) &&
      (!f.q || norm(`${p.name} ${p.code} ${p.brand} ${p.models.join(" ")} ${catBy(p.cat).name}`).includes(norm(f.q))) &&
      (!f.min || basePrice(p) >= +f.min) &&
      (!f.max || basePrice(p) <= +f.max) &&
      (!f.stock || p.stock > 0));
    const sorters = {
      relevance: (a, b) => (b.stock > 0) - (a.stock > 0) || !!b.image - !!a.image || b.featured - a.featured,
      low: (a, b) => basePrice(a) - basePrice(b),
      high: (a, b) => basePrice(b) - basePrice(a),
      new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.isNew - a.isNew,
    };
    list = [...list].sort(sorters[f.sort] || sorters.relevance);

    const cat = forcedCat || f.cat ? catBy(f.cat) : null;
    const title = cat ? cat.name : f.q ? `Resultados para “${esc(f.q)}”` : "Catálogo";
    const models = f.brand ? brands[f.brand] || [] : Object.values(brands).flat();

    let results;
    if (!list.length) {
      results = `<div class="empty">Nenhum produto encontrado.<br>Tente outro filtro ou <a class="link-arrow" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener">fale com a loja</a>.</div>`;
    } else if (catalogView === "grid") {
      results = `<div class="grid">${list.map(card).join("")}</div>`;
    } else {
      const groups = {};
      list.forEach((p) => (groups[p.brand || "Outros"] ||= []).push(p));
      results = Object.entries(groups).map(([b, ps]) => `
        <div class="group"><h2 class="group__title">${esc(b)} <span>(${ps.length})</span></h2>
          <div class="rows">${ps.map(row).join("")}</div></div>`).join("");
    }

    return `<div class="view container">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<span>${title}</span></nav>
      <div class="page-head"><h1>${title}</h1><p class="muted">${list.length} ${list.length === 1 ? "produto" : "produtos"}</p></div>
      <div class="pills" role="group" aria-label="Filtrar por marca">
        <button class="pill ${!f.brand ? "is-active" : ""}" data-filter="brand" data-value="">Todas as marcas</button>
        ${Object.keys(brands).map((b) => `<button class="pill ${f.brand === b ? "is-active" : ""}" data-filter="brand" data-value="${b}">${b}</button>`).join("")}
      </div>
      <div class="catalog">
        <aside class="filters" id="filters" aria-label="Filtros">
          ${forcedCat ? "" : `<div><h3>Categoria</h3><select data-filter="cat"><option value="">Todas</option>${categories.map((c) => `<option value="${c.slug}" ${f.cat === c.slug ? "selected" : ""}>${c.name}</option>`).join("")}</select></div>`}
          <div><h3>Modelo do aparelho</h3><select data-filter="model"><option value="">Todos</option>${models.map((m) => `<option ${f.model === m ? "selected" : ""}>${m}</option>`).join("")}</select></div>
          ${canSeePrice() ? `<div><h3>Preço (R$)</h3><div class="price-range">
            <input type="number" min="0" placeholder="Mín." value="${esc(f.min)}" data-filter="min" aria-label="Preço mínimo">
            <input type="number" min="0" placeholder="Máx." value="${esc(f.max)}" data-filter="max" aria-label="Preço máximo"></div></div>` : ""}
          <label class="check"><input type="checkbox" data-filter="stock" ${f.stock ? "checked" : ""}> Só com estoque</label>
          <button class="text-btn" data-clear style="align-self:flex-start">Limpar filtros</button>
        </aside>
        <div>
          <div class="toolbar">
            <button class="btn btn--ghost filters__mobile" style="height:38px;padding:0 14px;font-size:14px" data-toggle-filters>Filtros</button>
            <select data-filter="sort" aria-label="Ordenar">
              <option value="relevance" ${f.sort === "relevance" ? "selected" : ""}>Relevância</option>
              ${canSeePrice() ? `<option value="low" ${f.sort === "low" ? "selected" : ""}>Menor preço</option>
              <option value="high" ${f.sort === "high" ? "selected" : ""}>Maior preço</option>` : ""}
              <option value="new" ${f.sort === "new" ? "selected" : ""}>Mais novos</option>
            </select>
            <div class="view-toggle" role="group" aria-label="Modo de visualização">
              <button class="${catalogView === "list" ? "is-active" : ""}" data-view="list">Lista</button>
              <button class="${catalogView === "grid" ? "is-active" : ""}" data-view="grid">Grade</button>
            </div>
          </div>
          ${results}
        </div>
      </div>
    </div>`;
  }

  function viewProduct(slug) {
    const p = products.find((x) => x.slug === slug);
    if (!p) return viewNotFound();
    const c = catBy(p.cat);
    const related = products.filter((x) => x.id !== p.id && (x.cat === p.cat || x.brand === p.brand)).slice(0, 4);
    return `<div class="view container">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<a href="#/categoria/${c.slug}">${c.name}</a>/<span>${esc(fullName(p))}</span></nav>
      <div class="product">
        <div class="gallery">
          <div class="gallery__main">${media(p)}</div>
        </div>
        <div class="product__info">
          <span class="card__cat">${c.name}${p.brand ? " · " + esc(p.brand) : ""}</span>
          <h1>${esc(fullName(p))}</h1>
          ${stockHTML(p)}
          ${!canSeePrice() ? `<div class="price-locked">
              <span class="price-locked__ic">${icon("i-lock")}</span>
              <div><strong>Preço disponível para clientes cadastrados</strong><span>Entre ou crie sua conta grátis, como cliente ou lojista.</span></div>
              <a class="btn btn--dark" href="${loginHref()}">Entrar ou cadastrar</a>
            </div>`
          : `<div class="product__price" id="pd-price">${money(basePrice(p))}</div>
          ${isLojista()
            ? `<div class="price-note"><span class="tag tag--pro">Preço lojista</span> Consumidor: ${money(p.promo ?? p.price)}</div>`
            : p.promo ? `<div class="muted"><s>${money(p.price)}</s> preço normal</div>` : ""}`}
          <div class="product__sku">Código ${esc(p.code)}</div>
          ${p.variants ? `<div class="opt-label">${p.cat === "telas" ? "Qualidade" : "Opção"}</div>
            <div class="variants" role="radiogroup">${p.variants.map(([n, d], i) => `
              <button class="variant ${i === 0 ? "is-active" : ""}" role="radio" aria-checked="${i === 0}" data-variant="${esc(n)}">${esc(n)}${canSeePrice() ? `<small>${money(basePrice(p) + d)}</small>` : ""}</button>`).join("")}</div>` : ""}
          <div class="buy">
            <div class="qty" aria-label="Quantidade">
              <button data-pdq="-1" aria-label="Diminuir">${icon("i-minus")}</button><span id="pd-qty">1</span><button data-pdq="1" aria-label="Aumentar">${icon("i-plus")}</button>
            </div>
            ${p.stock <= 0
              ? `<button class="btn ${hasMyAlert(p.id) ? "btn--ghost" : "btn--dark"}" style="flex:1" data-alert="${p.id}">${icon(hasMyAlert(p.id) ? "i-check" : "i-bell")}${hasMyAlert(p.id) ? "Aviso ativado · alterar" : "Avise-me quando chegar"}</button>`
              : `<button class="btn btn--primary" style="flex:1" data-pd-add="${p.id}">${icon("i-bag")}Adicionar ao carrinho</button>`}
          </div>
          ${p.models.length ? `<div class="opt-label">Compatível com</div><div class="compat">${p.models.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
          <p class="product__desc">${esc(p.description || "Peça com garantia da loja. Dúvida sobre compatibilidade? Chame no WhatsApp antes de fechar o pedido.")}</p>
        </div>
      </div>
      ${related.length ? `<section style="padding-bottom:96px"><div class="section__head"><h2>Relacionados</h2></div><div class="grid">${related.map(card).join("")}</div></section>` : ""}
    </div>`;
  }

  function renderCart() {
    const lines = cartLines();
    main.innerHTML = `<div class="view container">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<span>Carrinho</span></nav>
      <div class="page-head"><h1>Carrinho</h1><p class="muted">${cartCount()} ${cartCount() === 1 ? "item" : "itens"}</p></div>
      ${lines.length ? `<div class="cart-page">
        <div class="cart-list">${lines.map(cartItemHTML).join("")}</div>
        <aside class="summary">
          <h2>Resumo</h2>
          ${lines.map((l) => `<div class="total-line" style="font-size:14px"><span>${l.qty}x ${esc(fullName(l.p))}</span><span>${canSeePrice() ? money(l.sub) : ""}</span></div>`).join("")}
          <hr style="border:0;border-top:1px solid var(--border);width:100%">
          ${canSeePrice() ? `${cupomHTML()}${totaisHTML()}
          <button class="btn btn--wa btn--block" data-send>${icon("i-check")}Fechar pedido</button>` : lockedCartHTML()}
          <p class="note">Sem pagamento online. A loja confirma disponibilidade e forma de pagamento pelo WhatsApp.</p>
          <button class="text-btn" data-clear-cart>Limpar carrinho</button>
        </aside>
      </div>` : `<div class="empty">Seu carrinho está vazio.<br><a class="btn btn--primary" href="#/catalogo" style="margin-top:16px">Ver catálogo</a></div>`}
    </div>`;
  }

  // comprovante no estilo "notinha de maquininha", usado pelo cliente e pelo admin
  function receiptHTML(o, { admin = false } = {}) {
    const c = o.customer, k = o.checkout;
    const lojista = c.type === "lojista";
    const row = (a, b) => `<div class="rc__row"><span>${a}</span><span>${b}</span></div>`;
    return `<div class="receipt-wrap ${o.status === "NEW" && admin ? "receipt-wrap--new" : ""}"><article class="receipt" id="rc-${esc(o.code)}">
      <header class="rc__head">
        <strong>TOP SMART</strong>
        <small>Peças e Componentes</small>
        <small>WhatsApp (33) 99941-4255</small>
      </header>
      <div class="rc__cut"></div>
      <div class="rc__title">PEDIDO ${esc(o.code)}</div>
      ${row("Data", fmtDate(o.createdAt))}
      ${row("Situação", `<b class="rc__stage rc__stage--${o.stage}">${STAGE_LABEL[o.stage] || o.stage}</b>`)}
      <div class="rc__cut"></div>
      ${row(lojista ? "Razão social" : "Cliente", esc(k?.name || (lojista ? c.razao : c.name)))}
      ${lojista && c.name ? row("Responsável", esc(c.name)) : ""}
      ${row(lojista ? "CNPJ" : "CPF", esc(c.doc || "—"))}
      ${row("Telefone", esc(k?.phone || c.phone || "—"))}
      <div class="rc__cut"></div>
      <div class="rc__items">${o.items.map((it) => `
        <div class="rc__item"><span><b>${it.qty}x</b> ${esc(it.name)}${it.variant ? ` (${esc(it.variant)})` : ""}</span><span>${money(it.sub)}</span></div>`).join("")}
      </div>
      <div class="rc__cut"></div>
      ${o.cupom ? `${row("Subtotal", money(o.subtotal))}${row(`Cupom ${esc(o.cupom.code)}`, `-${money(o.cupom.desconto)}`)}` : ""}
      <div class="rc__total"><span>${o.cupom ? "TOTAL" : "SUBTOTAL"}</span><span>${money(o.total ?? o.subtotal)}</span></div>
      <div class="rc__cut"></div>
      ${row("Pagamento", esc(PAYMENT_LABEL[k?.payment] || "a definir"))}
      ${row("Entrega", k ? (k.delivery === "entrega" ? "Entregar no endereço" : "Retirar na loja") : "a definir")}
      ${k?.delivery === "entrega" ? `<p class="rc__addr">${esc(fmtAddress(c.address))}</p>` : ""}
      ${k?.note ? `<p class="rc__note">Obs.: ${esc(k.note)}</p>` : ""}
      <div class="rc__cut"></div>
      ${admin ? `<div class="rc__actions">
          <select class="status status--${o.status}" data-status="${esc(o.code)}" aria-label="Status do pedido ${esc(o.code)}">${Object.entries(statusLabel).map(([s, v]) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${v}</option>`).join("")}</select>
          <a class="icon-btn icon-btn--sm" target="_blank" rel="noopener" href="https://wa.me/55${digits(k?.phone || c.phone)}" aria-label="Chamar cliente no WhatsApp">${icon("i-wa")}</a>
          <button class="icon-btn icon-btn--sm" data-print="${esc(o.code)}" aria-label="Imprimir pedido ${esc(o.code)}">${icon("i-print")}</button>
        </div>` : `<div class="rc__status">${statusLabel[o.status] || ""}</div>`}
      <footer class="rc__foot">Obrigado pela preferência!<br>Aqui tem inovação!</footer>
    </article>${o.status === "NEW" && admin ? `<span class="receipt-flag">NOVO</span>` : ""}</div>`;
  }

  function viewSuccess(code) {
    const order = myOrders().find((o) => o.code === code);
    if (!order) return viewNotFound();
    const done = order.stage === "CONFIRMED";
    return `<div class="view container success success--wide">
      <div class="success__icon">${icon("i-check")}</div>
      <h1>${done ? "Pedido enviado!" : "Pedido gerado!"}</h1>
      <p class="muted">${done
        ? "A loja já recebeu seu pedido. Se o WhatsApp não abriu, toque no botão abaixo e envie a mensagem."
        : "Falta escolher entrega e forma de pagamento para enviar à loja."}</p>
      <div class="success__grid">
        <div id="success-receipt">${receiptHTML(order)}</div>
        <div class="success__side">
          ${done
            ? `<a class="btn btn--wa btn--block" target="_blank" rel="noopener" href="${waLink(order)}">${icon("i-wa")}Abrir WhatsApp de novo</a>`
            : `<button class="btn btn--primary btn--block" data-complete="${esc(order.code)}">${icon("i-check")}Completar e enviar</button>`}
          <a class="btn btn--ghost btn--block" href="#/catalogo">Continuar comprando</a>
          <a class="text-btn" href="#/conta">Ver meus pedidos</a>
          ${done ? `<details class="msg-details"><summary>Mensagem enviada</summary><div class="msg-preview">${esc(buildMessage(order))}</div></details>` : ""}
        </div>
      </div>
    </div>`;
  }

  // atualiza o status dos pedidos do cliente com o servidor (o admin pode ter mudado)
  async function refreshMyOrders(onDone) {
    try {
      const { orders } = await ordersApi.mine(myOrders());
      orders.forEach((o) => saveMyOrder(o));
      onDone?.();
    } catch { /* sem conexão: mantém o que está salvo */ }
  }

  // ---------- login + cadastro (cliente ou lojista) ----------
  const pwField = (name, label, auto) => `<label class="field">${label}<span class="pw"><input name="${name}" type="password" autocomplete="${auto}" required><button type="button" data-pw aria-label="Mostrar senha">${icon("i-eye")}</button></span><span class="err"></span></label>`;
  const fld = (name, label, attrs = "", cls = "") => `<label class="field ${cls}"><span>${label}</span><input name="${name}" ${attrs}><span class="err"></span></label>`;

  // endereço com busca automática pelo CEP (ViaCEP)
  const addressFields = () => `
    <div class="form-section full">${icon("i-pin")}Endereço</div>
    ${fld("cep", 'CEP <span class="cep-status" id="cep-status"></span>', 'inputmode="numeric" data-mask="cep" autocomplete="postal-code" placeholder="00000-000" required')}
    ${fld("numero", "Número", 'inputmode="numeric" autocomplete="address-line2" required')}
    ${fld("rua", "Rua", 'autocomplete="address-line1" required', "full")}
    ${fld("complemento", 'Complemento <span class="opt">(opcional)</span>', 'placeholder="Apto, sala, ponto de referência"', "full")}
    ${fld("bairro", "Bairro", "required")}
    <div class="form-grid form-grid--city">
      ${fld("cidade", "Cidade", 'autocomplete="address-level2" required')}
      ${fld("uf", "UF", 'maxlength="2" autocomplete="address-level1" required')}
    </div>`;

  async function lookupCEP(input) {
    const cep = digits(input.value);
    const form = input.form, status = $("#cep-status");
    if (cep.length !== 8 || form.dataset.cep === cep) return;
    form.dataset.cep = cep;
    status.textContent = "buscando…"; status.className = "cep-status";
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d.erro) throw new Error("not found");
      const set = (name, v) => { if (v) { form[name].value = v; setErr(form, name, ""); } };
      set("rua", d.logradouro); set("bairro", d.bairro); set("cidade", d.localidade); set("uf", d.uf);
      status.textContent = `${d.localidade}/${d.uf}`; status.className = "cep-status is-ok";
      setErr(form, "cep", "");
      (d.logradouro ? form.numero : form.rua).focus();
    } catch {
      status.textContent = ""; form.dataset.cep = "";
      setErr(form, "cep", "CEP não encontrado. Confira ou preencha o endereço à mão.");
    }
  }

  function signupFields(tipo) {
    if (tipo === "lojista") {
      return `<div class="form-grid">
        ${fld("cnpj", "CNPJ", 'inputmode="numeric" data-mask="cnpj" placeholder="00.000.000/0000-00" required')}
        ${fld("ie", 'Inscrição estadual <span class="opt">(opcional)</span>', 'inputmode="numeric"')}
        ${fld("razao", "Razão social", 'autocomplete="organization" required', "full")}
        ${fld("fantasia", 'Nome fantasia <span class="opt">(opcional)</span>', "", "full")}
        ${fld("responsavel", "Nome do responsável", 'autocomplete="name" required', "full")}
        ${fld("phone", "Telefone / WhatsApp", 'inputmode="tel" data-mask="phone" autocomplete="tel" placeholder="(33) 99999-9999" required')}
        ${fld("email", "E-mail", 'type="email" autocomplete="email" required')}
        ${addressFields()}
        ${pwField("password", "Senha", "new-password")}
        ${pwField("confirm", "Confirmar senha", "new-password")}
      </div>`;
    }
    return `<div class="form-grid">
      ${fld("name", "Nome completo", 'autocomplete="name" required', "full")}
      ${fld("cpf", "CPF", 'inputmode="numeric" data-mask="cpf" placeholder="000.000.000-00" required')}
      ${fld("birth", "Data de nascimento", 'type="date" autocomplete="bday" required')}
      ${fld("phone", "Telefone / WhatsApp", 'inputmode="tel" data-mask="phone" autocomplete="tel" placeholder="(33) 99999-9999" required')}
      ${fld("email", "E-mail", 'type="email" autocomplete="email" required')}
      ${addressFields()}
      ${pwField("password", "Senha", "new-password")}
      ${pwField("confirm", "Confirmar senha", "new-password")}
    </div>`;
  }

  function viewAuth() {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const tipo = params.get("tipo") === "lojista" ? "lojista" : "cliente";
    return `<div class="view auth">
      <div class="container">
        <nav class="crumbs crumbs--page" aria-label="Você está em"><a href="#/">Início</a>/<span>Minha conta</span>/<span>Login</span></nav>
        <div class="auth__grid">
          <form class="auth__card" id="login-form" novalidate>
            <h1>Iniciar sessão</h1>
            <p class="lead">Já tem cadastro? Entre com seu e-mail e senha.</p>
            ${fld("email", "E-mail", 'type="email" autocomplete="email" required')}
            ${pwField("password", "Senha", "current-password")}
            <a href="https://wa.me/${whatsapp}?text=${encodeURIComponent("Olá! Esqueci minha senha do site.")}" target="_blank" rel="noopener" class="auth__forgot">Esqueceu a senha?</a>
            <button class="btn btn--primary btn--block">Entrar</button>
            <ul class="auth__perks">
              <li>${icon("i-check")}Seus dados preenchidos no pedido</li>
              <li>${icon("i-check")}Histórico de pedidos enviados</li>
              <li>${icon("i-check")}Carrinho salvo na sua conta</li>
            </ul>
          </form>

          <form class="auth__card" id="signup-form" novalidate data-tipo="${tipo}">
            <h2>Criar uma conta</h2>
            <p class="lead">Como você quer se cadastrar?</p>
            <div class="types" role="radiogroup" aria-label="Tipo de cadastro">
              <button type="button" class="type ${tipo === "cliente" ? "is-active" : ""}" role="radio" aria-checked="${tipo === "cliente"}" data-tipo="cliente">
                <span class="type__ic">${icon("i-user")}</span><span><strong>Sou cliente</strong><small>Comprador pessoa física, com CPF</small></span>
              </button>
              <button type="button" class="type ${tipo === "lojista" ? "is-active" : ""}" role="radio" aria-checked="${tipo === "lojista"}" data-tipo="lojista">
                <span class="type__ic">${icon("i-store")}</span><span><strong>Sou lojista</strong><small>Assistência ou loja, com CNPJ</small></span>
              </button>
            </div>
            <div id="signup-fields">${signupFields(tipo)}</div>
            <button class="btn btn--primary btn--block" id="signup-submit">${tipo === "lojista" ? "Cadastrar minha loja" : "Criar minha conta"}</button>
          </form>
        </div>
      </div>
    </div>`;
  }

  const statusLabel = { NEW: "Novo", IN_PROGRESS: "Em andamento", DONE: "Concluído", CANCELED: "Cancelado" };
  const fmtDate = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  function myOrdersHTML() {
    const s = session();
    const orders = myOrders().filter((o) => o.owner === s?.email);
    if (!orders.length) return `<p class="muted">Você ainda não fez pedidos.</p>`;
    return `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Subtotal</th><th>Situação</th><th>Status</th></tr></thead><tbody>
      ${orders.map((o) => `<tr><td><a href="#/pedido/${o.code}" class="link-arrow">${o.code}</a></td><td>${fmtDate(o.createdAt)}</td><td>${o.items.reduce((n, it) => n + it.qty, 0)}</td><td>${money(o.total ?? o.subtotal)}</td>
        <td>${o.stage === "PENDING" ? `<button class="text-btn" data-complete="${esc(o.code)}">Completar e enviar</button>` : STAGE_LABEL[o.stage]}</td>
        <td><span class="status status--${o.status}">${statusLabel[o.status]}</span></td></tr>`).join("")}
    </tbody></table></div>`;
  }

  function viewAccount() {
    const s = session();
    if (!s) { location.hash = "#/login"; return ""; }
    if (s.role === "ADMIN") { location.hash = "#/admin"; return ""; }
    const data = s.type === "lojista"
      ? [["Razão social", s.razao], ["Nome fantasia", s.fantasia || "—"], ["CNPJ", s.cnpj], ["Responsável", s.responsavel], ["Telefone", s.phone], ["E-mail", s.email]]
      : [["Nome", s.name], ["CPF", s.cpf], ["Nascimento", s.birth ? new Date(s.birth + "T12:00").toLocaleDateString("pt-BR") : "—"], ["Telefone", s.phone], ["E-mail", s.email]];
    data.push(["Endereço", s.address ? fmtAddress(s.address) : "Não cadastrado"]);
    refreshMyOrders(() => { const el = $("#my-orders"); if (el) el.innerHTML = myOrdersHTML(); });
    return `<div class="view container">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<span>Minha conta</span></nav>
      <div class="page-head"><h1>Olá, ${esc(displayName(s).split(" ")[0])}</h1><p class="muted">${s.type === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : '<span class="tag">Cliente</span>'}</p></div>
      <div class="panel">
        <div class="box"><h2>Meus dados</h2>
          <div class="table-wrap"><table><tbody>${data.map(([k, v]) => `<tr><th style="width:180px">${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>
        </div>
        <div class="box"><h2>Meus pedidos</h2><div id="my-orders">${myOrdersHTML()}</div></div>
        <div><button class="btn btn--ghost" data-logout>Sair</button></div>
      </div>
    </div>`;
  }

  // ---------- admin ----------
  let editingId = null;
  let pendingImage = null;

  function productForm() {
    const p = editingId ? prodBy(editingId) : null;
    const img = pendingImage ?? p?.image ?? null;
    return `<form class="box" id="product-form" novalidate>
      <div class="box__head"><h2>${p ? "Editar produto" : "Cadastrar produto"}</h2>${p ? `<button type="button" class="text-btn" data-cancel-edit>Cancelar edição</button>` : ""}</div>
      <div class="pform">
        <label class="drop" id="drop">
          ${img ? `<img src="${img}" alt="Foto do produto"><span class="drop__change">Trocar foto</span>` : `<span>${icon("i-image")}<strong>Adicionar foto</strong><br>toque ou arraste aqui</span>`}
          <input type="file" name="photo" accept="image/*" aria-label="Foto do produto">
        </label>
        <div>
          <div class="form-grid">
            ${fld("name", "Nome do produto", `required value="${esc(p?.name || "")}" placeholder="Ex.: Tela iPhone 12 OLED"`)}
            ${fld("code", "Código do produto", `required data-mask="code" value="${esc(p?.code || "")}" placeholder="Ex.: FB1265X" autocapitalize="characters"`)}
            <p class="code-preview full" id="code-preview">${p ? `Aparece no site como: <strong>${esc(fullName(p))}</strong>` : "Aparece no site como: <strong>Nome - CÓDIGO</strong>"}</p>
            <label class="field"><span>Preço consumidor</span><span class="money-input"><span>R$</span><input name="price" inputmode="decimal" required placeholder="0,00" value="${p ? p.price.toFixed(2).replace(".", ",") : ""}"></span><span class="err"></span></label>
            <label class="field"><span>Preço lojista</span><span class="money-input"><span>R$</span><input name="priceLoj" inputmode="decimal" required placeholder="0,00" value="${p ? p.priceLoj.toFixed(2).replace(".", ",") : ""}"></span><span class="err"></span></label>
            <label class="field"><span>Preço de custo <span class="opt">(só o admin vê)</span></span><span class="money-input"><span>R$</span><input name="cost" inputmode="decimal" placeholder="0,00" value="${p?.cost != null ? p.cost.toFixed(2).replace(".", ",") : ""}"></span><span class="err"></span></label>
            <label class="field"><span>Quantidade em estoque</span><input name="stock" type="number" min="0" step="1" inputmode="numeric" required value="${p ? p.stock : ""}"><span class="err"></span></label>
            <label class="field"><span>Categoria</span><select name="cat">${categories.map((c) => `<option value="${c.slug}" ${(p?.cat || "telas") === c.slug ? "selected" : ""}>${c.name}</option>`).join("")}</select></label>
            <label class="field"><span>Marca do aparelho</span><select name="brand"><option value="">Nenhuma / universal</option>${Object.keys(brands).map((b) => `<option ${p?.brand === b ? "selected" : ""}>${b}</option>`).join("")}</select></label>
            <label class="field full"><span>Modelos compatíveis <span class="opt">(opcional, separados por vírgula)</span></span><input name="models" value="${esc(p?.models.join(", ") || "")}" placeholder="Ex.: iPhone 12, iPhone 12 Pro"></label>
          </div>
          <div class="pform__actions">
            <button class="btn btn--primary">${icon(p ? "i-check" : "i-plus")}${p ? "Salvar alterações" : "Cadastrar produto"}</button>
          </div>
        </div>
      </div>
    </form>`;
  }

  function adminProducts() {
    const list = [...products].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return `${productForm()}
      <div class="box"><div class="box__head"><h2>Produtos (${products.length})</h2></div>
        <input type="search" class="admin-search" id="admin-search" placeholder="Buscar por nome ou código" aria-label="Buscar produto por nome ou código">
        <div class="table-wrap"><table><thead><tr><th></th><th>Produto</th><th>Código</th><th>Consumidor</th><th>Lojista</th><th>Estoque</th><th></th></tr></thead><tbody id="admin-products">
          ${list.map((p) => `<tr data-search="${esc(`${p.name} ${p.code}`.toLowerCase())}">
            <td><span class="thumb-sm">${p.image ? `<img class="thumb-sm" src="${p.image}" alt="">` : icon(catBy(p.cat).icon)}</span></td>
            <td><a href="#/produto/${p.slug}" style="font-weight:600">${esc(p.name)}</a><br><small class="muted">${catBy(p.cat).name} · ${esc(p.brand || "Universal")}</small></td>
            <td><code class="code">${esc(p.code)}</code></td>
            <td>${money(p.promo ?? p.price)}</td><td>${money(p.priceLoj)}</td><td>${stockHTML(p)}</td>
            <td><div class="tbl-actions"><button data-edit="${p.id}" aria-label="Editar ${esc(p.name)}">${icon("i-edit")}</button><button class="danger" data-del="${p.id}" aria-label="Excluir ${esc(p.name)}">${icon("i-trash")}</button></div></td>
          </tr>`).join("")}
        </tbody></table></div>
      </div>`;
  }

  // ---------- admin: pedidos em tempo (quase) real + notificações ----------
  let adminOrdersList = null;   // null = ainda carregando
  let adminVer;
  let adminError = "";
  let pollTimer = null;
  let ordersFilter = "todos";
  const POLL_MS = 15000;

  function notifyPermissionHTML() {
    if (!("Notification" in window)) return `<p class="notice">Este navegador não mostra notificações do sistema. Os avisos aparecem dentro do painel.</p>`;
    if (Notification.permission === "granted") return `<p class="notice notice--ok">${icon("i-bell")}Notificações ativas. Deixe esta aba aberta para ser avisado de pedidos novos.</p>`;
    if (Notification.permission === "denied") return `<p class="notice notice--warn">${icon("i-bell")}Notificações bloqueadas. Libere em “Configurações do site” (cadeado ao lado do endereço) para receber avisos.</p>`;
    return `<div class="notice notice--cta">${icon("i-bell")}<span>Ative as notificações para ser avisado de cada pedido novo, mesmo com o navegador em outra janela.</span><button class="btn btn--primary" data-enable-notify>Ativar notificações</button></div>`;
  }

  function adminOrdersBody() {
    if (adminError) return `<div class="empty">${esc(adminError)}</div>`;
    if (!adminOrdersList) return `<div class="empty">Carregando pedidos…</div>`;
    const filters = { todos: () => true, novos: (o) => o.status === "NEW", atendimento: (o) => o.status === "IN_PROGRESS", concluidos: (o) => o.status === "DONE" || o.status === "CANCELED" };
    const list = adminOrdersList.filter(filters[ordersFilter] || filters.todos);
    return `<div class="pills" role="group" aria-label="Filtrar pedidos">
        ${[["todos", "Todos"], ["novos", "Novos"], ["atendimento", "Em andamento"], ["concluidos", "Concluídos"]].map(([k, v]) =>
          `<button class="pill ${ordersFilter === k ? "is-active" : ""}" data-orders-filter="${k}">${v} <span class="pill__n">${adminOrdersList.filter(filters[k]).length}</span></button>`).join("")}
      </div>
      ${!list.length ? `<div class="empty">Nenhum pedido aqui.</div>`
        : ordersView === "lista" ? `<div class="olist">${list.map(orderRowHTML).join("")}</div>`
        : `<div class="tickets">${list.map((o) => receiptHTML(o, { admin: true })).join("")}</div>`}`;
  }

  // modo lista: linha compacta (pedido, cliente, valor) que abre o cupom completo
  let ordersView = store.get("ts_orders_view", "cupom");
  const expandedOrders = new Set();
  function orderRowHTML(o) {
    const c = o.customer, open = expandedOrders.has(o.code);
    const who = c.type === "lojista" ? (o.checkout?.name || c.razao) : (o.checkout?.name || c.name);
    const toggle = `data-order-toggle="${esc(o.code)}" aria-expanded="${open}" aria-controls="od-${esc(o.code)}"`;
    return `<div class="orow ${open ? "is-open" : ""} ${o.status === "NEW" ? "orow--new" : ""}">
      <div class="orow__head">
        <button class="orow__main" ${toggle}>
          <span class="orow__code">${esc(o.code)}</span>
          <span class="orow__who"><b>${esc(who)}</b>${c.type === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : ""}<small>${fmtDate(o.createdAt)}</small></span>
        </button>
        <select class="status status--${o.status} orow__status" data-status="${esc(o.code)}" aria-label="Status do pedido ${esc(o.code)}">${Object.entries(statusLabel).map(([s, v]) => `<option value="${s}" ${o.status === s ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="orow__end" ${toggle} aria-label="${open ? "Fechar" : "Abrir"} detalhes do pedido ${esc(o.code)}">
          <span class="orow__total">${money(o.total ?? o.subtotal)}</span>
          <span class="orow__chev">${icon("i-down")}</span>
        </button>
      </div>
      ${open ? `<div class="orow__body" id="od-${esc(o.code)}">${receiptHTML(o, { admin: true })}</div>` : ""}
    </div>`;
  }

  function adminOrders() {
    return `<div class="box">
      <div class="box__head"><h2>Pedidos recebidos</h2>
        <div class="box__tools">
          <span class="muted live-dot">Atualiza a cada 15 s</span>
          <div class="view-toggle" role="group" aria-label="Ver pedidos como">
            <button class="${ordersView === "cupom" ? "is-active" : ""}" data-orders-view="cupom" aria-pressed="${ordersView === "cupom"}">${icon("i-receipt")}Cupom</button>
            <button class="${ordersView === "lista" ? "is-active" : ""}" data-orders-view="lista" aria-pressed="${ordersView === "lista"}">${icon("i-list")}Lista</button>
          </div>
        </div>
      </div>
      <div id="notify-permission">${notifyPermissionHTML()}</div>
      <div id="admin-orders-body">${adminOrdersBody()}</div>
    </div>`;
  }

  function rerenderAdminOrders() {
    const el = $("#admin-orders-body");
    if (el) el.innerHTML = adminOrdersBody();
    const ordersN = $("#tab-orders-n");
    if (ordersN && adminOrdersList) ordersN.textContent = adminOrdersList.filter((o) => o.status === "NEW").length || "";
    const kpi = $("#kpi-new");
    if (kpi && adminOrdersList) kpi.textContent = adminOrdersList.filter((o) => o.status === "NEW").length;
    const n = adminOrdersList ? adminOrdersList.filter((o) => o.status === "NEW").length : 0;
    document.title = (n ? `(${n}) ` : "") + document.title.replace(/^\(\d+\)\s/, "");
  }

  // som curto de aviso (dois bipes)
  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.22].forEach((t) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
      });
    } catch { /* sem áudio */ }
  }

  // aviso grande no canto inferior direito (na página) + notificação do sistema (Windows/macOS)
  function notifyOrder(o, kind) {
    const who = o.customer.type === "lojista" ? o.customer.razao : o.customer.name;
    const qty = o.items.reduce((n, it) => n + it.qty, 0);
    const title = kind === "new" ? `Novo pedido ${o.code}` : `Pedido ${o.code} confirmado`;
    const body = kind === "new"
      ? `${who} · ${qty} ${qty === 1 ? "item" : "itens"} · ${money(o.total ?? o.subtotal)}${o.cupom ? ` (cupom ${o.cupom.code})` : ""}`
      : `${who} · ${PAYMENT_LABEL[o.checkout?.payment] || ""} · ${o.checkout?.delivery === "entrega" ? "Entrega" : "Retirada na loja"}`;

    showNotify({ label: kind === "new" ? "Pedido novo" : "Cliente confirmou", title, body, href: "#/admin?aba=pedidos", cta: "Ver pedido", tag: `${o.code}-${kind}` });
  }

  function notifyAlert(a, waiting) {
    showNotify({
      label: "Avise-me", variant: "alert",
      title: `Querem: ${a.product.name}${a.product.code ? ` - ${a.product.code}` : ""}`,
      body: `${a.name || "Cliente"} quer aviso por ${a.channels.map((c) => (c === "email" ? "e-mail" : "WhatsApp")).join(" e ")} · ${waiting} ${waiting === 1 ? "pessoa aguardando" : "pessoas aguardando"}`,
      href: "#/admin?aba=avise-me", cta: "Ver avisos", tag: `alert-${a.id}`,
    });
  }

  function showNotify({ label, title, body, href, cta, tag, variant = "" }) {
    const card = document.createElement("div");
    card.className = `notify ${variant ? `notify--${variant}` : ""}`;
    card.innerHTML = `<div class="notify__ic">${icon("i-bell")}</div>
      <div class="notify__body"><small>${esc(label)} · agora</small><strong>${esc(title)}</strong><span>${esc(body)}</span>
        <div class="notify__actions"><a class="btn btn--primary" href="${href}" data-notify-close>${cta}</a><button class="btn btn--ghost" data-notify-close>Fechar</button></div></div>`;
    $("#notify-stack").prepend(card);
    [...$("#notify-stack").children].slice(4).forEach((n) => n.remove());
    beep();

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, icon: "assets/logo.png", tag, requireInteraction: true });
        n.onclick = () => { window.focus(); location.hash = href; n.close(); };
      } catch { /* alguns navegadores só notificam via service worker */ }
    }
  }

  async function pollOrders() {
    const s = session();
    if (s?.role !== "ADMIN") return stopPolling();
    try {
      const data = await ordersApi.adminList(adminVer);
      adminError = "";
      if (data.changed !== false) {
        const seen = new Set(store.get("ts_seen_orders", []));
        const firstRun = !store.get("ts_seen_init", false);
        const fresh = [];
        data.orders.forEach((o) => {
          const key = `${o.code}:${o.stage}`;
          if (!seen.has(key)) { seen.add(key); if (!firstRun) fresh.push(o); }
        });
        store.set("ts_seen_orders", [...seen].slice(-500));
        store.set("ts_seen_init", true);
        fresh.slice(0, 4).reverse().forEach((o) => notifyOrder(o, o.stage === "CONFIRMED" ? "confirmed" : "new"));
        adminOrdersList = data.orders;
        adminVer = data.ver;
        rerenderAdminOrders();
        await pollAlerts();
      }
    } catch (err) {
      if (err.status === 401) {
        // sessão do admin venceu (12 h) ou é inválida: sai e pede login de novo
        store.set("ts_session", null); store.set("ts_admin_token", null); stopPolling();
        toast("Sua sessão de admin expirou. Entre de novo.");
        location.hash = "#/login";
        return;
      }
      adminError = `Não foi possível carregar os pedidos (${err.message}).`;
      if (!adminOrdersList) rerenderAdminOrders();
    }
  }
  function startPolling() {
    if (pollTimer) return;
    pollOrders();
    pollTimer = setInterval(pollOrders, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer); pollTimer = null;
    adminOrdersList = null; adminVer = undefined;
  }

  // ---------- admin: Avise-me ----------
  let adminAlerts = null;
  async function pollAlerts() {
    try {
      const { alerts } = await alertsApi.list();
      const seen = new Set(store.get("ts_seen_alerts", []));
      const firstRun = !store.get("ts_seen_alerts_init", false);
      const fresh = alerts.filter((a) => a.status === "PENDING" && !seen.has(a.id));
      alerts.forEach((a) => seen.add(a.id));
      store.set("ts_seen_alerts", [...seen].slice(-1000));
      store.set("ts_seen_alerts_init", true);
      adminAlerts = alerts;
      if (!firstRun) fresh.slice(0, 3).forEach((a) => notifyAlert(a, pendingAlerts(a.product.id).length));
      rerenderAlerts();
    } catch { /* tenta de novo no próximo ciclo */ }
  }
  const pendingAlerts = (productId) => (adminAlerts || []).filter((a) => a.status === "PENDING" && (!productId || a.product.id === productId));

  function rerenderAlerts() {
    const el = $("#admin-alerts-body");
    if (el) el.innerHTML = adminAlertsBody();
    const n = pendingAlerts().length;
    const k = $("#kpi-alerts");
    if (k) k.textContent = n;
    const tab = $("#tab-alerts-n");
    if (tab) tab.textContent = n || "";
  }

  const restockMessage = (a) => `Olá${a.name ? `, ${a.name.split(" ")[0]}` : ""}! Aqui é da Top Smart. O produto que você pediu para ser avisado voltou ao estoque: ${a.product.name}${a.product.code ? ` - ${a.product.code}` : ""}. ${location.origin}${location.pathname}#/produto/${a.product.id}`;

  function adminAlertsBody() {
    if (!adminAlerts) return `<div class="empty">Carregando avisos…</div>`;
    if (!adminAlerts.length) return `<div class="empty">Ninguém pediu aviso ainda. Quando um produto esgota, o botão “Avise-me” aparece para os clientes.</div>`;
    const groups = {};
    adminAlerts.forEach((a) => (groups[a.product.id] ||= []).push(a));
    return Object.entries(groups)
      .sort(([, a], [, b]) => b.filter((x) => x.status === "PENDING").length - a.filter((x) => x.status === "PENDING").length)
      .map(([pid, list]) => {
        const p = prodBy(pid);
        const pend = list.filter((a) => a.status === "PENDING").length;
        const first = list[0].product;
        return `<section class="alert-group">
          <header class="alert-group__head">
            <span class="thumb-sm">${p?.image ? `<img class="thumb-sm" src="${p.image}" alt="">` : icon(p ? catBy(p.cat).icon : "i-bell")}</span>
            <div class="alert-group__title"><strong>${esc(first.name)}${first.code ? ` - ${esc(first.code)}` : ""}</strong>
              ${p ? (p.stock > 0 ? `<span class="stock">Em estoque: ${p.stock}</span>` : `<span class="stock stock--out">Esgotado</span>`) : `<span class="muted">Produto removido</span>`}</div>
            <span class="alert-count ${pend ? "" : "is-zero"}">${pend} aguardando</span>
            ${p ? `<button class="btn btn--ghost btn--sm" data-edit="${p.id}" data-edit-tab>Repor estoque</button>` : ""}
          </header>
          <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>Avisar por</th><th>Pediu em</th><th>Situação</th><th></th></tr></thead><tbody>
            ${list.map((a) => `<tr>
              <td><b>${esc(a.name || "—")}</b>${a.customerType === "lojista" ? ' <span class="tag tag--pro">Lojista</span>' : ""}<br><small class="muted">${esc([a.email, a.phone].filter(Boolean).join(" · "))}</small></td>
              <td><div class="tbl-actions">
                ${a.channels.includes("whatsapp") ? `<a class="chan chan--wa" target="_blank" rel="noopener" href="https://wa.me/55${digits(a.phone)}?text=${encodeURIComponent(restockMessage(a))}">${icon("i-wa")}WhatsApp</a>` : ""}
                ${a.channels.includes("email") ? `<a class="chan" href="mailto:${esc(a.email)}?subject=${encodeURIComponent(`${a.product.name} voltou ao estoque - Top Smart`)}&body=${encodeURIComponent(restockMessage(a))}">${icon("i-mail")}E-mail</a>` : ""}
              </div></td>
              <td>${fmtDate(a.createdAt)}</td>
              <td>${a.status === "PENDING" ? `<span class="status status--IN_PROGRESS">Aguardando</span>` : `<span class="status status--DONE">Avisado</span>`}</td>
              <td><div class="tbl-actions">
                <button data-alert-status="${a.id}" data-to="${a.status === "PENDING" ? "NOTIFIED" : "PENDING"}" title="${a.status === "PENDING" ? "Marcar como avisado" : "Voltar para aguardando"}" aria-label="${a.status === "PENDING" ? "Marcar como avisado" : "Voltar para aguardando"}">${icon(a.status === "PENDING" ? "i-check" : "i-bell")}</button>
                <button class="danger" data-alert-del="${a.id}" title="Remover" aria-label="Remover aviso">${icon("i-trash")}</button>
              </div></td>
            </tr>`).join("")}
          </tbody></table></div>
        </section>`;
      }).join("");
  }

  function adminAlertsTab() {
    return `<div class="box">
      <div class="box__head"><h2>Avise-me</h2><span class="muted">Clientes esperando produtos esgotados</span></div>
      <p class="notice">Quando repor o estoque, toque em WhatsApp ou E-mail para mandar o aviso já escrito e depois marque como avisado.</p>
      <div id="admin-alerts-body">${adminAlertsBody()}</div>
    </div>`;
  }

  function adminUsers() {
    const list = store.get("ts_users", []);
    return `<div class="box"><h2>Cadastros feitos no site <span class="muted">(${list.length})</span></h2>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Nome / Razão social</th><th>CPF / CNPJ</th><th>Telefone</th><th>E-mail</th></tr></thead><tbody>
        ${list.map((u) => `<tr><td>${u.type === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : '<span class="tag">Cliente</span>'}</td>
          <td>${esc(u.type === "lojista" ? u.razao : u.name)}</td><td>${esc(u.cnpj || u.cpf)}</td><td>${esc(u.phone)}</td><td>${esc(u.email)}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Ninguém se cadastrou ainda.</p>`}
    </div>`;
  }

  function viewAdmin() {
    const s = session();
    if (!s || s.role !== "ADMIN") {
      return `<div class="view container"><div class="page-head"><h1>Painel</h1></div>
        <div class="empty">Área restrita ao administrador.<br><a class="btn btn--primary" href="#/login" style="margin-top:16px">Entrar</a></div></div>`;
    }
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    // telas do ponto de venda, caixa e relatórios vêm do pdv.js
    const ext = window.TS_EXT?.tabs || {};
    const tab = params.get("aba") || (ext.inicio ? "inicio" : "produtos");
    const config = () => `<div class="box"><h2>Configurações</h2>
      <label class="field" style="max-width:320px"><span>WhatsApp que recebe os pedidos</span><input value="${whatsapp}" disabled></label>
      <p class="notice">Na versão final esse número é editável aqui e fica salvo no banco.</p></div>`;
    const body = { produtos: adminProducts, pedidos: adminOrders, "avise-me": adminAlertsTab, cadastros: adminUsers, config, ...ext }[tab] || adminProducts;
    const groups = [
      ["Vendas", [["inicio", "Início", "i-home"], ["balcao", "Venda balcão", "i-store"], ["pedidos", "Pedidos do site", "i-bag"], ["avise-me", "Avise-me", "i-bell"], ["cupons", "Cupons", "i-tag"]]],
      ["Financeiro", [["caixa", "Caixa", "i-cash"], ["entrada", "Entrada de estoque", "i-download"], ["relatorios", "Relatórios", "i-chart"]]],
      ["Cadastros", [["produtos", "Produtos", "i-tag"], ["clientes", "Clientes", "i-user"], ["fornecedores", "Fornecedores", "i-truck"], ["equipe", "Lojas e vendedores", "i-users"]]],
      ["Sistema", [["config", "Configurações", "i-gear"]]],
    ];
    const badge = (k) => k === "avise-me" ? `<span class="side__n" id="tab-alerts-n">${pendingAlerts().length || ""}</span>`
      : k === "pedidos" ? `<span class="side__n" id="tab-orders-n">${adminOrdersList?.filter((o) => o.status === "NEW").length || ""}</span>` : "";
    return `<div class="view admin">
      <nav class="side" aria-label="Painel">
        <div class="side__who"><strong>${esc(s.name)}</strong><button class="text-btn" data-logout>Sair</button></div>
        ${groups.map(([g, items]) => `<div class="side__group"><span class="side__label">${g}</span>
          ${items.filter(([k]) => k in ext || !["inicio", "balcao", "caixa", "relatorios", "equipe", "clientes", "fornecedores", "entrada", "cupons"].includes(k)).map(([k, v, ic]) =>
            `<a class="side__link ${tab === k ? "is-active" : ""}" href="#/admin?aba=${k}" ${tab === k ? 'aria-current="page"' : ""}>${icon(ic)}<span>${v}</span>${badge(k)}</a>`).join("")}
        </div>`).join("")}
      </nav>
      <div class="admin__main" id="admin-main">${body()}</div>
    </div>`;
  }

  // reduz a foto para caber no localStorage
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) return reject(new Error("Arquivo não é imagem"));
      const img = new Image();
      img.onload = () => {
        const max = 700;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => reject(new Error("Não foi possível ler a imagem"));
      img.src = URL.createObjectURL(file);
    });
  }
  async function handlePhoto(file) {
    try {
      pendingImage = await readImage(file);
      const drop = $("#drop");
      drop.querySelector("img, span:not(.drop__change)")?.remove();
      drop.querySelector(".drop__change")?.remove();
      drop.insertAdjacentHTML("afterbegin", `<img src="${pendingImage}" alt="Foto do produto"><span class="drop__change">Trocar foto</span>`);
    } catch (err) { toast(err.message); }
  }

  const viewNotFound = () => `<div class="view container"><div class="empty" style="margin:48px 0">Página não encontrada.<br><a class="btn btn--primary" href="#/" style="margin-top:16px">Voltar ao início</a></div></div>`;

  // ---------- roteador ----------
  function router() {
    const [path] = location.hash.replace(/^#/, "").split("?");
    const parts = path.split("/").filter(Boolean);
    closeDrawer();
    document.querySelectorAll("dialog[open]").forEach((dlg) => dlg.close());
    document.body.classList.toggle("is-admin", parts[0] === "admin" && session()?.role === "ADMIN");
    clearInterval(sliderTimer);
    let html;
    switch (parts[0]) {
      case undefined: html = viewHome(); break;
      case "catalogo": html = viewCatalog(); break;
      case "categoria": html = categories.some((c) => c.slug === parts[1]) ? viewCatalog(parts[1]) : viewNotFound(); break;
      case "produto": html = viewProduct(parts[1]); break;
      case "carrinho": renderCart(); html = null; break;
      case "pedido": html = viewSuccess(parts[1]); break;
      case "login": case "cadastro": html = viewAuth(); break;
      case "conta": html = viewAccount(); break;
      case "admin": html = viewAdmin(); break;
      default: html = viewNotFound();
    }
    if (html !== null) main.innerHTML = html;
    if (!parts[0]) initSlider();
    if (session()?.role === "ADMIN") startPolling();
    const sp = new URLSearchParams(location.hash.split("?")[1] || "");
    $("#search-input").value = sp.get("q") || "";
    renderHeader();
    syncCartUI();
    const titles = { catalogo: "Catálogo", categoria: categories.find((c) => c.slug === parts[1])?.name, produto: (() => { const p = products.find((x) => x.slug === parts[1]); return p && fullName(p); })(), carrinho: "Carrinho", login: "Entrar ou cadastrar", cadastro: "Entrar ou cadastrar", conta: "Minha conta", admin: "Painel" };
    document.title = titles[parts[0]] ? `${titles[parts[0]]} | Top Smart` : "Top Smart | Peças e Componentes";
  }

  function setFilter(key, value) {
    const [path, qs] = location.hash.split("?");
    const params = new URLSearchParams(qs || "");
    if (value === "" || value === false) params.delete(key); else params.set(key, value === true ? "1" : value);
    if (key === "brand") params.delete("model");
    const base = path && path !== "#/" ? path : "#/catalogo";
    location.hash = `${base}${params.toString() ? "?" + params : ""}`;
  }

  // volta para a página de onde a pessoa veio (ex.: o produto que queria ver o preço)
  function returnTo() {
    const v = new URLSearchParams(location.hash.split("?")[1] || "").get("volta");
    return v && v.startsWith("#/") && !v.startsWith("#/login") ? v : "#/catalogo";
  }

  // ---------- validação de formulários ----------
  function setErr(form, name, msg) {
    const inp = form.querySelector(`[name=${name}]`);
    if (!inp) return;
    inp.classList.toggle("is-invalid", !!msg);
    const err = inp.closest(".field").querySelector(".err");
    if (err) err.textContent = msg || "";
  }
  function validate(form, rules) {
    let ok = true, first = null;
    for (const [name, check] of Object.entries(rules)) {
      const inp = form.querySelector(`[name=${name}]`);
      if (!inp) continue;
      const msg = check(inp.value.trim(), inp);
      setErr(form, name, msg);
      if (msg) { ok = false; first ||= inp; }
    }
    first?.focus();
    return ok;
  }
  const req = (msg = "Campo obrigatório") => (v) => (v ? "" : msg);
  const emailRule = (v) => !v ? "Campo obrigatório" : /^\S+@\S+\.\S+$/.test(v) ? "" : "E-mail inválido";
  const phoneRule = (v) => !v ? "Campo obrigatório" : digits(v).length >= 10 ? "" : "Telefone incompleto";

  // ---------- eventos ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    // fecha o mega menu depois de escolher um link, mesmo com o mouse ainda em cima
    if (t.closest(".nav")) { const nav = $(".nav"); nav.classList.add("is-closing"); nav.addEventListener("mouseleave", () => nav.classList.remove("is-closing"), { once: true }); }
    if (d.add) addToCart(d.add);
    else if (d.qty) { const l = cart.find((x) => lineKey(x.id, x.variant) === d.qty); if (l) setQty(d.qty, l.qty + +d.d); }
    else if (d.remove) setQty(d.remove, 0);
    else if ("send" in d) startCheckout();
    else if ("cupomRemove" in d) { cupom = null; store.set("ts_cupom", null); syncCartUI(); }
    else if ("clearCart" in d) { cart = []; saveCart(); toast("Carrinho limpo"); router(); }
    else if (d.filter && t.tagName === "BUTTON") setFilter(d.filter, d.value);
    else if ("clear" in d) location.hash = location.hash.split("?")[0];
    else if (d.view) { catalogView = d.view; store.set("ts_view", d.view); router(); }
    else if ("toggleFilters" in d) $("#filters").classList.toggle("is-open");
    else if (d.variant) {
      t.parentElement.querySelectorAll(".variant").forEach((b) => { b.classList.toggle("is-active", b === t); b.setAttribute("aria-checked", b === t); });
      const p = products.find((x) => x.slug === location.hash.split("/")[2]);
      if ($("#pd-price")) $("#pd-price").textContent = money(itemPrice(p, d.variant));
    }
    else if (d.pdq) { const q = $("#pd-qty"); q.textContent = Math.max(1, +q.textContent + +d.pdq); }
    else if (d.pdAdd) {
      const v = $(".variant.is-active")?.dataset.variant || null;
      addToCart(d.pdAdd, v, +$("#pd-qty").textContent);
      openDrawer();
    }
    else if ("pw" in d) {
      const inp = t.previousElementSibling;
      inp.type = inp.type === "password" ? "text" : "password";
      t.setAttribute("aria-label", inp.type === "password" ? "Mostrar senha" : "Ocultar senha");
    }
    else if (d.tipo && t.classList.contains("type")) {
      const form = $("#signup-form");
      form.dataset.tipo = d.tipo;
      form.querySelectorAll(".type").forEach((b) => { b.classList.toggle("is-active", b === t); b.setAttribute("aria-checked", b === t); });
      $("#signup-fields").innerHTML = signupFields(d.tipo);
      $("#signup-submit").innerHTML = d.tipo === "lojista" ? "Cadastrar minha loja" : "Criar minha conta";
      $("#signup-fields input").focus();
    }
    else if (d.edit) {
      editingId = d.edit; pendingImage = null;
      const goForm = () => $("#product-form")?.scrollIntoView({ behavior: "smooth" });
      if ("editTab" in d) { location.hash = "#/admin?aba=produtos"; setTimeout(goForm, 60); }
      else { router(); goForm(); }
    }
    else if (d.alert) openAlert(d.alert);
    else if (d.alertStatus) {
      alertsApi.setStatus(d.alertStatus, d.to).then(() => {
        const a = adminAlerts?.find((x) => x.id === d.alertStatus);
        if (a) a.status = d.to;
        rerenderAlerts();
        toast(d.to === "NOTIFIED" ? "Marcado como avisado" : "Voltou para aguardando");
      }).catch((err) => toast(err.message));
    }
    else if (d.alertDel) {
      if (!confirm("Remover este pedido de aviso? Essa ação não pode ser desfeita.")) return;
      alertsApi.remove(d.alertDel).then(() => {
        adminAlerts = adminAlerts?.filter((x) => x.id !== d.alertDel);
        rerenderAlerts();
        toast("Aviso removido");
      }).catch((err) => toast(err.message));
    }
    else if ("cancelEdit" in d) { editingId = null; pendingImage = null; router(); }
    else if (d.del) {
      const p = prodBy(d.del);
      if (p && confirm(`Excluir "${fullName(p)}"? Essa ação não pode ser desfeita.`)) {
        products = products.filter((x) => x.id !== d.del);
        cart = cart.filter((l) => l.id !== d.del);
        saveProducts(); saveCart();
        if (editingId === d.del) editingId = null;
        toast("Produto excluído");
        router();
      }
    }
    else if ("soon" in d) { e.preventDefault(); toast("Página institucional: conteúdo a definir com o cliente"); }
    else if ("logout" in d) { store.set("ts_session", null); store.set("ts_admin_token", null); stopPolling(); toast("Você saiu da conta"); location.hash = "#/"; }
    else if (d.ordersFilter) { ordersFilter = d.ordersFilter; rerenderAdminOrders(); }
    else if (d.ordersView) {
      ordersView = d.ordersView; store.set("ts_orders_view", ordersView);
      document.querySelectorAll("[data-orders-view]").forEach((b) => { b.classList.toggle("is-active", b === t); b.setAttribute("aria-pressed", b === t); });
      rerenderAdminOrders();
    }
    else if (d.orderToggle) {
      expandedOrders.has(d.orderToggle) ? expandedOrders.delete(d.orderToggle) : expandedOrders.add(d.orderToggle);
      rerenderAdminOrders();
    }
    else if ("enableNotify" in d) {
      Notification.requestPermission().then((p) => {
        $("#notify-permission").innerHTML = notifyPermissionHTML();
        if (p === "granted") new Notification("Notificações ativas", { body: "Você será avisado de cada pedido novo da Top Smart.", icon: "assets/logo.png" });
      });
    }
    else if ("notifyClose" in d) t.closest(".notify")?.remove();
    else if (d.print) {
      const rc = document.getElementById(`rc-${d.print}`);
      rc.classList.add("is-printing"); document.body.classList.add("printing");
      window.print();
      rc.classList.remove("is-printing"); document.body.classList.remove("printing");
    }
    else if (d.complete) { const o = myOrders().find((x) => x.code === d.complete); if (o) openCheckout(o); }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.status) {
      const code = t.dataset.status, status = t.value;
      t.className = `status status--${status}`;
      ordersApi.setStatus(code, status).then((r) => {
        const o = adminOrdersList?.find((x) => x.code === code);
        if (o) o.status = status;
        if (r.ver) adminVer = r.ver;
        rerenderAdminOrders();
        toast(`Pedido ${code}: ${statusLabel[status]}`);
      }).catch((err) => { toast(err.message); pollOrders(); });
    } else if (t.name === "photo") {
      handlePhoto(t.files[0]);
    } else if (t.dataset.filter) {
      setFilter(t.dataset.filter, t.type === "checkbox" ? t.checked : t.value);
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    const m = t.dataset.mask || (t.name === "phone" ? "phone" : null);
    if (m) t.value = masks[m](t.value);
    if (t.name === "cep" && t.form?.id === "signup-form") lookupCEP(t);
    if (t.form?.id === "product-form" && (t.name === "name" || t.name === "code")) {
      const f = t.form;
      const preview = fullName({ name: f.name.value.trim() || "Nome", code: f.code.value.trim() || "CÓDIGO" });
      $("#code-preview").innerHTML = `Aparece no site como: <strong>${esc(preview)}</strong>`;
    }
    if (t.id === "admin-search") {
      const q = t.value.trim().toLowerCase();
      document.querySelectorAll("#admin-products tr").forEach((tr) => (tr.hidden = !!q && !tr.dataset.search.includes(q)));
    }
  });

  // arrastar foto para o cadastro de produto
  ["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => {
    const drop = e.target.closest?.("#drop");
    if (drop) { e.preventDefault(); drop.classList.add("is-over"); }
  }));
  ["dragleave", "drop"].forEach((ev) => document.addEventListener(ev, (e) => {
    const drop = e.target.closest?.("#drop");
    if (!drop) return;
    e.preventDefault(); drop.classList.remove("is-over");
    if (ev === "drop" && e.dataTransfer.files[0]) handlePhoto(e.dataTransfer.files[0]);
  }));

  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (form.dataset.cupomForm !== undefined) { e.preventDefault(); return aplicarCupom(form.cupom.value); }
    if (form.id === "search-form") {
      e.preventDefault();
      const q = $("#search-input").value.trim();
      location.hash = q ? `#/catalogo?q=${encodeURIComponent(q)}` : "#/catalogo";
      return;
    }
    if (form.id === "news-form") {
      e.preventDefault();
      if (digits(form.phone.value).length < 10) return toast("Informe um WhatsApp válido");
      form.reset(); toast("Pronto! Você vai receber nossas ofertas.");
      return;
    }
    if (form.id === "login-form") {
      e.preventDefault();
      if (!validate(form, { email: emailRule, password: req() })) return;
      const email = form.email.value.trim().toLowerCase();
      const u = users().find((x) => x.email.toLowerCase() === email && x.password === form.password.value);
      if (u) { login(u); location.hash = returnTo(); return; }
      // não é cliente deste aparelho: tenta o login do admin, que é conferido no servidor
      if (!REMOTE) return setErr(form, "password", "E-mail ou senha incorretos");
      const btn = form.querySelector("button.btn--primary");
      btn.disabled = true;
      try {
        const r = await fetch("/api/admin-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: form.password.value }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return setErr(form, "password", r.status === 401 ? "E-mail ou senha incorretos" : data.error || "Não foi possível entrar");
        store.set("ts_admin_token", { token: data.token, exp: data.exp });
        login({ type: "admin", name: data.name, email, role: "ADMIN" });
        location.hash = "#/admin?aba=pedidos";
      } finally { btn.disabled = false; }
      return;
    }
    if (form.id === "signup-form") {
      e.preventDefault();
      const tipo = form.dataset.tipo;
      const pw = form.password.value;
      const common = {
        phone: phoneRule, email: (v) => emailRule(v) || (users().some((u) => u.email.toLowerCase() === v.toLowerCase()) ? "E-mail já cadastrado" : ""),
        cep: (v) => !v ? "Campo obrigatório" : digits(v).length === 8 ? "" : "CEP incompleto",
        numero: req(), rua: req(), bairro: req(), cidade: req(),
        uf: (v) => /^[A-Za-z]{2}$/.test(v) ? "" : "UF com 2 letras",
        password: (v) => !v ? "Campo obrigatório" : v.length < 6 ? "Mínimo de 6 caracteres" : "",
        confirm: (v) => v === pw ? "" : "As senhas não conferem",
      };
      const rules = tipo === "lojista"
        ? { cnpj: (v) => !v ? "Campo obrigatório" : validCNPJ(v) ? (users().some((u) => u.cnpj === v) ? "CNPJ já cadastrado" : "") : "CNPJ inválido", razao: req(), responsavel: req(), ...common }
        : {
          name: (v) => !v ? "Campo obrigatório" : v.split(/\s+/).length < 2 ? "Informe nome e sobrenome" : "",
          cpf: (v) => !v ? "Campo obrigatório" : validCPF(v) ? (users().some((u) => u.cpf === v) ? "CPF já cadastrado" : "") : "CPF inválido",
          birth: (v) => {
            if (!v) return "Campo obrigatório";
            const age = (Date.now() - new Date(v + "T12:00")) / 31557600000;
            return age < 0 || age > 120 ? "Data inválida" : age < 16 ? "Cadastro a partir de 16 anos" : "";
          },
          ...common,
        };
      if (!validate(form, rules)) return;
      const data = Object.fromEntries(new FormData(form));
      delete data.confirm;
      const address = { cep: data.cep, rua: data.rua.trim(), numero: data.numero.trim(), complemento: data.complemento.trim(), bairro: data.bairro.trim(), cidade: data.cidade.trim(), uf: data.uf.trim().toUpperCase() };
      ["cep", "rua", "numero", "complemento", "bairro", "cidade", "uf"].forEach((k) => delete data[k]);
      data.address = address;
      // Esboço: senha em texto puro no navegador. Na versão final: bcrypt no servidor.
      const u = { ...data, type: tipo, role: "CUSTOMER", email: data.email.trim(), createdAt: Date.now() };
      store.set("ts_users", [...store.get("ts_users", []), u]);
      login(u);
      toast(tipo === "lojista" ? "Loja cadastrada!" : "Conta criada!");
      location.hash = returnTo();
      return;
    }
    if (form.id === "product-form") {
      e.preventDefault();
      const parseMoney = (v) => parseFloat(v.replace(/\./g, "").replace(",", "."));
      const moneyRule = (v) => !v ? "Campo obrigatório" : parseMoney(v) > 0 ? "" : "Preço inválido";
      const existing = editingId ? prodBy(editingId) : null;
      const ok = validate(form, {
        name: req(),
        code: (v) => !v ? "Campo obrigatório"
          : products.some((p) => p.code === v.toUpperCase() && p !== existing) ? "Código já usado em outro produto" : "",
        price: moneyRule,
        priceLoj: moneyRule,
        stock: (v) => v === "" ? "Campo obrigatório" : Number.isInteger(+v) && +v >= 0 ? "" : "Use um número inteiro",
      });
      if (!pendingImage && !existing?.image) { toast("Adicione uma foto do produto"); return; }
      if (!ok) return;
      const name = form.name.value.trim();
      const fields = {
        name, code: form.code.value.trim().toUpperCase(),
        stock: parseInt(form.stock.value, 10),
        price: Math.round(parseMoney(form.price.value) * 100) / 100,
        priceLoj: Math.round(parseMoney(form.priceLoj.value) * 100) / 100,
        cost: form.cost.value.trim() ? Math.max(0, Math.round(parseMoney(form.cost.value) * 100) / 100) : 0,
        cat: form.cat.value, brand: form.brand.value,
        models: form.models.value.split(",").map((m) => m.trim()).filter(Boolean),
        image: pendingImage || existing?.image,
      };
      const restocked = existing && existing.stock <= 0 && fields.stock > 0;
      if (existing) {
        Object.assign(existing, fields, { promo: existing.promo && existing.promo < fields.price ? existing.promo : null });
      } else {
        const base = slugify(`${name} ${fields.code}`) || "produto";
        let slug = base, n = 2;
        while (products.some((p) => p.slug === slug)) slug = `${base}-${n++}`;
        products.unshift({ id: slug, slug, ...fields, promo: null, featured: false, isNew: true, variants: null, createdAt: Date.now() });
      }
      if (!saveProducts()) { toast("Sem espaço no navegador para salvar a foto. Use uma imagem menor."); return; }
      editingId = null; pendingImage = null;
      const waiting = restocked ? pendingAlerts(existing.id).length : 0;
      if (waiting) {
        // repôs um produto que tinha gente esperando: leva direto para a aba de avisos
        toast(`${waiting} ${waiting === 1 ? "pessoa pediu" : "pessoas pediram"} aviso deste produto. Avise agora!`);
        location.hash = "#/admin?aba=avise-me";
      } else {
        toast(existing ? "Produto atualizado" : "Produto cadastrado");
        router();
      }
    }
  });

  $("#cart-open").addEventListener("click", openDrawer);
  $("#cartbar").addEventListener("click", openDrawer);
  $("#cart-close").addEventListener("click", closeDrawer);
  $("#overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("is-open")) closeDrawer(); });

  window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });

  // funções compartilhadas com o pdv.js (ponto de venda, caixa e relatórios)
  window.TS = {
    $, money, esc, icon, digits, masks, store, toast, session, adminAuth, fmtDate, fullName, catBy, media, prodBy, users,
    fetchJSON, router, saveProducts, adminUsersHTML: () => adminUsers(), PAYMENT_LABEL, whatsapp, validate, setErr, req, phoneRule,
    get products() { return products; },
    get newOrders() { return adminOrdersList ? adminOrdersList.filter((o) => o.status === "NEW").length : null; },
    get pendingAlerts() { return adminAlerts ? pendingAlerts().length : null; },
  };

  renderNav();
  router();
})();
