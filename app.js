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
    products = window.STORE.products.map((p) => ({ ...p, image: null }));
    store.set("ts_products", products);
    store.set("ts_seed_v", SEED_VERSION);
  } else {
    products = store.get("ts_products", []);
  }
  // Todo produto tem código e dois preços: consumidor (price) e lojista (priceLoj).
  const CODE_PREFIX = { telas: "TL", peliculas: "PL", capinhas: "CP", baterias: "BT", carregadores: "CR", acessorios: "AC", pecas: "PC" };
  products.forEach((p, i) => {
    p.code ||= (CODE_PREFIX[p.cat] || "TS") + (digits(p.sku) || 3000 + i);
    p.priceLoj ??= Math.round(p.price * 0.8 * 10) / 10;
  });
  const saveProducts = () => store.set("ts_products", products);
  saveProducts();
  const catBy = (slug) => categories.find((c) => c.slug === slug) || categories[categories.length - 1];
  const prodBy = (id) => products.find((p) => p.id === id);
  const isLojista = () => session()?.type === "lojista";
  // Lojista logado vê o preço de lojista; os demais veem o preço de consumidor (com promoção, se houver).
  const basePrice = (p) => isLojista() ? (p.priceLoj ?? p.price) : (p.promo ?? p.price);
  const fullName = (p) => p.code ? `${p.name} - ${p.code}` : p.name;
  const media = (p) => p.image ? `<img src="${p.image}" alt="${esc(p.name)}" loading="lazy">` : icon(catBy(p.cat).icon);

  // ---------- contas ----------
  // Usuário administrador já criado. Na versão final: senha com bcrypt no banco, nunca no código.
  const ADMIN = { type: "admin", name: "Administrador Top Smart", email: "admin@topsmart.com", phone: "(33) 99941-4255", password: "topsmart2026", role: "ADMIN" };
  const users = () => [ADMIN, ...store.get("ts_users", [])];
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
        <div class="citem__line">
          <div class="qty qty--sm">
            <button data-qty="${esc(k)}" data-d="-1" aria-label="Diminuir">${icon("i-minus")}</button>
            <span>${l.qty}</span>
            <button data-qty="${esc(k)}" data-d="1" aria-label="Aumentar">${icon("i-plus")}</button>
          </div>
          <strong>${money(l.sub)}</strong>
          <button class="citem__remove" data-remove="${esc(k)}" aria-label="Remover">${icon("i-trash")}</button>
        </div>
      </div>
    </div>`;
  }

  function syncCartUI() {
    const count = cartCount(), total = cartTotal();
    const badge = $("#cart-count");
    badge.textContent = count; badge.hidden = !count;
    const route = location.hash.split("?")[0];
    const hideBar = ["#/carrinho", "#/login", "#/cadastro", "#/admin"].includes(route) || route.startsWith("#/pedido");
    $("#cartbar").hidden = !count || hideBar;
    $("#cartbar-count").textContent = count;
    $("#cartbar-total").textContent = money(total);

    const lines = cartLines();
    $("#drawer-body").innerHTML = lines.length
      ? lines.map(cartItemHTML).join("")
      : `<div class="empty" style="margin-top:24px">Seu carrinho está vazio.<br><a class="link-arrow" href="#/catalogo" style="margin-top:12px">Ver catálogo ${icon("i-arrow")}</a></div>`;
    $("#drawer-foot").innerHTML = lines.length ? `
      <div class="total-line"><span>Total</span><strong>${money(total)}</strong></div>
      <button class="btn btn--wa btn--block" data-send>${icon("i-wa")}Enviar pedido pelo WhatsApp</button>
      <a class="btn btn--ghost btn--block" href="#/carrinho">Ver carrinho completo</a>` : "";

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

  // ---------- pedido / WhatsApp ----------
  function buildMessage(order) {
    const items = order.items.map((it, i) =>
      `${i + 1}) ${it.name}${it.variant ? " – " + it.variant : ""}\n   ${it.qty} x ${money(it.unit)} = ${money(it.sub)}`).join("\n");
    const c = order.customer;
    const who = c.type === "lojista"
      ? `Lojista: ${c.razao}\nCNPJ: ${c.cnpj}\nContato: ${c.name}\nTabela de preço: lojista`
      : `Cliente: ${c.name}${c.cpf ? `\nCPF: ${c.cpf}` : ""}`;
    return `Olá, Top Smart! Quero fazer este pedido:\n\nPedido: ${order.code}\n${who}\nTelefone: ${c.phone}\n\n${items}\n\nTotal: ${money(order.total)}` +
      (c.note ? `\n\nObservação: ${c.note}` : "");
  }
  function startCheckout() {
    if (!cart.length) return;
    closeDrawer();
    const modal = $("#checkout-modal"), form = $("#checkout-form");
    const s = session();
    form.reset();
    if (s) { form.name.value = s.type === "lojista" ? s.responsavel : s.name; form.phone.value = s.phone || ""; }
    modal.showModal();
  }
  $("#checkout-modal").addEventListener("close", () => {
    if ($("#checkout-modal").returnValue !== "ok") return;
    const f = $("#checkout-form");
    const s = session();
    // Na versão final: Server Action revalida preço/estoque, gera o código e grava o snapshot no banco.
    const orders = store.get("ts_orders", []);
    const code = `TS-${new Date().getFullYear()}-${String(orders.length + 1).padStart(6, "0")}`;
    const lines = cartLines();
    const order = {
      code,
      createdAt: new Date().toISOString(),
      status: "NEW",
      userEmail: s?.email || null,
      customer: {
        type: s?.type === "lojista" ? "lojista" : "cliente",
        name: f.name.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim(),
        cpf: s?.cpf, cnpj: s?.cnpj, razao: s?.razao,
      },
      items: lines.map((l) => ({ name: fullName(l.p), variant: l.variant, qty: l.qty, unit: l.unit, sub: l.sub })),
      total: cartTotal(),
    };
    orders.unshift(order);
    store.set("ts_orders", orders);
    window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(buildMessage(order))}`, "_blank", "noopener");
    location.hash = `#/pedido/${code}`;
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
    if (isLojista()) return `<span class="price"><small class="price__tag">Lojista</small>${money(basePrice(p))}</span>`;
    return p.promo ? `<span class="price"><s>${money(p.price)}</s>${money(p.promo)}</span>` : `<span class="price">${money(p.price)}</span>`;
  };
  function stockHTML(p) {
    if (p.stock <= 0) return `<span class="stock stock--out">Esgotado</span>`;
    if (p.stock <= 3) return `<span class="stock stock--low">Últimas ${p.stock}</span>`;
    return `<span class="stock">${p.stock} em estoque</span>`;
  }
  const addBtn = (p) => `<button class="add-btn" data-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""} aria-label="Adicionar ${esc(fullName(p))} ao carrinho">${icon("i-plus")}</button>`;

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
                    <div class="stack__card"><span class="row__thumb">${icon("c-telas")}</span><div><small>Telas</small><strong>Tela iPhone 11 Incell</strong></div><span class="price">${money(189)}</span></div>
                    <div class="stack__card"><span class="row__thumb">${icon("c-baterias")}</span><div><small>Baterias</small><strong>Bateria Galaxy A14</strong></div><span class="price">${money(89)}</span></div>
                    <div class="stack__card"><span class="row__thumb">${icon("c-pecas")}</span><div><small>Componentes</small><strong>Conector de carga</strong></div><span class="price">${money(35)}</span></div>
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
                    <div class="badge-price"><small>a partir de</small><strong>${money(minTela)}</strong></div>
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
      relevance: (a, b) => (b.stock > 0) - (a.stock > 0) || b.featured - a.featured,
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
          <div><h3>Preço (R$)</h3><div class="price-range">
            <input type="number" min="0" placeholder="Mín." value="${esc(f.min)}" data-filter="min" aria-label="Preço mínimo">
            <input type="number" min="0" placeholder="Máx." value="${esc(f.max)}" data-filter="max" aria-label="Preço máximo"></div></div>
          <label class="check"><input type="checkbox" data-filter="stock" ${f.stock ? "checked" : ""}> Só com estoque</label>
          <button class="text-btn" data-clear style="align-self:flex-start">Limpar filtros</button>
        </aside>
        <div>
          <div class="toolbar">
            <button class="btn btn--ghost filters__mobile" style="height:38px;padding:0 14px;font-size:14px" data-toggle-filters>Filtros</button>
            <select data-filter="sort" aria-label="Ordenar">
              <option value="relevance" ${f.sort === "relevance" ? "selected" : ""}>Relevância</option>
              <option value="low" ${f.sort === "low" ? "selected" : ""}>Menor preço</option>
              <option value="high" ${f.sort === "high" ? "selected" : ""}>Maior preço</option>
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
          <div class="product__price" id="pd-price">${money(basePrice(p))}</div>
          ${isLojista()
            ? `<div class="price-note"><span class="tag tag--pro">Preço lojista</span> Consumidor: ${money(p.promo ?? p.price)}</div>`
            : `${p.promo ? `<div class="muted"><s>${money(p.price)}</s> preço normal</div>` : ""}
               ${session() ? "" : `<a class="price-note link-arrow" href="#/login?tipo=lojista">É lojista? Entre para ver o preço de lojista ${icon("i-arrow")}</a>`}`}
          <div class="product__sku">Código ${esc(p.code)}</div>
          ${p.variants ? `<div class="opt-label">${p.cat === "telas" ? "Qualidade" : "Opção"}</div>
            <div class="variants" role="radiogroup">${p.variants.map(([n, d], i) => `
              <button class="variant ${i === 0 ? "is-active" : ""}" role="radio" aria-checked="${i === 0}" data-variant="${esc(n)}">${esc(n)}<small>${money(basePrice(p) + d)}</small></button>`).join("")}</div>` : ""}
          <div class="buy">
            <div class="qty" aria-label="Quantidade">
              <button data-pdq="-1" aria-label="Diminuir">${icon("i-minus")}</button><span id="pd-qty">1</span><button data-pdq="1" aria-label="Aumentar">${icon("i-plus")}</button>
            </div>
            <button class="btn btn--primary" style="flex:1" data-pd-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""}>${icon("i-bag")}${p.stock <= 0 ? "Esgotado" : "Adicionar ao carrinho"}</button>
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
          ${lines.map((l) => `<div class="total-line" style="font-size:14px"><span>${l.qty}x ${esc(fullName(l.p))}</span><span>${money(l.sub)}</span></div>`).join("")}
          <hr style="border:0;border-top:1px solid var(--border);width:100%">
          <div class="total-line"><span>Total</span><strong>${money(cartTotal())}</strong></div>
          <button class="btn btn--wa btn--block" data-send>${icon("i-wa")}Enviar pedido pelo WhatsApp</button>
          <p class="note">Sem pagamento online. A loja confirma disponibilidade e forma de pagamento pelo WhatsApp.</p>
          <button class="text-btn" data-clear-cart>Limpar carrinho</button>
        </aside>
      </div>` : `<div class="empty">Seu carrinho está vazio.<br><a class="btn btn--primary" href="#/catalogo" style="margin-top:16px">Ver catálogo</a></div>`}
    </div>`;
  }

  function viewSuccess(code) {
    const order = store.get("ts_orders", []).find((o) => o.code === code);
    if (!order) return viewNotFound();
    return `<div class="view container success">
      <div class="success__icon">${icon("i-check")}</div>
      <h1>Pedido enviado!</h1>
      <p class="muted">O WhatsApp abriu com o resumo abaixo. É só tocar em enviar na conversa.</p>
      <span class="code">${esc(order.code)}</span>
      <div class="msg-preview">${esc(buildMessage(order))}</div>
      <div class="slide__ctas" style="justify-content:center">
        <a class="btn btn--wa" target="_blank" rel="noopener" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(buildMessage(order))}">${icon("i-wa")}Abrir WhatsApp de novo</a>
        ${cart.length ? `<button class="btn btn--ghost" data-clear-cart>Limpar carrinho</button>` : `<a class="btn btn--ghost" href="#/catalogo">Continuar comprando</a>`}
      </div>
    </div>`;
  }

  // ---------- login + cadastro (cliente ou lojista) ----------
  const pwField = (name, label, auto) => `<label class="field">${label}<span class="pw"><input name="${name}" type="password" autocomplete="${auto}" required><button type="button" data-pw aria-label="Mostrar senha">${icon("i-eye")}</button></span><span class="err"></span></label>`;
  const fld = (name, label, attrs = "", cls = "") => `<label class="field ${cls}"><span>${label}</span><input name="${name}" ${attrs}><span class="err"></span></label>`;

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

  const statusLabel = { NEW: "Novo", IN_PROGRESS: "Em atendimento", DONE: "Concluído", CANCELED: "Cancelado" };
  const fmtDate = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  function viewAccount() {
    const s = session();
    if (!s) { location.hash = "#/login"; return ""; }
    if (s.role === "ADMIN") { location.hash = "#/admin"; return ""; }
    const orders = store.get("ts_orders", []).filter((o) => o.userEmail === s.email);
    const data = s.type === "lojista"
      ? [["Razão social", s.razao], ["Nome fantasia", s.fantasia || "—"], ["CNPJ", s.cnpj], ["Responsável", s.responsavel], ["Telefone", s.phone], ["E-mail", s.email]]
      : [["Nome", s.name], ["CPF", s.cpf], ["Nascimento", s.birth ? new Date(s.birth + "T12:00").toLocaleDateString("pt-BR") : "—"], ["Telefone", s.phone], ["E-mail", s.email]];
    return `<div class="view container">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<span>Minha conta</span></nav>
      <div class="page-head"><h1>Olá, ${esc(displayName(s).split(" ")[0])}</h1><p class="muted">${s.type === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : '<span class="tag">Cliente</span>'}</p></div>
      <div class="panel">
        <div class="box"><h2>Meus dados</h2>
          <div class="table-wrap"><table><tbody>${data.map(([k, v]) => `<tr><th style="width:180px">${k}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>
        </div>
        <div class="box"><h2>Meus pedidos</h2>
          ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th></tr></thead><tbody>
            ${orders.map((o) => `<tr><td><a href="#/pedido/${o.code}" class="link-arrow">${o.code}</a></td><td>${fmtDate(o.createdAt)}</td><td>${o.items.length}</td><td>${money(o.total)}</td><td><span class="status status--${o.status}">${statusLabel[o.status]}</span></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Você ainda não enviou pedidos.</p>`}
        </div>
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

  function adminOrders() {
    const orders = store.get("ts_orders", []);
    return `<div class="box"><h2>Pedidos recebidos</h2>
      ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Tipo</th><th>Telefone</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${orders.map((o) => `<tr><td>${o.code}</td><td>${fmtDate(o.createdAt)}</td><td>${esc(o.customer.razao || o.customer.name)}</td>
          <td>${o.customer.type === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : '<span class="tag">Cliente</span>'}</td>
          <td>${esc(o.customer.phone)}</td><td>${money(o.total)}</td>
          <td><select class="status status--${o.status}" data-status="${o.code}" aria-label="Status do pedido ${o.code}">${Object.entries(statusLabel).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nenhum pedido ainda.</p>`}
    </div>`;
  }

  function adminUsers() {
    const list = store.get("ts_users", []);
    return `<div class="box"><h2>Cadastros (${list.length})</h2>
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
    const tab = params.get("aba") || "produtos";
    const orders = store.get("ts_orders", []);
    const tabs = { produtos: "Produtos", pedidos: "Pedidos", cadastros: "Cadastros", config: "Configurações" };
    const body = { produtos: adminProducts, pedidos: adminOrders, cadastros: adminUsers, config: () => `<div class="box"><h2>Configurações</h2>
      <label class="field" style="max-width:320px">WhatsApp que recebe os pedidos<input value="${whatsapp}" disabled></label>
      <p class="notice">Na versão final esse número é editável aqui e fica salvo no banco.</p></div>` }[tab] || adminProducts;
    return `<div class="view container">
      <div class="page-head"><h1>Painel</h1><p class="muted">Olá, ${esc(s.name)}.</p></div>
      <div class="panel">
        <div class="kpis">
          <div class="kpi"><span>Produtos</span><strong>${products.length}</strong></div>
          <div class="kpi"><span>Sem estoque</span><strong>${products.filter((p) => p.stock <= 0).length}</strong></div>
          <div class="kpi"><span>Pedidos novos</span><strong>${orders.filter((o) => o.status === "NEW").length}</strong></div>
          <div class="kpi"><span>Cadastros</span><strong>${store.get("ts_users", []).length}</strong></div>
        </div>
        <div class="admin-tabs" role="tablist">${Object.entries(tabs).map(([k, v]) => `<a class="pill" role="tab" aria-selected="${tab === k}" href="#/admin?aba=${k}">${v}</a>`).join("")}</div>
        ${body()}
        <div><button class="btn btn--ghost" data-logout>Sair</button></div>
      </div>
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
    else if ("clearCart" in d) { cart = []; saveCart(); toast("Carrinho limpo"); router(); }
    else if (d.filter && t.tagName === "BUTTON") setFilter(d.filter, d.value);
    else if ("clear" in d) location.hash = location.hash.split("?")[0];
    else if (d.view) { catalogView = d.view; store.set("ts_view", d.view); router(); }
    else if ("toggleFilters" in d) $("#filters").classList.toggle("is-open");
    else if (d.variant) {
      t.parentElement.querySelectorAll(".variant").forEach((b) => { b.classList.toggle("is-active", b === t); b.setAttribute("aria-checked", b === t); });
      const p = products.find((x) => x.slug === location.hash.split("/")[2]);
      $("#pd-price").textContent = money(itemPrice(p, d.variant));
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
    else if (d.edit) { editingId = d.edit; pendingImage = null; router(); $("#product-form").scrollIntoView({ behavior: "smooth" }); }
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
    else if ("logout" in d) { store.set("ts_session", null); toast("Você saiu da conta"); location.hash = "#/"; }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.status) {
      const orders = store.get("ts_orders", []);
      const o = orders.find((x) => x.code === t.dataset.status);
      o.status = t.value; store.set("ts_orders", orders);
      t.className = `status status--${t.value}`;
      toast(`Pedido ${o.code}: ${statusLabel[t.value]}`);
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

  document.addEventListener("submit", (e) => {
    const form = e.target;
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
      if (!u) return setErr(form, "password", "E-mail ou senha incorretos");
      login(u);
      location.hash = u.role === "ADMIN" ? "#/admin" : "#/catalogo";
      return;
    }
    if (form.id === "signup-form") {
      e.preventDefault();
      const tipo = form.dataset.tipo;
      const pw = form.password.value;
      const common = {
        phone: phoneRule, email: (v) => emailRule(v) || (users().some((u) => u.email.toLowerCase() === v.toLowerCase()) ? "E-mail já cadastrado" : ""),
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
      // Esboço: senha em texto puro no navegador. Na versão final: bcrypt no servidor.
      const u = { ...data, type: tipo, role: "CUSTOMER", email: data.email.trim(), createdAt: Date.now() };
      store.set("ts_users", [...store.get("ts_users", []), u]);
      login(u);
      toast(tipo === "lojista" ? "Loja cadastrada!" : "Conta criada!");
      location.hash = "#/catalogo";
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
        cat: form.cat.value, brand: form.brand.value,
        models: form.models.value.split(",").map((m) => m.trim()).filter(Boolean),
        image: pendingImage || existing?.image,
      };
      if (existing) {
        Object.assign(existing, fields, { promo: existing.promo && existing.promo < fields.price ? existing.promo : null });
      } else {
        const base = slugify(`${name} ${fields.code}`) || "produto";
        let slug = base, n = 2;
        while (products.some((p) => p.slug === slug)) slug = `${base}-${n++}`;
        products.unshift({ id: slug, slug, ...fields, promo: null, featured: false, isNew: true, variants: null, createdAt: Date.now() });
      }
      if (!saveProducts()) { toast("Sem espaço no navegador para salvar a foto. Use uma imagem menor."); return; }
      toast(existing ? "Produto atualizado" : "Produto cadastrado");
      editingId = null; pendingImage = null;
      router();
    }
  });

  $("#cart-open").addEventListener("click", openDrawer);
  $("#cartbar").addEventListener("click", openDrawer);
  $("#cart-close").addEventListener("click", closeDrawer);
  $("#overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("is-open")) closeDrawer(); });

  window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });
  renderNav();
  router();
})();
