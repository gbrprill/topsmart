// Esboço navegável do site Top Smart.
// Tudo roda no navegador: carrinho, login e pedidos ficam no localStorage.
// Na versão final isso vira Next.js + Prisma + Auth.js, conforme o briefing.
(() => {
  const { categories, brands, products, whatsapp } = window.STORE;
  const $ = (s, el = document) => el.querySelector(s);
  const main = $("#main");

  // ---------- utilidades ----------
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = (v) => brl.format(v).replace(/ /g, " ");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (id, cls = "i") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
  const catBy = (slug) => categories.find((c) => c.slug === slug);
  const prodBy = (id) => products.find((p) => p.id === id);
  const basePrice = (p) => p.promo ?? p.price;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const maskPhone = (v) => {
    const d = v.replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  };

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 2200);
  }

  // ---------- sessão ----------
  const ADMIN = { name: "Administrador", email: "admin@topsmart.com", phone: "", password: "admin123", role: "ADMIN" };
  const users = () => [ADMIN, ...store.get("ts_users", [])];
  const session = () => store.get("ts_session", null);
  function login(user) {
    store.set("ts_session", { name: user.name, email: user.email, phone: user.phone, role: user.role || "CUSTOMER" });
    const hour = new Date().getHours();
    const greet = hour < 12 ? "BOM DIA" : hour < 18 ? "BOA TARDE" : "BOA NOITE";
    const s = document.createElement("div");
    s.className = "splash";
    s.innerHTML = `<div><div class="splash__mark">${icon("i-check")}</div><small>${greet}</small><h2>Olá, ${esc(user.name.split(" ")[0])}!</h2><p class="muted">Abrindo seu catálogo…</p></div>`;
    document.body.append(s);
    setTimeout(() => s.remove(), 2500);
    renderHeader();
  }

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
  const cartCount = () => cart.reduce((s, l) => s + l.qty, 0);
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
    toast(`${p.name}${variant ? " – " + variant : ""} adicionado`);
  }
  function setQty(key, qty) {
    const line = cart.find((l) => lineKey(l.id, l.variant) === key);
    if (!line) return;
    const p = prodBy(line.id);
    if (qty <= 0) cart = cart.filter((l) => l !== line);
    else line.qty = Math.min(qty, p.stock);
    saveCart();
  }

  function cartItemHTML(l) {
    const k = lineKey(l.id, l.variant);
    return `<div class="citem">
      <div class="row__thumb">${icon(catBy(l.p.cat).icon)}</div>
      <div>
        <div class="citem__name">${esc(l.p.name)}</div>
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
    const showBar = count > 0 && !["#/carrinho", "#/login", "#/cadastro"].includes(route) && !route.startsWith("#/pedido");
    $("#cartbar").hidden = !showBar;
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

  // drawer
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
    return `Olá, Top Smart! Quero fazer este pedido:\n\nPedido: ${order.code}\nCliente: ${order.customer.name}\nTelefone: ${order.customer.phone}\n\n${items}\n\nTotal: ${money(order.total)}` +
      (order.customer.note ? `\n\nObservação: ${order.customer.note}` : "");
  }
  function startCheckout() {
    if (!cart.length) return;
    closeDrawer();
    const modal = $("#checkout-modal"), form = $("#checkout-form");
    const s = session();
    form.reset();
    if (s) { form.name.value = s.name; form.phone.value = s.phone || ""; }
    modal.showModal();
  }
  $("#checkout-modal").addEventListener("close", () => {
    const modal = $("#checkout-modal");
    if (modal.returnValue !== "ok") return;
    const f = $("#checkout-form");
    // Na versão final: Server Action revalida preço/estoque, gera o código e grava o snapshot no banco.
    const orders = store.get("ts_orders", []);
    const code = `TS-${new Date().getFullYear()}-${String(orders.length + 1).padStart(6, "0")}`;
    const lines = cartLines();
    const order = {
      code,
      createdAt: new Date().toISOString(),
      status: "NEW",
      userEmail: session()?.email || null,
      customer: { name: f.name.value.trim(), phone: f.phone.value.trim(), note: f.note.value.trim() },
      items: lines.map((l) => ({ name: l.p.name, variant: l.variant, qty: l.qty, unit: l.unit, sub: l.sub })),
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
    if (p.promo) return `<span class="card__tag card__tag--promo">Oferta</span>`;
    if (p.isNew) return `<span class="card__tag">Novo</span>`;
    return "";
  }
  const priceHTML = (p) => p.promo ? `<span class="price"><s>${money(p.price)}</s>${money(p.promo)}</span>` : `<span class="price">${money(p.price)}</span>`;
  function stockHTML(p) {
    if (p.stock <= 0) return `<span class="stock stock--out">Esgotado</span>`;
    if (p.stock <= 3) return `<span class="stock stock--low">Últimas ${p.stock}</span>`;
    return `<span class="stock">${p.stock} em estoque</span>`;
  }
  const addBtn = (p) => `<button class="add-btn" data-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""} aria-label="Adicionar ${esc(p.name)} ao carrinho">${icon("i-plus")}</button>`;

  const card = (p) => `<article class="card">
    <a href="#/produto/${p.slug}" class="card__media">${icon(catBy(p.cat).icon)}${tags(p)}</a>
    <div class="card__body">
      <span class="card__cat">${esc(catBy(p.cat).name)} · ${esc(p.brand)}</span>
      <a href="#/produto/${p.slug}" class="card__name">${esc(p.name)}</a>
      <div class="card__foot">${priceHTML(p)}${addBtn(p)}</div>
    </div>
  </article>`;

  const row = (p) => `<div class="row">
    <a href="#/produto/${p.slug}" class="row__thumb">${icon(catBy(p.cat).icon)}</a>
    <div>
      <a href="#/produto/${p.slug}" class="row__name">${esc(p.name)}</a>
      <div class="row__meta"><span>${esc(catBy(p.cat).name)}</span>${stockHTML(p)}${p.variants ? `<span>${p.variants.length} opções</span>` : ""}</div>
    </div>
    <div class="row__right">${priceHTML(p)}${addBtn(p)}</div>
  </div>`;

  // ---------- header ----------
  function renderHeader() {
    const route = location.hash.split("?")[0];
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const activeCat = route.startsWith("#/categoria/") ? route.split("/")[2] : params.get("cat");
    $("#header-cats").innerHTML =
      `<a href="#/catalogo" class="${route === "#/catalogo" && !activeCat ? "is-active" : ""}">Todos</a>` +
      categories.map((c) => `<a href="#/categoria/${c.slug}" class="${activeCat === c.slug ? "is-active" : ""}">${c.name}</a>`).join("");
    const s = session();
    $("#account-link").setAttribute("href", s ? (s.role === "ADMIN" ? "#/admin" : "#/conta") : "#/login");
    $("#account-link").setAttribute("aria-label", s ? `Conta de ${s.name}` : "Entrar");
  }

  // ---------- views ----------
  function viewHome() {
    const featured = products.filter((p) => p.featured).slice(0, 8);
    const news = products.filter((p) => p.isNew).slice(0, 4);
    return `<div class="view">
      <section class="hero">
        <div class="container hero__inner">
          <div>
            <span class="hero__eyebrow">Peças e componentes</span>
            <h1>Tudo para o seu celular, <span>pronto pra levar.</span></h1>
            <p>Telas, baterias, películas, capinhas e acessórios. Monte o pedido aqui e envie direto pro nosso WhatsApp.</p>
            <div class="hero__ctas">
              <a href="#/catalogo" class="btn btn--primary">Ver catálogo ${icon("i-arrow")}</a>
              <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="btn btn--ghost" style="color:#fff;border-color:#333">${icon("i-wa")}Falar com a loja</a>
            </div>
            <div class="hero__stats">
              <div><strong>${products.length}+</strong>produtos</div>
              <div><strong>${Object.keys(brands).length}</strong>marcas</div>
              <div><strong>Na hora</strong>retire na loja</div>
            </div>
          </div>
          <div class="hero__visual" aria-hidden="true">
            <div class="hero__glow"></div>
            <div class="hero__phone">
              <svg class="hero__circuit" viewBox="0 0 60 70" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                <path d="M8 66 30 30M20 66l22-36M32 66l22-36"/><circle cx="30" cy="26" r="5" fill="currentColor"/><circle cx="42" cy="26" r="5" fill="currentColor"/><circle cx="54" cy="26" r="5" fill="currentColor"/>
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section__head"><h2>Categorias</h2><a class="link-arrow" href="#/catalogo">Ver tudo ${icon("i-arrow")}</a></div>
          <div class="cats">${categories.map((c) => `
            <a class="cat" href="#/categoria/${c.slug}">
              <span class="cat__icon">${icon(c.icon)}</span>
              <div><strong>${c.name}</strong><br><span>${c.desc}</span></div>
            </a>`).join("")}
          </div>
        </div>
      </section>

      <section class="section section--surface">
        <div class="container">
          <div class="section__head"><h2>Destaques</h2><a class="link-arrow" href="#/catalogo">Catálogo completo ${icon("i-arrow")}</a></div>
          <div class="grid">${featured.map(card).join("")}</div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="section__head"><h2>Novidades</h2></div>
          <div class="grid">${news.map(card).join("")}</div>
        </div>
      </section>

      <section class="section section--surface">
        <div class="container">
          <div class="section__head"><h2>Como comprar</h2></div>
          <div class="steps">
            <div class="step"><h3>Escolha as peças</h3><p>Filtre por marca e modelo do aparelho e adicione ao carrinho.</p></div>
            <div class="step"><h3>Revise o carrinho</h3><p>Ajuste quantidades e veja o total na hora.</p></div>
            <div class="step"><h3>Envie pelo WhatsApp</h3><p>O pedido chega pronto pra loja. A gente confirma e separa pra você.</p></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <div class="wa-band">
            <div><h2>Não achou a peça?</h2><p>Fala com a gente no WhatsApp que a gente procura pra você.</p></div>
            <a href="https://wa.me/${whatsapp}" target="_blank" rel="noopener" class="btn btn--light">${icon("i-wa")}Chamar no WhatsApp</a>
          </div>
        </div>
      </section>
    </div>`;
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
      (!f.q || norm(`${p.name} ${p.brand} ${p.models.join(" ")} ${catBy(p.cat).name}`).includes(norm(f.q))) &&
      (!f.min || basePrice(p) >= +f.min) &&
      (!f.max || basePrice(p) <= +f.max) &&
      (!f.stock || p.stock > 0));
    const sorters = {
      relevance: (a, b) => (b.stock > 0) - (a.stock > 0) || b.featured - a.featured,
      low: (a, b) => basePrice(a) - basePrice(b),
      high: (a, b) => basePrice(b) - basePrice(a),
      new: (a, b) => b.isNew - a.isNew,
    };
    list = [...list].sort(sorters[f.sort] || sorters.relevance);

    const cat = catBy(f.cat);
    const title = cat ? cat.name : f.q ? `Resultados para “${esc(f.q)}”` : "Catálogo";
    const models = f.brand ? brands[f.brand] : Object.values(brands).flat();

    let results;
    if (!list.length) {
      results = `<div class="empty">Nenhum produto encontrado.<br>Tente outro filtro ou <a class="link-arrow" href="https://wa.me/${whatsapp}" target="_blank" rel="noopener">fale com a loja</a>.</div>`;
    } else if (catalogView === "grid") {
      results = `<div class="grid">${list.map(card).join("")}</div>`;
    } else {
      // Agrupado por marca do aparelho, como no catálogo de referência
      const groups = {};
      list.forEach((p) => (groups[p.brand] ||= []).push(p));
      results = Object.entries(groups).map(([b, ps]) => `
        <div class="group"><h2 class="group__title">${esc(b)} <span>(${ps.length})</span></h2>
          <div class="rows">${ps.map(row).join("")}</div></div>`).join("");
    }

    return `<div class="view container">
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
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<a href="#/categoria/${c.slug}">${c.name}</a>/<span>${esc(p.name)}</span></nav>
      <div class="product">
        <div class="gallery">
          <div class="gallery__main">${icon(c.icon)}</div>
          <div class="gallery__thumbs"><div></div><div></div><div></div><div></div></div>
        </div>
        <div class="product__info">
          <span class="card__cat">${c.name} · ${esc(p.brand)}</span>
          <h1>${esc(p.name)}</h1>
          ${stockHTML(p)}
          <div class="product__price" id="pd-price">${money(basePrice(p))}</div>
          ${p.promo ? `<div class="muted"><s>${money(p.price)}</s> preço normal</div>` : ""}
          <div class="product__sku">SKU ${p.sku}</div>
          ${p.variants ? `<div class="opt-label">${p.cat === "telas" ? "Qualidade" : "Opção"}</div>
            <div class="variants" role="radiogroup">${p.variants.map(([n, d], i) => `
              <button class="variant ${i === 0 ? "is-active" : ""}" role="radio" aria-checked="${i === 0}" data-variant="${esc(n)}">${esc(n)}<small>${money(basePrice(p) + d)}</small></button>`).join("")}</div>` : ""}
          <div class="buy">
            <div class="qty" aria-label="Quantidade">
              <button data-pdq="-1" aria-label="Diminuir">${icon("i-minus")}</button><span id="pd-qty">1</span><button data-pdq="1" aria-label="Aumentar">${icon("i-plus")}</button>
            </div>
            <button class="btn btn--primary" style="flex:1" data-pd-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""}>${icon("i-bag")}${p.stock <= 0 ? "Esgotado" : "Adicionar ao carrinho"}</button>
          </div>
          <div class="opt-label">Compatível com</div>
          <div class="compat">${p.models.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
          <p class="product__desc">Peça com garantia da loja. Dúvida sobre compatibilidade? Chame no WhatsApp antes de fechar o pedido.</p>
        </div>
      </div>
      ${related.length ? `<section style="padding-bottom:96px"><div class="section__head"><h2>Relacionados</h2></div><div class="grid">${related.map(card).join("")}</div></section>` : ""}
    </div>`;
  }

  function renderCart() {
    const lines = cartLines();
    main.innerHTML = `<div class="view container">
      <div class="page-head"><h1>Carrinho</h1><p class="muted">${cartCount()} ${cartCount() === 1 ? "item" : "itens"}</p></div>
      ${lines.length ? `<div class="cart-page">
        <div class="cart-list">${lines.map(cartItemHTML).join("")}</div>
        <aside class="summary">
          <h2>Resumo</h2>
          ${lines.map((l) => `<div class="total-line" style="font-size:14px"><span>${l.qty}x ${esc(l.p.name)}</span><span>${money(l.sub)}</span></div>`).join("")}
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
      <div class="hero__ctas" style="justify-content:center">
        <a class="btn btn--wa" target="_blank" rel="noopener" href="https://wa.me/${whatsapp}?text=${encodeURIComponent(buildMessage(order))}">${icon("i-wa")}Abrir WhatsApp de novo</a>
        ${cart.length ? `<button class="btn btn--ghost" data-clear-cart>Limpar carrinho</button>` : `<a class="btn btn--ghost" href="#/catalogo">Continuar comprando</a>`}
      </div>
    </div>`;
  }

  function viewLogin() {
    return `<div class="view auth"><form class="auth__card" id="login-form" novalidate>
      <div class="auth__logo"><img src="assets/logo.png" alt="Top Smart"></div>
      <h1>Entrar</h1><p class="lead">Acesse para salvar seu carrinho e ver seus pedidos.</p>
      <label class="field">E-mail<input name="email" type="email" autocomplete="email" required><span class="err"></span></label>
      <label class="field">Senha<span class="pw"><input name="password" type="password" autocomplete="current-password" required><button type="button" data-pw aria-label="Mostrar senha">${icon("i-eye")}</button></span><span class="err"></span></label>
      <button class="btn btn--primary btn--block">Entrar</button>
      <p class="auth__alt">Não tem conta? <a href="#/cadastro">Cadastre-se</a></p>
      <p class="auth__alt" style="font-size:12px">Demo admin: admin@topsmart.com / admin123</p>
    </form></div>`;
  }

  function viewSignup() {
    return `<div class="view auth"><form class="auth__card" id="signup-form" novalidate>
      <div class="auth__logo"><img src="assets/logo.png" alt="Top Smart"></div>
      <h1>Criar conta</h1><p class="lead">Leva menos de um minuto.</p>
      <label class="field">Nome<input name="name" autocomplete="name" required><span class="err"></span></label>
      <label class="field">E-mail<input name="email" type="email" autocomplete="email" required><span class="err"></span></label>
      <label class="field">WhatsApp<input name="phone" inputmode="tel" autocomplete="tel" placeholder="(33) 99999-9999" required><span class="err"></span></label>
      <label class="field">Senha<span class="pw"><input name="password" type="password" autocomplete="new-password" minlength="6" required><button type="button" data-pw aria-label="Mostrar senha">${icon("i-eye")}</button></span><span class="err"></span></label>
      <button class="btn btn--primary btn--block">Criar conta</button>
      <p class="auth__alt">Já tem conta? <a href="#/login">Entrar</a></p>
    </form></div>`;
  }

  const statusLabel = { NEW: "Novo", IN_PROGRESS: "Em atendimento", DONE: "Concluído", CANCELED: "Cancelado" };
  const fmtDate = (iso) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  function viewAccount() {
    const s = session();
    if (!s) { location.hash = "#/login"; return ""; }
    const orders = store.get("ts_orders", []).filter((o) => o.userEmail === s.email);
    return `<div class="view container">
      <div class="page-head"><h1>Olá, ${esc(s.name.split(" ")[0])}</h1><p class="muted">${esc(s.email)}</p></div>
      <div class="panel">
        <div class="box"><h2>Meus pedidos</h2>
          ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th></tr></thead><tbody>
            ${orders.map((o) => `<tr><td><a href="#/pedido/${o.code}" class="link-arrow">${o.code}</a></td><td>${fmtDate(o.createdAt)}</td><td>${o.items.length}</td><td>${money(o.total)}</td><td><span class="status status--${o.status}">${statusLabel[o.status]}</span></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Você ainda não enviou pedidos.</p>`}
        </div>
        <div><button class="btn btn--ghost" data-logout>Sair</button></div>
      </div>
    </div>`;
  }

  function viewAdmin() {
    const s = session();
    if (!s || s.role !== "ADMIN") {
      return `<div class="view container"><div class="page-head"><h1>Painel</h1></div>
        <div class="empty">Área restrita ao administrador.<br><a class="btn btn--primary" href="#/login" style="margin-top:16px">Entrar como admin</a></div></div>`;
    }
    const orders = store.get("ts_orders", []);
    return `<div class="view container">
      <div class="page-head"><h1>Painel</h1><p class="muted">Esboço do admin. Na versão final: CRUD de produtos, categorias, marcas/modelos e configurações.</p></div>
      <div class="panel">
        <div class="kpis">
          <div class="kpi"><span>Produtos ativos</span><strong>${products.length}</strong></div>
          <div class="kpi"><span>Sem estoque</span><strong>${products.filter((p) => p.stock <= 0).length}</strong></div>
          <div class="kpi"><span>Pedidos novos</span><strong>${orders.filter((o) => o.status === "NEW").length}</strong></div>
          <div class="kpi"><span>Total em pedidos</span><strong style="font-size:22px">${money(orders.reduce((t, o) => t + o.total, 0))}</strong></div>
        </div>
        <div class="admin-tabs">
          <span class="pill is-active">Pedidos</span><span class="pill">Produtos</span><span class="pill">Categorias</span><span class="pill">Aparelhos</span><span class="pill">Configurações</span>
        </div>
        <div class="box"><h2>Pedidos recebidos</h2>
          ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Telefone</th><th>Total</th><th>Status</th></tr></thead><tbody>
            ${orders.map((o) => `<tr><td>${o.code}</td><td>${fmtDate(o.createdAt)}</td><td>${esc(o.customer.name)}</td><td>${esc(o.customer.phone)}</td><td>${money(o.total)}</td>
              <td><select class="status status--${o.status}" data-status="${o.code}" aria-label="Status do pedido ${o.code}">${Object.entries(statusLabel).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="muted">Nenhum pedido ainda. Monte um carrinho e envie pelo WhatsApp para testar.</p>`}
        </div>
        <div class="box"><h2>Produtos</h2>
          <div class="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Marca</th><th>Preço</th><th>Estoque</th></tr></thead><tbody>
            ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${catBy(p.cat).name}</td><td>${p.brand}</td><td>${money(basePrice(p))}</td><td>${stockHTML(p)}</td></tr>`).join("")}
          </tbody></table></div>
        </div>
        <div class="box"><h2>Configurações</h2>
          <label class="field" style="max-width:320px">WhatsApp que recebe os pedidos<input value="${whatsapp}" disabled></label>
          <p class="notice">Na versão final esse número é editável aqui e fica salvo no banco.</p>
        </div>
        <div><button class="btn btn--ghost" data-logout>Sair</button></div>
      </div>
    </div>`;
  }

  const viewNotFound = () => `<div class="view container"><div class="empty" style="margin:48px 0">Página não encontrada.<br><a class="btn btn--primary" href="#/" style="margin-top:16px">Voltar ao início</a></div></div>`;

  // ---------- roteador ----------
  function router() {
    const [path] = location.hash.replace(/^#/, "").split("?");
    const parts = path.split("/").filter(Boolean);
    closeDrawer();
    let html;
    switch (parts[0]) {
      case undefined: html = viewHome(); break;
      case "catalogo": html = viewCatalog(); break;
      case "categoria": html = catBy(parts[1]) ? viewCatalog(parts[1]) : viewNotFound(); break;
      case "produto": html = viewProduct(parts[1]); break;
      case "carrinho": renderCart(); html = null; break;
      case "pedido": html = viewSuccess(parts[1]); break;
      case "login": html = viewLogin(); break;
      case "cadastro": html = viewSignup(); break;
      case "conta": html = viewAccount(); break;
      case "admin": html = viewAdmin(); break;
      default: html = viewNotFound();
    }
    if (html !== null) main.innerHTML = html;
    const sp = new URLSearchParams(location.hash.split("?")[1] || "");
    $("#search-input").value = sp.get("q") || "";
    renderHeader();
    syncCartUI();
    const titles = { catalogo: "Catálogo", categoria: catBy(parts[1])?.name, produto: products.find((p) => p.slug === parts[1])?.name, carrinho: "Carrinho", login: "Entrar", cadastro: "Criar conta", conta: "Minha conta", admin: "Painel" };
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

  // ---------- eventos ----------
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
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
    } else if (t.dataset.filter) {
      setFilter(t.dataset.filter, t.type === "checkbox" ? t.checked : t.value);
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.name === "phone") e.target.value = maskPhone(e.target.value);
  });

  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (form.id === "search-form") {
      e.preventDefault();
      const q = $("#search-input").value.trim();
      location.hash = q ? `#/catalogo?q=${encodeURIComponent(q)}` : "#/catalogo";
      return;
    }
    if (form.id !== "login-form" && form.id !== "signup-form") return;
    e.preventDefault();
    let ok = true;
    form.querySelectorAll("input").forEach((inp) => {
      const err = inp.closest(".field").querySelector(".err");
      let msg = "";
      if (!inp.value.trim()) msg = "Campo obrigatório";
      else if (inp.type === "email" && !/^\S+@\S+\.\S+$/.test(inp.value)) msg = "E-mail inválido";
      else if (inp.name === "password" && form.id === "signup-form" && inp.value.length < 6) msg = "Mínimo de 6 caracteres";
      else if (inp.name === "phone" && inp.value.replace(/\D/g, "").length < 10) msg = "Telefone incompleto";
      err.textContent = msg;
      if (msg) ok = false;
    });
    if (!ok) return;
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "login-form") {
      const u = users().find((x) => x.email.toLowerCase() === data.email.toLowerCase() && x.password === data.password);
      if (!u) { form.querySelector("[name=password]").closest(".field").querySelector(".err").textContent = "E-mail ou senha incorretos"; return; }
      login(u);
      location.hash = u.role === "ADMIN" ? "#/admin" : "#/catalogo";
    } else {
      if (users().some((x) => x.email.toLowerCase() === data.email.toLowerCase())) {
        form.querySelector("[name=email]").closest(".field").querySelector(".err").textContent = "E-mail já cadastrado";
        return;
      }
      // Esboço: senha em texto puro no navegador. Na versão final: bcrypt no servidor.
      const u = { name: data.name.trim(), email: data.email.trim(), phone: data.phone, password: data.password, role: "CUSTOMER" };
      store.set("ts_users", [...store.get("ts_users", []), u]);
      login(u);
      location.hash = "#/catalogo";
    }
  });

  $("#cart-open").addEventListener("click", openDrawer);
  $("#cartbar").addEventListener("click", openDrawer);
  $("#cart-close").addEventListener("click", closeDrawer);
  $("#overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("#drawer").classList.contains("is-open")) closeDrawer(); });

  window.addEventListener("hashchange", () => { router(); window.scrollTo(0, 0); });
  router();
})();
