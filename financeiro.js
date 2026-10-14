// Financeiro da Top Smart: estoque (posição, movimentações, ajuste), despesas e contas a pagar, e o dashboard.
// Carregado depois do pdv.js: usa window.TS_PDV (api do ponto de venda) e window.TS (funções do app.js).
(() => {
  const T = () => window.TS;
  const X = window.TS_PDV;
  if (!X || !window.TS_EXT) return;
  const { asyncView, skel, paint, stat, money, parseMoney, fmtMoneyInput, dia, hora, norm, iso } = X;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => T().esc(s);
  const icon = (id) => T().icon(id);
  const fin = (query, method = "GET", body) => T().fetchJSON(`/api/financeiro?${query}`, method, body, true);
  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const setParams = (aba, changes) => {
    const p = params();
    Object.entries(changes).forEach(([k, v]) => (v === null || v === "" ? p.delete(k) : p.set(k, v)));
    p.set("aba", aba);
    location.hash = `#/admin?${p}`;
  };
  const por = () => T().session()?.name;
  const hoje = () => iso(new Date());
  const diaLongo = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");
  const pct = (v, casas = 1) => `${(v || 0).toFixed(casas).replace(".", ",")}%`;
  const precisaServidor = () => !T().catalogoServidor
    ? `${T().avisoCatalogo()}<div class="empty">O estoque aparece aqui depois que o catálogo estiver no servidor.</div>` : "";

  // ---------- dica ao passar o mouse (ou focar) em barras e células ----------
  const tip = document.createElement("div");
  tip.className = "viz-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.append(tip);
  const showTip = (el, x, y) => {
    // data-tip guarda HTML já escapado duas vezes: o navegador desfaz uma ao ler o atributo
    tip.innerHTML = el.dataset.tip; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener("mousemove", (e) => { const el = e.target.closest("[data-tip]"); if (el && !tip.hidden) showTip(el, e.clientX, e.clientY); });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } });
  document.addEventListener("focusout", () => (tip.hidden = true));
  window.addEventListener("hashchange", () => (tip.hidden = true));

  // ======================================================================
  // ESTOQUE
  // ======================================================================
  let est = null;           // { produtos, movimentos }
  let ajustando = null;     // id do produto com o formulário de ajuste aberto
  const MOTIVO = { venda: "Venda", devolucao: "Devolução", troca: "Troca", cancelamento: "Venda cancelada", entrada: "Entrada de fornecedor", ajuste: "Ajuste", cadastro: "Cadastro" };
  const FILTROS_EST = { todos: "Todos", sem: "Sem estoque", min: "Abaixo do mínimo", parado: "Parados (60 dias)", neg: "Negativos" };
  const parado = (p) => p.stock > 0 && (!p.ultimaVenda || Date.parse(p.ultimaVenda) < Date.now() - 60 * 864e5) && (p.createdAt || 0) < Date.now() - 60 * 864e5;
  const filtroEst = { todos: () => true, sem: (p) => p.stock <= 0, min: (p) => p.min && p.stock > 0 && p.stock <= p.min, parado, neg: (p) => p.stock < 0 };

  function viewEstoque() {
    const p = params();
    const vis = p.get("vis") || "posicao";
    return `<div class="admin-head"><div><h1>Estoque</h1><p class="muted">Quanto tem de cada produto, quanto vale e tudo o que entrou e saiu.</p></div>
        <div class="rep__tools"><a class="btn btn--ghost btn--sm" href="#/admin?aba=entrada">${icon("i-download")}Entrada de fornecedor</a></div></div>
      <div class="rep__tabs" role="tablist">${[["posicao", "Posição"], ["movimentos", "Movimentações"]].map(([k, v]) => `<button role="tab" aria-selected="${vis === k}" class="${vis === k ? "is-on" : ""}" data-est-vis="${k}">${v}</button>`).join("")}</div>
      ${precisaServidor() || asyncView("est-root", skel(6), async () => { est = await fin("r=estoque"); renderEstoque(); })}`;
  }
  function renderEstoque() {
    if (!est) return;
    const p = params();
    const vis = p.get("vis") || "posicao", f = FILTROS_EST[p.get("f")] ? p.get("f") : "todos", q = p.get("q") || "";
    const busca = (x) => !q || norm(`${x.name} ${x.code}`).includes(norm(q));
    if (vis === "movimentos") {
      const lista = est.movimentos.filter(busca);
      return paint("est-root", `
        <section class="box">
          <input type="search" class="admin-search" id="est-q" value="${esc(q)}" placeholder="Filtrar por produto ou código" aria-label="Filtrar movimentações">
          ${lista.length ? `<div class="table-wrap"><table class="rep__table"><thead><tr><th>Quando</th><th>Produto</th><th>Motivo</th><th class="r">Qtd</th><th class="r">Ficou</th><th>Quem / ref.</th></tr></thead><tbody>
            ${lista.map((m) => `<tr><td class="num">${dia(m.em)} ${hora(m.em)}</td><td>${esc(m.name)} <small class="muted">${esc(m.code)}</small></td><td>${MOTIVO[m.motivo] || esc(m.motivo)}</td>
              <td class="r num ${m.delta < 0 ? "neg" : "pos"}"><b>${m.delta > 0 ? "+" : ""}${m.delta}</b></td><td class="r num">${m.saldo}</td><td class="muted">${esc([m.por, m.ref && !/^[0-9a-f-]{36}$/.test(m.ref) ? m.ref : ""].filter(Boolean).join(" · "))}</td></tr>`).join("")}
          </tbody></table></div>` : '<div class="empty">Nenhuma movimentação ainda.</div>'}
          <p class="muted rep__note">Mostra as últimas 500 movimentações.</p>
        </section>`);
    }
    const prods = est.produtos;
    const lista = prods.filter(filtroEst[f]).filter(busca).sort((a, b) => a.name.localeCompare(b.name));
    const pos = prods.filter((x) => x.stock > 0);
    const vCusto = pos.reduce((s, x) => s + x.stock * (x.cost || 0), 0), vVenda = pos.reduce((s, x) => s + x.stock * (x.promo ?? x.price), 0);
    const cont = Object.fromEntries(Object.keys(FILTROS_EST).map((k) => [k, prods.filter(filtroEst[k]).length]));
    paint("est-root", `
      <div class="stats">
        ${stat("Valor a custo", money(vCusto), `${pos.reduce((s, x) => s + x.stock, 0)} unidades em ${prods.length} produtos`, "stat--main")}
        ${stat("Valor a preço de venda", money(vVenda), `lucro potencial ${money(vVenda - vCusto)}`)}
        ${stat("Sem estoque", cont.sem, "produtos")}
        ${stat("Abaixo do mínimo", cont.min, "hora de comprar")}
        ${stat("Parados", cont.parado, `sem venda há 60 dias · ${money(prods.filter(parado).reduce((s, x) => s + x.stock * (x.cost || 0), 0))}`)}
      </div>
      <section class="box">
        <div class="est-tools">
          <div class="seg seg--sm" role="radiogroup" aria-label="Filtro">${Object.entries(FILTROS_EST).filter(([k]) => k !== "neg" || cont.neg).map(([k, v]) => `<button type="button" role="radio" aria-checked="${f === k}" class="${f === k ? "is-on" : ""}" data-est-f="${k}">${v}${k !== "todos" ? ` <b class="num">${cont[k]}</b>` : ""}</button>`).join("")}</div>
          <input type="search" class="admin-search" id="est-q" value="${esc(q)}" placeholder="Buscar produto ou código" aria-label="Buscar produto">
        </div>
        ${lista.length ? `<div class="table-wrap"><table class="rep__table est-table"><thead><tr><th>Produto</th><th class="r">Estoque</th><th class="r">Mín.</th><th class="r">Custo un.</th><th class="r">Valor a custo</th><th class="r">Valor de venda</th><th>Última venda</th><th></th></tr></thead><tbody>
          ${lista.map((x) => `<tr class="${x.stock <= 0 ? "is-out" : x.min && x.stock <= x.min ? "is-low" : ""}">
            <td><b>${esc(x.name)}</b> <small class="muted">${esc(x.code)}</small></td>
            <td class="r num"><b>${x.stock}</b>${x.stock < 0 ? ' <span class="tag tag--bad">negativo</span>' : x.stock === 0 ? ' <span class="tag tag--bad">zerado</span>' : x.min && x.stock <= x.min ? ' <span class="tag tag--warn">repor</span>' : ""}</td>
            <td class="r num">${x.min || "-"}</td><td class="r num">${money(x.cost || 0)}</td>
            <td class="r num">${money(Math.max(0, x.stock) * (x.cost || 0))}</td><td class="r num">${money(Math.max(0, x.stock) * (x.promo ?? x.price))}</td>
            <td class="muted">${x.ultimaVenda ? dia(x.ultimaVenda) : "nunca"}</td>
            <td class="r"><button class="btn btn--ghost btn--sm" data-est-ajustar="${esc(x.id)}">Ajustar</button></td>
          </tr>${ajustando === x.id ? `<tr class="est-ajuste"><td colspan="8">
            <form class="ajuste" id="est-ajuste-form" data-id="${esc(x.id)}" novalidate>
              <label class="field"><span>Quantidade contada na prateleira</span><input name="contagem" type="number" min="0" step="1" value="${Math.max(0, x.stock)}" required></label>
              <label class="field"><span>Motivo</span><input name="motivo" maxlength="120" value="Contagem de estoque"></label>
              <button class="btn btn--primary btn--sm">${icon("i-check")}Salvar ajuste</button>
              <button type="button" class="text-btn" data-est-ajustar="">Cancelar</button>
            </form></td></tr>` : ""}`).join("")}
        </tbody></table></div>` : `<div class="empty">${q ? "Nenhum produto encontrado." : f === "todos" ? "Nenhum produto cadastrado." : "Nenhum produto neste filtro."}</div>`}
      </section>`);
    if (ajustando) $("#est-ajuste-form [name=contagem]")?.select();
  }

  // ======================================================================
  // DESPESAS E CONTAS A PAGAR
  // ======================================================================
  let desp = null;          // { despesas, categorias, compras, fornecedores }
  let despEdit = null;      // null | {} | despesa
  let pagando = null;       // id da despesa com o formulário de pagamento aberto
  const FORMAS_PAG = { pix: "Pix", dinheiro: "Dinheiro", boleto: "Boleto", transferencia: "Transferência", debito: "Cartão débito", credito: "Cartão crédito" };
  const FILTROS_DESP = { abertas: "A pagar", vencidas: "Vencidas", pagas: "Pagas", todas: "Todas" };
  const statusDesp = (d) => d.pagoEm ? ["Paga", "ok"] : d.vencimento < hoje() ? ["Vencida", "bad"] : d.vencimento <= iso(new Date(Date.now() + 7 * 864e5)) ? ["Vence logo", "warn"] : ["A vencer", ""];
  const lojaNome = (id) => (id ? X.setup?.lojas.find((l) => l.id === id)?.nome || "" : "Geral");

  async function loadDesp() {
    const [d, f] = await Promise.all([fin("r=despesas"), X.api("r=fornecedores"), X.loadSetup()]);
    desp = { ...d, compras: f.compras, fornecedores: f.fornecedores };
  }
  function viewDespesas() {
    despEdit = null; pagando = null;
    return `<div class="admin-head"><div><h1>Despesas</h1><p class="muted">Contas da loja e pagamentos a fornecedor. Entra no dashboard e no lucro.</p></div>
        <button class="btn btn--primary btn--sm" data-desp-new>${icon("i-plus")}Lançar despesa</button></div>
      ${asyncView("desp-root", skel(6), async () => { await loadDesp(); renderDespesas(); })}`;
  }
  function despForm() {
    if (!despEdit) return "";
    const d = despEdit, cats = desp.categorias;
    const forn = d.categoria === "fornecedor";
    const comprasForn = desp.compras.filter((c) => !d.fornecedorId || c.fornecedor.id === d.fornecedorId).slice(0, 40);
    return `<form class="box desp-form" id="desp-form" novalidate>
      <div class="box__head"><h2>${d.id ? "Editar despesa" : "Nova despesa"}</h2><button type="button" class="text-btn" data-desp-cancel>Cancelar</button></div>
      <div class="desp-form__grid">
        <label class="field desp-form__desc"><span>Descrição</span><input name="descricao" value="${esc(d.descricao || "")}" maxlength="120" placeholder="Ex.: Aluguel da loja" required><span class="err"></span></label>
        <label class="field"><span>Categoria</span><select name="categoria" data-desp-cat>${Object.entries(cats).map(([k, v]) => `<option value="${k}" ${(d.categoria || "outros") === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label class="field"><span>Valor</span><span class="money-input"><span>R$</span><input name="valor" inputmode="decimal" value="${d.valor ? fmtMoneyInput(d.valor) : ""}" placeholder="0,00" required></span><span class="err"></span></label>
        <label class="field"><span>Vencimento</span><input name="vencimento" type="date" value="${esc(d.vencimento || hoje())}" required></label>
        <label class="field"><span>Loja</span><select name="lojaId"><option value="">Geral (todas)</option>${(X.setup?.lojas || []).map((l) => `<option value="${esc(l.id)}" ${d.lojaId === l.id ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></label>
        ${forn ? `
        <label class="field"><span>Fornecedor</span><select name="fornecedorId" data-desp-forn><option value="">Escolha</option>${desp.fornecedores.map((x) => `<option value="${esc(x.id)}" ${d.fornecedorId === x.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>
        <label class="field"><span>Entrada de estoque <span class="opt">(opcional)</span></span><select name="compraId" data-desp-compra><option value="">Nenhuma</option>${comprasForn.map((c) => `<option value="${esc(c.id)}" data-valor="${c.total}" ${d.compraId === c.id ? "selected" : ""}>${diaLongo(c.data)} · ${esc(c.fornecedor.nome)}${c.nota ? ` · nota ${esc(c.nota)}` : ""} · ${money(c.total)}</option>`).join("")}</select></label>` : ""}
        <label class="field desp-form__obs"><span>Observação <span class="opt">(opcional)</span></span><input name="obs" value="${esc(d.obs || "")}" maxlength="300"></label>
      </div>
      <label class="check"><input type="checkbox" name="recorrente" ${d.recorrente ? "checked" : ""}> Repete todo mês (ao pagar, a do mês seguinte já fica lançada)</label>
      ${forn ? '<p class="muted desp-form__hint">Pagamento de mercadoria aparece no fluxo de caixa, mas não diminui o lucro da DRE: o custo dos produtos já entra quando eles são vendidos.</p>' : ""}
      <span class="err" id="desp-err"></span>
      <button class="btn btn--primary">${icon("i-check")}${d.id ? "Salvar" : "Lançar despesa"}</button>
    </form>`;
  }
  function renderDespesas() {
    if (!desp) return;
    const p = params();
    const f = FILTROS_DESP[p.get("f")] ? p.get("f") : "abertas", q = p.get("q") || "";
    const h = hoje(), mes = h.slice(0, 7), em7 = iso(new Date(Date.now() + 7 * 864e5));
    const todas = desp.despesas;
    const abertas = todas.filter((d) => !d.pagoEm);
    const soma = (l) => l.reduce((s, d) => s + d.valor, 0);
    const filtro = { abertas: (d) => !d.pagoEm, vencidas: (d) => !d.pagoEm && d.vencimento < h, pagas: (d) => !!d.pagoEm, todas: () => true }[f];
    const lista = todas.filter(filtro).filter((d) => !q || norm(`${d.descricao} ${desp.categorias[d.categoria]} ${d.obs}`).includes(norm(q)))
      .sort((a, b) => (f === "pagas" ? b.pagoEm.localeCompare(a.pagoEm) : a.vencimento.localeCompare(b.vencimento)));
    const pagas = new Set(todas.filter((d) => d.compraId).map((d) => d.compraId));
    const semPag = desp.compras.filter((c) => !pagas.has(c.id)).slice(0, 12);
    const fornNome = (id) => desp.fornecedores.find((x) => x.id === id)?.nome || "";
    paint("desp-root", `
      ${despForm()}
      <div class="stats">
        ${stat("Vencidas", money(soma(abertas.filter((d) => d.vencimento < h))), `${abertas.filter((d) => d.vencimento < h).length} contas`, abertas.some((d) => d.vencimento < h) ? "stat--bad" : "")}
        ${stat("Vencem em 7 dias", money(soma(abertas.filter((d) => d.vencimento >= h && d.vencimento <= em7))))}
        ${stat("A pagar neste mês", money(soma(abertas.filter((d) => d.vencimento.slice(0, 7) === mes))))}
        ${stat("Pago neste mês", money(soma(todas.filter((d) => d.pagoEm?.slice(0, 7) === mes))), "inclui fornecedores", "stat--main")}
      </div>
      <section class="box">
        <div class="est-tools">
          <div class="seg seg--sm" role="radiogroup" aria-label="Filtro">${Object.entries(FILTROS_DESP).map(([k, v]) => `<button type="button" role="radio" aria-checked="${f === k}" class="${f === k ? "is-on" : ""}" data-desp-f="${k}">${v}</button>`).join("")}</div>
          <input type="search" class="admin-search" id="desp-q" value="${esc(q)}" placeholder="Buscar despesa" aria-label="Buscar despesa">
        </div>
        ${lista.length ? `<ul class="dlist">${lista.map((d) => { const [st, cls] = statusDesp(d); return `
          <li class="dlist__item ${cls ? `is-${cls}` : ""}">
            <span class="dlist__date num">${diaLongo(d.vencimento)}</span>
            <span class="dlist__main"><b>${esc(d.descricao)}</b>
              <small class="muted">${esc(desp.categorias[d.categoria] || d.categoria)} · ${esc(lojaNome(d.lojaId))}${d.recorrente ? " · todo mês" : ""}${d.fornecedorId ? ` · ${esc(fornNome(d.fornecedorId))}` : ""}${d.pagoEm ? ` · paga em ${diaLongo(d.pagoEm)} (${FORMAS_PAG[d.forma] || d.forma}${d.doCaixa ? ", do caixa" : ""})` : ""}</small></span>
            <span class="tag ${cls ? `tag--${cls}` : ""}">${st}</span>
            <b class="num dlist__val">${money(d.valor)}</b>
            <span class="dlist__act">
              ${d.pagoEm ? `<button class="btn btn--ghost btn--sm" data-desp-desfazer="${esc(d.id)}">${icon("i-undo")}Desfazer</button>`
                : `<button class="btn btn--primary btn--sm" data-desp-pagar="${esc(d.id)}">${icon("i-check")}Pagar</button>`}
              <button class="icon-btn icon-btn--sm" data-desp-edit="${esc(d.id)}" aria-label="Editar ${esc(d.descricao)}">${icon("i-edit")}</button>
              <button class="icon-btn icon-btn--sm" data-desp-del="${esc(d.id)}" aria-label="Excluir ${esc(d.descricao)}">${icon("i-trash")}</button>
            </span>
            ${pagando === d.id ? `
            <form class="ajuste dlist__pay" id="desp-pay-form" data-id="${esc(d.id)}" novalidate>
              <label class="field"><span>Pago em</span><input name="pagoEm" type="date" value="${h}"></label>
              <label class="field"><span>Forma</span><select name="forma">${Object.entries(FORMAS_PAG).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
              <label class="check"><input type="checkbox" name="doCaixa"> Saiu do dinheiro da gaveta (vira retirada no caixa aberto)</label>
              <button class="btn btn--primary btn--sm">${icon("i-check")}Confirmar pagamento</button>
              <button type="button" class="text-btn" data-desp-pagar="">Cancelar</button>
            </form>` : ""}
          </li>`; }).join("")}</ul>` : `<div class="empty">${f === "abertas" ? "Nenhuma conta a pagar. " : "Nada neste filtro. "}<button class="btn btn--primary btn--sm" data-desp-new>${icon("i-plus")}Lançar despesa</button></div>`}
      </section>
      ${semPag.length ? `<section class="box">
        <div class="box__head"><h2>Entradas de fornecedor sem pagamento lançado</h2><span class="muted">lance aqui quando pagar o fornecedor</span></div>
        <ul class="mlist">${semPag.map((c) => `<li><span class="num">${diaLongo(c.data).slice(0, 5)}</span><span><b>${esc(c.fornecedor.nome)}</b>${c.nota ? ` · nota ${esc(c.nota)}` : ""} · ${c.itens.reduce((n, it) => n + it.qty, 0)} itens</span>
          <span class="mlist__end"><b class="num">${money(c.total)}</b> <button class="btn btn--ghost btn--sm" data-desp-compra="${esc(c.id)}">Lançar pagamento</button></span></li>`).join("")}</ul>
      </section>` : ""}`);
  }

  // ======================================================================
  // DASHBOARD
  // ======================================================================
  const PER_DASH = { hoje: "Hoje", semana: "Esta semana", mes: "Este mês", mespassado: "Mês passado", d30: "Últimos 30 dias", d90: "Últimos 90 dias", ano: "Este ano" };
  function periodoDash(k) {
    if (X.PERIODOS[k]) return X.periodo(k);
    const h = new Date(); h.setHours(0, 0, 0, 0);
    const d = new Date(h);
    if (k === "d30") d.setDate(d.getDate() - 29);
    else if (k === "d90") d.setDate(d.getDate() - 89);
    else if (k === "ano") d.setMonth(0, 1);
    return { de: iso(d), ate: iso(h) };
  }
  let dash = null;
  const DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  function viewDashboard() {
    const p = params();
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const per = p.get("p") || (p.get("de") ? "custom" : "mes");
    const { de, ate } = per === "custom" ? { de: isoRe.test(p.get("de")) ? p.get("de") : hoje(), ate: isoRe.test(p.get("ate")) ? p.get("ate") : hoje() } : periodoDash(per);
    const lojaSel = p.get("loja") || "";
    return `<div class="admin-head no-print"><div><h1>Dashboard financeiro</h1><p class="muted">Resultado, caixa, contas e estoque da loja num lugar só.</p></div>
        <div class="rep__tools"><button class="btn btn--ghost btn--sm" data-dash-csv>${icon("i-download")}Planilha</button><button class="btn btn--dark btn--sm" data-dash-print>${icon("i-print")}Imprimir ou PDF</button></div></div>
      <form class="rep__filters no-print" id="dash-form">
        <div class="seg" role="radiogroup" aria-label="Período">${Object.entries(PER_DASH).map(([k, v]) => `<button type="button" role="radio" aria-checked="${per === k}" class="${per === k ? "is-on" : ""}" data-dash-p="${k}">${v}</button>`).join("")}</div>
        <label class="rep__date"><span>De</span><input type="date" name="de" value="${esc(de)}"></label>
        <label class="rep__date"><span>Até</span><input type="date" name="ate" value="${esc(ate)}"></label>
        <span id="dash-loja"></span>
      </form>
      ${T().avisoCatalogo()}
      ${asyncView("dash-root", `<div class="dash2">${skel(8)}</div>`, async () => {
        await X.loadSetup();
        paint("dash-loja", X.setup.lojas.length > 1 ? `<select data-dash-loja aria-label="Loja"><option value="">Todas as lojas</option>${X.setup.lojas.map((l) => `<option value="${esc(l.id)}" ${l.id === lojaSel ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select>` : "");
        const from = new Date(`${de}T00:00:00`), to = new Date(`${ate}T23:59:59.999`);
        dash = await fin(`r=dashboard&from=${from.toISOString()}&to=${to.toISOString()}${lojaSel ? `&lojaId=${encodeURIComponent(lojaSel)}` : ""}`);
        dash.titulo = de === ate ? diaLongo(de) : `${diaLongo(de)} a ${diaLongo(ate)}`;
        paint("dash-root", dashHTML(dash));
      })}`;
  }

  // variação contra o período anterior: seta + texto, nunca só cor
  function delta(cur, prev, { inverso = false, pontos = false } = {}) {
    if (pontos) {
      const d = cur - prev;
      if (!prev && !cur) return "";
      return `<span class="delta ${Math.abs(d) < 0.05 ? "" : (d > 0) !== inverso ? "is-up" : "is-down"}">${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(d).toFixed(1).replace(".", ",")} p.p.</span>`;
    }
    if (!prev) return cur ? '<span class="delta">novo no período</span>' : "";
    const d = ((cur - prev) / Math.abs(prev)) * 100;
    return `<span class="delta ${Math.abs(d) < 0.5 ? "" : (d > 0) !== inverso ? "is-up" : "is-down"}" title="Período anterior: ${money(prev)}">${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(d).toFixed(0)}%</span>`;
  }
  const kpiTile = (label, valor, extra, cls = "") => `<div class="kpi ${cls}"><span class="kpi__label">${label}</span><strong class="kpi__val num">${valor}</strong><span class="kpi__extra">${extra || ""}</span></div>`;

  // barras verticais de uma série (receita por dia, dia da semana, hora)
  function barras(itens, { label, cls = "" } = {}) {
    const max = Math.max(...itens.map((i) => Math.abs(i.v)), 1);
    return `<div class="vbars ${cls}" role="img" aria-label="${esc(label)}">${itens.map((i) => `
      <div class="vbars__col" tabindex="0" data-tip="${esc(`<b>${esc(i.tip || i.l)}</b><br>${money(i.v)}`)}"><span class="vbars__bar ${i.v < 0 ? "is-neg" : ""}" style="--h:${Math.max(i.v ? 2 : 0, (Math.abs(i.v) / max) * 100)}%"></span><span class="vbars__lbl">${esc(i.l)}</span></div>`).join("")}</div>`;
  }
  // barras horizontais com valor e parte do total (formas de pagamento, categorias, despesas)
  function hbarras(itens, total) {
    const max = Math.max(...itens.map((i) => i.v), 1);
    return `<ul class="hbars">${itens.map((i) => `<li data-tip="${esc(`<b>${esc(i.l)}</b><br>${money(i.v)}${total ? ` · ${pct((i.v / total) * 100, 0)}` : ""}`)}" tabindex="0">
      <span class="hbars__l">${esc(i.l)}</span><span class="hbars__track"><span class="hbars__bar" style="--w:${Math.max(1, (i.v / max) * 100)}%"></span></span>
      <span class="hbars__v num">${money(i.v)}${total ? ` <small>${pct((i.v / total) * 100, 0)}</small>` : ""}</span></li>`).join("")}</ul>`;
  }
  // fluxo de caixa: entradas para cima, saídas para baixo, no mesmo eixo
  function fluxoChart(dias) {
    if (!dias.length) return '<p class="muted">Sem movimento de caixa no período.</p>';
    const max = Math.max(...dias.flatMap((d) => [d.entradas, d.saidas]), 1);
    const passo = Math.ceil(dias.length / 10);
    return `<div class="legend"><span><i class="sw sw--in"></i>Entradas</span><span><i class="sw sw--out"></i>Saídas</span></div>
      <div class="fluxo" role="img" aria-label="Entradas e saídas de dinheiro por dia">${dias.map((d, i) => `
        <div class="fluxo__col" tabindex="0" data-tip="<b>${diaLongo(d.dia)}</b><br>Entradas ${money(d.entradas)}<br>Saídas ${money(d.saidas)}<br>Saldo ${money(d.entradas - d.saidas)}">
          <span class="fluxo__up"><span class="fluxo__bar fluxo__bar--in" style="--h:${(d.entradas / max) * 100}%"></span></span>
          <span class="fluxo__down"><span class="fluxo__bar fluxo__bar--out" style="--h:${(d.saidas / max) * 100}%"></span></span>
          <span class="fluxo__lbl">${i % passo === 0 ? d.dia.slice(8, 10) : ""}</span>
        </div>`).join("")}</div>`;
  }
  const tabela = (cab, linhas, vazio = "Nada no período.") => linhas.length
    ? `<div class="table-wrap"><table class="rep__table"><thead><tr>${cab.map((c) => `<th class="${c.startsWith(">") ? "r" : ""}">${c.replace(/^>/, "")}</th>`).join("")}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
    : `<p class="muted">${vazio}</p>`;

  function dashHTML(D) {
    const k = D.kpi, a = D.kpiAnterior, dre = D.dre, eq = D.equilibrio, E = D.estoque, C = D.controle;
    const catNome = (c) => T().catBy(c)?.name || "Outros";
    const formasL = Object.entries(D.formas).filter(([, v]) => v > 0).map(([f, v]) => ({ l: X.FORMAS[f] || f, v })).sort((x, y) => y.v - x.v);
    const totalFormas = formasL.reduce((s, x) => s + x.v, 0);
    const alertas = [];
    if (D.pagar.vencidas) alertas.push(`<a href="#/admin?aba=despesas&f=vencidas"><b>${money(D.pagar.vencidas)}</b> em ${D.pagar.qtdVencidas} ${D.pagar.qtdVencidas === 1 ? "conta vencida" : "contas vencidas"}</a>`);
    if (E.negativos.length) alertas.push(`<a href="#/admin?aba=estoque&f=neg"><b>${E.negativos.length}</b> ${E.negativos.length === 1 ? "produto com estoque negativo" : "produtos com estoque negativo"}: confira a contagem</a>`);
    if (E.abaixoMin) alertas.push(`<a href="#/admin?aba=estoque&f=min"><b>${E.abaixoMin}</b> ${E.abaixoMin === 1 ? "produto abaixo" : "produtos abaixo"} do estoque mínimo</a>`);
    if (C.esquecidos.length) alertas.push(`<a href="#/admin?aba=caixa"><b>${C.esquecidos.length}</b> ${C.esquecidos.length === 1 ? "caixa ficou aberto" : "caixas ficaram abertos"} de um dia para o outro</a>`);
    if (C.falta) alertas.push(`<a href="#/admin?aba=caixa">Faltou <b>${money(C.falta)}</b> na gaveta nos fechamentos do período</a>`);
    if (D.compras.semPagamento) alertas.push(`<a href="#/admin?aba=despesas"><b>${money(D.compras.semPagamento)}</b> em compras de fornecedor sem pagamento lançado</a>`);
    const semCusto = D.produtos.top.some((p) => !p.custo && p.valor > 0);

    // ponto de equilíbrio: barra até a meta, marca do vendido e da projeção
    const pe = eq.pontoEquilibrio;
    const escala = Math.max(pe || 0, eq.projecao, eq.vendidoMes, 1);
    const peHTML = pe == null
      ? `<p class="muted">Lance as despesas do mês e registre vendas com preço de custo para calcular quanto precisa vender para empatar.</p>`
      : `<p class="pe__frase">Para pagar as contas deste mês, a loja precisa vender <b class="num">${money(pe)}</b>. Já vendeu <b class="num">${money(eq.vendidoMes)}</b> (${pct((eq.vendidoMes / pe) * 100, 0)}).</p>
        <div class="pe" role="img" aria-label="Vendido ${money(eq.vendidoMes)} de ${money(pe)} necessários">
          <span class="pe__fill" style="--w:${Math.min(100, (eq.vendidoMes / escala) * 100)}%"></span>
          <span class="pe__proj" style="--w:${Math.min(100, (eq.projecao / escala) * 100)}%" data-tip="Projeção do mês: ${money(eq.projecao)}"></span>
          <span class="pe__meta" style="--l:${Math.min(100, (pe / escala) * 100)}%" data-tip="Ponto de equilíbrio: ${money(pe)}"><small>empate</small></span>
        </div>
        <div class="pe__legend"><span><i class="sw sw--in"></i>Vendido</span><span><i class="sw sw--proj"></i>Projeção do mês: <b class="num">${money(eq.projecao)}</b></span><span>${eq.lucroProjetado >= 0 ? "▲ Lucro" : "▼ Prejuízo"} projetado: <b class="num">${money(Math.abs(eq.lucroProjetado))}</b></span></div>
        <p class="muted pe__nota">Margem de contribuição ${pct(eq.margemContribuicao)} · despesas do mês ${money(eq.despesasMes)} · dia ${eq.diasPassados} de ${eq.diasMes}.</p>`;

    const despL = Object.entries(dre.despesas).map(([c, v]) => ({ l: D.categorias[c] || c, v })).sort((x, y) => y.v - x.v);
    const linhaDre = (l, v, cls = "", nota = "") => `<tr class="${cls}"><td>${l}${nota ? ` <small class="muted">${nota}</small>` : ""}</td><td class="r num">${money(v)}</td><td class="r num muted">${dre.bruta ? pct((v / dre.bruta) * 100) : "-"}</td></tr>`;

    return `
      <section class="report dash2">
        <header class="report__print-head print-only"><strong>TOP SMART</strong><span>Dashboard financeiro · ${esc(D.titulo)}</span></header>
        ${alertas.length ? `<div class="dash2__alertas">${icon("i-bell")}<div><strong>Atenção</strong><ul>${alertas.map((x) => `<li>${x}</li>`).join("")}</ul></div></div>` : ""}

        <div class="kpis">
          ${kpiTile("Faturamento", money(k.bruta), `${delta(k.bruta, a.bruta)} ${k.nVendas} ${k.nVendas === 1 ? "venda" : "vendas"}`)}
          ${kpiTile("Receita líquida", money(k.liquida), `${delta(k.liquida, a.liquida)} sem devoluções, cupons e taxas`)}
          ${kpiTile("Lucro bruto", money(k.lucroBruto), `${delta(k.lucroBruto, a.lucroBruto)} margem ${pct(k.margemBruta)}`)}
          ${kpiTile("Despesas", money(k.despesas), `${delta(k.despesas, a.despesas, { inverso: true })} contas da loja`)}
          ${kpiTile("Lucro líquido", money(k.lucroLiquido), `${delta(k.lucroLiquido, a.lucroLiquido)} margem ${pct(k.margemLiquida)}`, `kpi--main ${k.lucroLiquido < 0 ? "is-neg" : ""}`)}
          ${kpiTile("Ticket médio", money(k.ticket), delta(k.ticket, a.ticket))}
        </div>
        <p class="muted dash2__comp">Comparado com ${diaLongo(D.periodo.anteriorDe)} a ${diaLongo(D.periodo.anteriorAte)} (mesmo número de dias, logo antes).</p>

        <div class="dash2__grid">
          <section class="box dash2__wide">
            <div class="box__head"><h2>Faturamento por dia</h2><span class="muted">receita líquida de cada dia</span></div>
            ${D.porDia.length ? barras(D.porDia.map((d) => ({ l: d.dia.slice(8, 10), tip: diaLongo(d.dia), v: d.valor })), { label: "Receita por dia" }) : '<p class="muted">Nenhuma venda no período.</p>'}
          </section>

          <section class="box">
            <div class="box__head"><h2>Ponto de equilíbrio</h2><span class="muted">este mês</span></div>
            ${peHTML}
          </section>

          <section class="box">
            <div class="box__head"><h2>DRE gerencial</h2><span class="muted">resultado do período</span></div>
            <div class="table-wrap"><table class="rep__table dre"><thead><tr><th></th><th class="r">Valor</th><th class="r">% fat.</th></tr></thead><tbody>
              ${linhaDre("Receita bruta", dre.bruta, "dre__total")}
              ${linhaDre("(-) Devoluções", -dre.devolucoes)}
              ${dre.cupons ? linhaDre("(-) Cupons de desconto", -dre.cupons) : ""}
              ${linhaDre("(-) Taxas da maquininha", -dre.taxas, "", D.taxas.credito || D.taxas.debito ? "" : "configure em Lojas e vendedores")}
              ${linhaDre("= Receita líquida", dre.liquida, "dre__total")}
              ${linhaDre("(-) Custo das mercadorias (CMV)", -dre.cmv, "", dre.perdas ? `inclui ${money(dre.perdas)} de defeito` : "")}
              ${linhaDre("= Lucro bruto", dre.lucroBruto, "dre__total")}
              ${despL.map((x) => linhaDre(`(-) ${esc(x.l)}`, -x.v, "dre__sub")).join("")}
              ${linhaDre("= Resultado (lucro líquido)", dre.resultado, `dre__final ${dre.resultado < 0 ? "is-neg" : ""}`)}
            </tbody></table></div>
            ${semCusto ? '<p class="muted rep__note">Há produtos vendidos sem preço de custo: o CMV fica menor do que o real. Preencha o custo em Produtos.</p>' : ""}
          </section>

          <section class="box dash2__wide">
            <div class="box__head"><h2>Fluxo de caixa</h2><span class="muted">dinheiro que entrou e saiu de verdade</span></div>
            <div class="mini-stats">
              ${stat("Entradas", money(D.fluxo.entradas), D.fluxo.recebidoFiado ? `inclui ${money(D.fluxo.recebidoFiado)} de fiado` : "vendas em dinheiro, Pix e cartão")}
              ${stat("Saídas", money(D.fluxo.saidas), `despesas ${money(D.fluxo.pagoDespesas)} · fornecedores ${money(D.fluxo.pagoFornecedor)}`)}
              ${stat("Saldo do período", money(D.fluxo.saldo), D.fluxo.retiradas ? `retiradas avulsas ${money(D.fluxo.retiradas)}` : "", D.fluxo.saldo < 0 ? "stat--bad" : "stat--main")}
            </div>
            ${fluxoChart(D.fluxo.dias)}
          </section>

          <section class="box">
            <div class="box__head"><h2>Contas a pagar</h2><a class="link-arrow" href="#/admin?aba=despesas">Despesas ${icon("i-arrow")}</a></div>
            <div class="mini-stats">
              ${stat("Vencidas", money(D.pagar.vencidas), "", D.pagar.vencidas ? "stat--bad" : "")}
              ${stat("Próximos 7 dias", money(D.pagar.semana))}
              ${stat("Próximos 30 dias", money(D.pagar.mes))}
            </div>
            ${D.pagar.proximas.length ? `<ul class="mlist">${D.pagar.proximas.map((d) => `<li><span class="num ${d.vencimento < hoje() ? "neg" : ""}">${diaLongo(d.vencimento).slice(0, 5)}</span><span>${esc(d.descricao)} <small class="muted">${esc(D.categorias[d.categoria] || "")}</small></span><b class="num">${money(d.valor)}</b></li>`).join("")}</ul>` : '<p class="muted">Nenhuma conta em aberto.</p>'}
          </section>

          <section class="box">
            <div class="box__head"><h2>Contas a receber</h2><a class="link-arrow" href="#/admin?aba=clientes">Clientes ${icon("i-arrow")}</a></div>
            <div class="mini-stats">
              ${stat("Fiado a receber", money(D.receber.fiado), `${D.receber.qtd} ${D.receber.qtd === 1 ? "cliente" : "clientes"}${D.receber.maisAntigo ? ` · mais antigo desde ${dia(D.receber.maisAntigo)}` : ""}`)}
              ${stat("Recebido no período", money(D.receber.recebidoPeriodo))}
              ${stat("Crédito dos clientes", money(D.receber.creditoLoja), "a loja deve em produtos")}
            </div>
            ${D.receber.clientes.length ? `<ul class="mlist">${D.receber.clientes.map((c) => `<li><span class="num">${c.desde ? dia(c.desde) : "-"}</span><span>${esc(c.nome)}</span><b class="num">${money(c.valor)}</b></li>`).join("")}</ul>` : '<p class="muted">Ninguém deve no fiado.</p>'}
          </section>

          <section class="box">
            <div class="box__head"><h2>Formas de pagamento</h2></div>
            ${formasL.length ? hbarras(formasL, totalFormas) : '<p class="muted">Nenhum pagamento no período.</p>'}
          </section>

          <section class="box">
            <div class="box__head"><h2>Despesas por categoria</h2></div>
            ${despL.length ? hbarras(despL, dre.despesasTotal) : '<p class="muted">Nenhuma despesa com vencimento no período.</p>'}
          </section>

          <section class="box dash2__wide">
            <div class="box__head"><h2>Estoque</h2><a class="link-arrow" href="#/admin?aba=estoque">Ver estoque ${icon("i-arrow")}</a></div>
            <div class="mini-stats mini-stats--4">
              ${stat("Valor a custo", money(E.valorCusto), `${E.unidades} unidades em ${E.skus} produtos`, "stat--main")}
              ${stat("Valor a preço de venda", money(E.valorVenda), `lucro potencial ${money(E.lucroPotencial)}`)}
              ${stat("Giro no período", E.giro == null ? "-" : `${E.giro.toFixed(2).replace(".", ",")}x`, "CMV ÷ estoque a custo")}
              ${stat("Cobertura", E.coberturaDias == null ? "-" : `${E.coberturaDias} dias`, "quanto tempo o estoque dura no ritmo atual")}
              ${stat("Sem estoque", E.semEstoque, "produtos", E.semEstoque ? "stat--warn" : "")}
              ${stat("Abaixo do mínimo", E.abaixoMin, "produtos", E.abaixoMin ? "stat--warn" : "")}
              ${stat("Parados há 60 dias", E.parados, `${money(E.valorParado)} empatados`, E.valorParado ? "stat--warn" : "")}
              ${stat("Curva A", `${E.abc.A.produtos} produtos`, `fazem ${D.kpi.bruta ? pct((E.abc.A.valor / Math.max(1, E.abc.A.valor + E.abc.B.valor + E.abc.C.valor)) * 100, 0) : "0%"} do faturamento`)}
            </div>
            <div class="dash2__cols">
              <div><h3>Curva ABC <small class="muted">A até 80% do faturamento, B até 95%</small></h3>
                ${tabela(["Classe", "Produto", ">Faturamento"], E.abc.lista.map((p) => `<tr><td><span class="tag tag--abc-${p.classe}">${p.classe}</span></td><td>${esc(p.name)}</td><td class="r num">${money(p.valor)}</td></tr>`), "Nenhuma venda no período.")}</div>
              <div><h3>Dinheiro parado <small class="muted">sem venda há 60 dias</small></h3>
                ${tabela(["Produto", ">Qtd", ">Custo parado"], E.listaParados.map((p) => `<tr><td>${esc(p.name)} <small class="muted">${p.ultimaVenda ? `última ${dia(p.ultimaVenda)}` : "nunca vendeu"}</small></td><td class="r num">${p.stock}</td><td class="r num">${money(p.valor)}</td></tr>`), "Nenhum produto parado.")}
                ${E.listaAbaixoMin.length ? `<h3>Repor</h3>${tabela(["Produto", ">Tem", ">Mín."], E.listaAbaixoMin.map((p) => `<tr><td>${esc(p.name)}</td><td class="r num">${p.stock}</td><td class="r num">${p.min}</td></tr>`))}` : ""}</div>
            </div>
          </section>

          <section class="box">
            <div class="box__head"><h2>Produtos que mais vendem</h2></div>
            ${tabela(["Produto", ">Qtd", ">Faturamento", ">Lucro"], D.produtos.top.map((p) => `<tr><td>${esc(p.name)}</td><td class="r num">${p.qtd}</td><td class="r num">${money(p.valor)}</td><td class="r num ${p.lucro < 0 ? "neg" : ""}">${money(p.lucro)}</td></tr>`))}
          </section>

          <section class="box">
            <div class="box__head"><h2>Menores margens</h2><span class="muted">reveja preço ou custo</span></div>
            ${tabela(["Produto", ">Faturamento", ">Margem"], D.produtos.piores.map((p) => `<tr><td>${esc(p.name)}</td><td class="r num">${money(p.valor)}</td><td class="r num ${p.margem < 15 ? "neg" : ""}">${pct(p.margem)}</td></tr>`))}
          </section>

          <section class="box">
            <div class="box__head"><h2>Faturamento por categoria</h2></div>
            ${D.produtos.categorias.filter((c) => c.valor > 0).length ? hbarras(D.produtos.categorias.filter((c) => c.valor > 0).map((c) => ({ l: catNome(c.cat), v: c.valor })), D.produtos.categorias.reduce((s, c) => s + Math.max(0, c.valor), 0)) : '<p class="muted">Nenhuma venda no período.</p>'}
          </section>

          <section class="box">
            <div class="box__head"><h2>Vendedores</h2></div>
            ${tabela(["Vendedor", ">Vendas", ">Valor", ">Ticket"], D.vendedores.map((v) => `<tr><td>${esc(v.nome)}</td><td class="r num">${v.vendas}</td><td class="r num">${money(v.valor)}</td><td class="r num">${money(v.ticket)}</td></tr>`))}
          </section>

          <section class="box">
            <div class="box__head"><h2>Vendas por dia da semana</h2></div>
            ${barras(D.semana.map((v, i) => ({ l: DIAS_SEM[i], v })), { label: "Vendas por dia da semana", cls: "vbars--short" })}
          </section>

          <section class="box">
            <div class="box__head"><h2>Vendas por horário</h2></div>
            ${(() => {
              // horário comercial (8h às 19h) e qualquer hora fora dele em que houve venda
              const com = D.hora.map((v, h) => ({ h, v })).filter((x) => x.v);
              const ini = Math.min(8, ...com.map((x) => x.h)), fim = Math.max(19, ...com.map((x) => x.h));
              return barras(D.hora.slice(ini, fim + 1).map((v, i) => ({ l: `${ini + i}h`, tip: `${ini + i}h às ${ini + i + 1}h`, v })), { label: "Vendas por horário", cls: "vbars--short" });
            })()}
          </section>

          <section class="box dash2__wide">
            <div class="box__head"><h2>Controle</h2><span class="muted">perdas, devoluções e caixa</span></div>
            <div class="mini-stats mini-stats--4">
              ${stat("Devoluções", money(C.devolucoes), `${pct(C.taxaDevolucao)} do faturamento · ${C.nDevol} devol. · ${C.nTrocas} trocas`, C.taxaDevolucao > 5 ? "stat--warn" : "")}
              ${stat("Perdas com defeito", money(C.perdas), "custo de peças que voltaram com defeito", C.perdas ? "stat--warn" : "")}
              ${stat("Diferença de caixa", C.sobra || C.falta ? `${C.falta ? `-${money(C.falta)}` : ""}${C.falta && C.sobra ? " / " : ""}${C.sobra ? `+${money(C.sobra)}` : ""}` : "Bateu", `${C.caixas} ${C.caixas === 1 ? "caixa" : "caixas"} no período`, C.falta ? "stat--bad" : "")}
              ${stat("Descontos de cupom", money(C.cupons))}
            </div>
            <div class="dash2__cols">
              <div><h3>Compras de fornecedor</h3>
                ${tabela(["Fornecedor", ">Compras", ">Total"], D.compras.fornecedores.map((f) => `<tr><td>${esc(f.nome)}</td><td class="r num">${f.compras}</td><td class="r num">${money(f.total)}</td></tr>`), "Nenhuma entrada de estoque no período.")}
                ${D.compras.total ? `<p class="muted rep__note">Total comprado: ${money(D.compras.total)}${D.compras.semPagamento ? ` · sem pagamento lançado: ${money(D.compras.semPagamento)}` : ""}</p>` : ""}</div>
              <div><h3>Caixas abertos de um dia para o outro</h3>
                ${tabela(["Aberto", "Loja", ">Dias"], C.esquecidos.map((c) => `<tr><td class="num">${dia(c.abertoEm)} ${hora(c.abertoEm)}</td><td>${esc(c.lojaNome)}</td><td class="r num">${c.dias || 1}</td></tr>`), "Nenhum. Todos os caixas foram fechados no mesmo dia.")}</div>
            </div>
          </section>
        </div>
      </section>`;
  }

  function exportarDash() {
    if (!dash) return;
    const D = dash, k = D.kpi;
    const L = [["Top Smart - Dashboard financeiro", D.titulo], [], ["Indicador", "Valor", "Período anterior"],
      ...[["Faturamento", "bruta"], ["Receita líquida", "liquida"], ["CMV", "cmv"], ["Lucro bruto", "lucroBruto"], ["Despesas", "despesas"], ["Lucro líquido", "lucroLiquido"], ["Ticket médio", "ticket"], ["Vendas", "nVendas"]].map(([l, c]) => [l, k[c], D.kpiAnterior[c]]),
      [], ["DRE"], ["Receita bruta", D.dre.bruta], ["Devoluções", -D.dre.devolucoes], ["Cupons", -D.dre.cupons], ["Taxas", -D.dre.taxas], ["Receita líquida", D.dre.liquida], ["CMV", -D.dre.cmv], ["Lucro bruto", D.dre.lucroBruto],
      ...Object.entries(D.dre.despesas).map(([c, v]) => [D.categorias[c] || c, -v]), ["Resultado", D.dre.resultado],
      [], ["Produto", "Qtd", "Faturamento", "Custo", "Lucro", "Margem %"], ...D.produtos.top.map((p) => [p.name, p.qtd, p.valor, p.custo, p.lucro, p.margem])];
    const cel = (c) => (typeof c === "number" ? String(c).replace(".", ",") : `"${String(c ?? "").replace(/"/g, '""')}"`);
    const csv = "﻿" + L.map((l) => l.map(cel).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `dashboard-top-smart-${D.periodo.de}-a-${D.periodo.ate}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ======================================================================
  // EVENTOS
  // ======================================================================
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a");
    if (!t) return;
    const d = t.dataset;
    // estoque
    if (d.estVis) return setParams("estoque", { vis: d.estVis === "posicao" ? null : d.estVis, q: null });
    if (d.estF) return setParams("estoque", { f: d.estF === "todos" ? null : d.estF });
    if (d.estAjustar !== undefined) { ajustando = d.estAjustar || null; return renderEstoque(); }
    // despesas
    if ("despNew" in d) { despEdit = { categoria: "outros", vencimento: hoje() }; pagando = null; renderDespesas(); window.scrollTo({ top: 0, behavior: "smooth" }); $("#desp-form [name=descricao]")?.focus(); return; }
    if ("despCancel" in d) { despEdit = null; return renderDespesas(); }
    if (d.despEdit) { despEdit = { ...desp.despesas.find((x) => x.id === d.despEdit) }; pagando = null; renderDespesas(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (d.despCompra) {
      const c = desp.compras.find((x) => x.id === d.despCompra); if (!c) return;
      despEdit = { categoria: "fornecedor", descricao: `Compra ${c.fornecedor.nome}${c.nota ? ` nota ${c.nota}` : ""}`, valor: c.total, vencimento: hoje(), fornecedorId: c.fornecedor.id, compraId: c.id, lojaId: c.lojaId || "" };
      renderDespesas(); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    if (d.despF) return setParams("despesas", { f: d.despF === "abertas" ? null : d.despF });
    if (d.despPagar !== undefined) { pagando = d.despPagar || null; despEdit = null; return renderDespesas(); }
    if (d.despDel) {
      const x = desp.despesas.find((y) => y.id === d.despDel);
      if (!x || !confirm(`Excluir "${x.descricao}"?`)) return;
      try { await fin(`r=despesas&id=${encodeURIComponent(x.id)}`, "DELETE"); desp.despesas = desp.despesas.filter((y) => y !== x); T().toast("Despesa excluída"); renderDespesas(); } catch (err) { T().toast(err.message); }
      return;
    }
    if (d.despDesfazer) {
      if (!confirm("Voltar esta despesa para a pagar?")) return;
      try { const r = await fin(`r=despesas&acao=desfazer&id=${encodeURIComponent(d.despDesfazer)}`, "POST", { por: por() }); desp.despesas = desp.despesas.map((y) => (y.id === r.despesa.id ? r.despesa : y)); T().toast("Pagamento desfeito"); renderDespesas(); } catch (err) { T().toast(err.message); }
      return;
    }
    // dashboard
    if (d.dashP) return setParams("dashboard", { p: d.dashP, de: null, ate: null });
    if ("dashPrint" in d) { document.body.classList.add("printing-report"); window.print(); document.body.classList.remove("printing-report"); return; }
    if ("dashCsv" in d) return exportarDash();
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    const filtra = (aba, render) => {
      const p = params(); if (t.value) p.set("q", t.value); else p.delete("q");
      history.replaceState(null, "", `#/admin?${p}`);
      const pos = t.selectionStart; render(); const n = document.getElementById(t.id); n?.focus(); n?.setSelectionRange(pos, pos);
    };
    if (t.id === "est-q") return filtra("estoque", renderEstoque);
    if (t.id === "desp-q") return filtra("despesas", renderDespesas);
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.closest("#dash-form") && t.type === "date") return setParams("dashboard", { p: "custom", de: t.form.de.value, ate: t.form.ate.value });
    if (t.dataset.dashLoja !== undefined) return setParams("dashboard", { loja: t.value });
    if (t.dataset.despCat !== undefined || t.dataset.despForn !== undefined) {
      // guarda o que já foi digitado e redesenha (mostra ou esconde os campos de fornecedor)
      const f = t.form;
      Object.assign(despEdit, { descricao: f.descricao.value, categoria: f.categoria.value, valor: parseMoney(f.valor.value), vencimento: f.vencimento.value, lojaId: f.lojaId.value, obs: f.obs.value, recorrente: f.recorrente.checked ? "mensal" : null, fornecedorId: f.fornecedorId?.value || null, compraId: t.dataset.despForn !== undefined ? null : f.compraId?.value || null });
      return renderDespesas();
    }
    if (t.dataset.despCompra !== undefined) {
      const opt = t.selectedOptions[0];
      if (opt?.dataset.valor && !parseMoney(t.form.valor.value)) t.form.valor.value = fmtMoneyInput(+opt.dataset.valor);
    }
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.id === "est-ajuste-form") {
      e.preventDefault();
      const contagem = parseInt(f.contagem.value, 10);
      if (!(contagem >= 0)) { f.contagem.focus(); return T().toast("Informe a quantidade contada"); }
      const id = f.dataset.id;
      try {
        const r = await fin("r=estoque&acao=ajuste", "POST", { productId: id, contagem, motivo: f.motivo.value, por: por() });
        T().aplicarEstoque({ [id]: r.stock });
        T().toast(r.igual ? "O estoque já estava certo" : "Estoque ajustado");
        ajustando = null; est = await fin("r=estoque"); renderEstoque();
      } catch (err) { T().toast(err.message); }
      return;
    }
    if (f.id === "desp-form") {
      e.preventDefault();
      const body = {
        descricao: f.descricao.value.trim(), categoria: f.categoria.value, valor: parseMoney(f.valor.value), vencimento: f.vencimento.value,
        lojaId: f.lojaId.value, obs: f.obs.value.trim(), recorrente: f.recorrente.checked ? "mensal" : null,
        fornecedorId: f.fornecedorId?.value || null, compraId: f.compraId?.value || null, por: por(),
      };
      T().setErr(f, "descricao", body.descricao.length < 2 ? "Descreva a despesa" : "");
      T().setErr(f, "valor", body.valor > 0 ? "" : "Informe o valor");
      if (body.descricao.length < 2 || !(body.valor > 0)) return;
      const btn = f.querySelector("button.btn--primary"); btn.disabled = true;
      try {
        const r = despEdit.id ? await fin(`r=despesas&id=${encodeURIComponent(despEdit.id)}`, "PUT", body) : await fin("r=despesas", "POST", body);
        desp.despesas = despEdit.id ? desp.despesas.map((y) => (y.id === r.despesa.id ? r.despesa : y)) : [r.despesa, ...desp.despesas];
        T().toast(despEdit.id ? "Despesa salva" : "Despesa lançada");
        despEdit = null; renderDespesas();
      } catch (err) { btn.disabled = false; $("#desp-err").textContent = err.message; }
      return;
    }
    if (f.id === "desp-pay-form") {
      e.preventDefault();
      const doCaixa = f.doCaixa.checked;
      if (doCaixa && f.forma.value !== "dinheiro") return T().toast("Só sai da gaveta o que foi pago em dinheiro. Mude a forma para Dinheiro.");
      const btn = f.querySelector("button.btn--primary"); btn.disabled = true;
      try {
        const x = desp.despesas.find((y) => y.id === f.dataset.id);
        const r = await fin(`r=despesas&acao=pagar&id=${encodeURIComponent(f.dataset.id)}`, "POST", { pagoEm: f.pagoEm.value, forma: f.forma.value, doCaixa, lojaId: x?.lojaId || X.lojaId(), por: por() });
        desp.despesas = desp.despesas.map((y) => (y.id === r.despesa.id ? r.despesa : y));
        if (r.proxima) desp.despesas.unshift(r.proxima);
        T().toast(r.proxima ? `Paga. A de ${diaLongo(r.proxima.vencimento)} já ficou lançada.` : doCaixa ? "Paga e registrada como retirada no caixa" : "Despesa paga");
        pagando = null; renderDespesas();
      } catch (err) { btn.disabled = false; T().toast(err.message); }
    }
  });

  Object.assign(window.TS_EXT.tabs, { estoque: viewEstoque, despesas: viewDespesas, dashboard: viewDashboard });
})();
