// Ponto de venda da Top Smart: início do painel, venda balcão, caixa diário, relatórios e equipe.
// Registra as telas em window.TS_EXT antes do app.js montar o painel; usa as funções de window.TS.
(() => {
  const T = () => window.TS;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => T().esc(s);
  const money = (v) => T().money(v || 0);
  const icon = (id) => T().icon(id);
  // carregado antes do app.js: usa o localStorage direto, sem depender de window.TS
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem espaço ou bloqueado */ } },
  };
  const REMOTE = location.protocol.startsWith("http");

  const FORMAS = { dinheiro: "Dinheiro", pix: "Pix", credito: "Crédito", debito: "Débito", fiado: "Fiado" };
  const FORMA_IC = { dinheiro: "i-cash", pix: "i-pix", credito: "i-card", debito: "i-card", fiado: "i-clock" };
  const parseMoney = (v) => {
    const s = String(v ?? "").trim();
    if (!s) return 0;
    const n = parseFloat(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const fmtMoneyInput = (v) => (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",");
  const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dia = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const diaLongo = (iso) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  async function api(query, method = "GET", body) {
    if (!REMOTE) throw new Error("O ponto de venda precisa do site publicado (não funciona abrindo o arquivo direto).");
    return T().fetchJSON(`/api/pdv?${query}`, method, body, true);
  }

  // ---------- lojas, vendedores e caixa aberto ----------
  let setup = null;
  let setupLoading = null;
  async function loadSetup(force) {
    if (setup && !force) return setup;
    setupLoading ||= api("r=setup").then((s) => { setup = s; return s; }).finally(() => { setupLoading = null; });
    return setupLoading;
  }
  const lojaId = () => {
    const id = store.get("ts_loja", null);
    return setup?.lojas.some((l) => l.id === id) ? id : setup?.lojas[0]?.id;
  };
  const loja = () => setup?.lojas.find((l) => l.id === lojaId());
  const caixaAberto = () => setup?.abertos?.[lojaId()] || null;
  const vendedoresDaLoja = () => (setup?.vendedores || []).filter((v) => v.lojaId === lojaId() && v.ativo);

  const lojaPicker = () => setup && setup.lojas.length > 1
    ? `<label class="loja-pick"><span class="sr-only">Loja</span>${icon("i-store")}<select data-pdv-loja>${setup.lojas.map((l) => `<option value="${esc(l.id)}" ${l.id === lojaId() ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select></label>`
    : setup ? `<span class="loja-pick loja-pick--static">${icon("i-store")}${esc(loja()?.nome)}</span>` : "";

  // tela que carrega dados do servidor: mostra esqueleto, depois desenha
  function asyncView(id, skeleton, load) {
    queueMicrotask(async () => {
      try {
        await load();
      } catch (err) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="empty">${esc(err.message)}${err.status === 401 ? "" : `<br><button class="btn btn--ghost btn--sm" data-pdv-retry style="margin-top:12px">Tentar de novo</button>`}</div>`;
      }
    });
    return `<div id="${id}">${skeleton}</div>`;
  }
  const skel = (rows = 3) => `<div class="skel">${Array.from({ length: rows }, () => '<div class="skel__row"></div>').join("")}</div>`;
  const paint = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  // ---------- resumo/fechamento do caixa ----------
  const caixaDias = (c) => Math.floor((Date.now() - Date.parse(c.abertoEm)) / 86400000);
  const abertoOutroDia = (c) => c && new Date(c.abertoEm).toDateString() !== new Date().toDateString();

  function fechamentoTexto(c, r) {
    const f = r.porForma;
    const linhas = [
      `*FECHAMENTO ${c.lojaNome.toUpperCase()} ${dia(c.fechadoEm || new Date().toISOString())}*`,
      "",
      `Fundo de caixa: ${money(c.fundo)}`,
      `Vendas: ${money(r.liquido)} (${r.qtdVendas} ${r.qtdVendas === 1 ? "venda" : "vendas"})`,
      `Pix: ${money(f.pix)}`,
      `Dinheiro: ${money(f.dinheiro)}`,
    ];
    if (f.credito) linhas.push(`Crédito: ${money(f.credito)}`);
    if (f.debito) linhas.push(`Débito: ${money(f.debito)}`);
    if (f.fiado) linhas.push(`Fiado (a receber): ${money(f.fiado)}`);
    if (r.devolvido) linhas.push(`Devoluções: -${money(r.devolvido)}`);
    if (r.sangrias) linhas.push(`Retiradas: -${money(r.sangrias)}`);
    if (r.suprimentos) linhas.push(`Reforços: ${money(r.suprimentos)}`);
    linhas.push("", `Dinheiro na gaveta: ${money(r.dinheiroEsperado)}`);
    if (c.contado != null) {
      linhas.push(`Contado: ${money(c.contado)}`);
      if (r.diferenca) linhas.push(`${r.diferenca > 0 ? "Sobra" : "Falta"}: ${money(Math.abs(r.diferenca))}`);
    }
    if (c.obs) linhas.push("", `Obs.: ${c.obs}`);
    return linhas.join("\n");
  }

  // ======================================================================
  // INÍCIO
  // ======================================================================
  function viewInicio() {
    const s = T().session();
    const h = new Date().getHours();
    const saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
    return `<div class="admin-head"><div><h1>${saud}, ${esc((s?.name || "").split(" ")[0] || "admin")}</h1><p class="muted">${diaLongo(new Date().toISOString())}</p></div><div id="inicio-loja"></div></div>
      ${asyncView("inicio-body", `<div class="dash">${skel(4)}</div>`, async () => {
        await loadSetup(true);
        paint("inicio-loja", lojaPicker());
        const c = caixaAberto();
        const desde = new Date(); desde.setDate(desde.getDate() - 6); desde.setHours(0, 0, 0, 0);
        const { vendas } = await api(`r=vendas&lojaId=${encodeURIComponent(lojaId())}&from=${desde.toISOString()}`);
        const ok = vendas.filter((v) => v.status !== "CANCELADA");
        const hoje = new Date().toDateString();
        const deHoje = ok.filter((v) => new Date(v.criadaEm).toDateString() === hoje);
        const totalDia = (list) => list.reduce((s, v) => s + (v.tipo === "devolucao" ? -v.total : v.total), 0);
        const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(desde); d.setDate(d.getDate() + i); return d; });
        const porDia = dias.map((d) => totalDia(ok.filter((v) => new Date(v.criadaEm).toDateString() === d.toDateString())));
        const max = Math.max(...porDia, 1);
        const porForma = {};
        deHoje.forEach((v) => v.pagamentos.forEach((p) => (porForma[p.forma] = (porForma[p.forma] || 0) + (v.tipo === "devolucao" ? -p.valor : p.valor))));
        const prods = T().products;
        const semEstoque = prods.filter((p) => p.stock <= 0).length;

        paint("inicio-body", `
          ${c && abertoOutroDia(c) ? `<div class="alert alert--warn">${icon("i-clock")}<div><strong>O caixa está aberto desde ${dia(c.abertoEm)}, ${hora(c.abertoEm)}.</strong> Feche-o e abra o de hoje para as vendas caírem no dia certo.</div><a class="btn btn--dark btn--sm" href="#/admin?aba=caixa">Ir para o caixa</a></div>` : ""}
          <div class="dash">
            <section class="dash__caixa ${c ? "is-open" : ""}">
              <span class="dash__label">Caixa · ${esc(loja()?.nome)}</span>
              ${c ? `<strong class="dash__big">Aberto</strong><span class="muted">desde ${hora(c.abertoEm)}${abertoOutroDia(c) ? ` de ${dia(c.abertoEm)}` : ""} · fundo ${money(c.fundo)}</span>
                    <div class="dash__actions"><a class="btn btn--primary btn--sm" href="#/admin?aba=balcao">${icon("i-store")}Nova venda</a><a class="btn btn--ghost btn--sm" href="#/admin?aba=caixa">Ver caixa</a></div>`
                  : `<strong class="dash__big">Fechado</strong><span class="muted">Abra o caixa para começar a vender.</span>
                    <div class="dash__actions"><a class="btn btn--primary btn--sm" href="#/admin?aba=caixa">${icon("i-cash")}Abrir caixa</a></div>`}
            </section>
            <section class="dash__hoje">
              <span class="dash__label">Vendido hoje</span>
              <strong class="dash__big num">${money(totalDia(deHoje))}</strong>
              <span class="muted">${deHoje.filter((v) => v.tipo !== "devolucao").length} ${deHoje.length === 1 ? "venda" : "vendas"} no balcão</span>
              ${Object.keys(porForma).length ? `<ul class="dash__formas">${Object.entries(porForma).map(([f, v]) => `<li>${icon(FORMA_IC[f])}<span>${FORMAS[f]}</span><b class="num">${money(v)}</b></li>`).join("")}</ul>` : ""}
            </section>
            <section class="dash__semana">
              <span class="dash__label">Últimos 7 dias</span>
              <div class="bars" role="img" aria-label="Vendas por dia nos últimos 7 dias">
                ${porDia.map((v, i) => `<div class="bars__col ${i === 6 ? "is-today" : ""}" title="${dias[i].toLocaleDateString("pt-BR")}: ${money(v)}"><span class="bars__val num">${v ? money(v).replace("R$ ", "") : ""}</span><span class="bars__bar" style="--h:${Math.max(2, (v / max) * 100)}%"></span><span class="bars__day">${dias[i].toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}</span></div>`).join("")}
              </div>
            </section>
            <nav class="dash__links" aria-label="Atalhos">
              <a href="#/admin?aba=pedidos"><span>Pedidos do site novos</span><b class="num">${T().newOrders ?? "…"}</b></a>
              <a href="#/admin?aba=avise-me"><span>Avise-me aguardando</span><b class="num">${T().pendingAlerts ?? "…"}</b></a>
              <a href="#/admin?aba=produtos"><span>Produtos sem estoque</span><b class="num">${semEstoque}</b></a>
              <a href="#/admin?aba=relatorios"><span>Relatório do mês</span>${icon("i-arrow")}</a>
            </nav>
          </div>`);
      })}`;
  }

  // ======================================================================
  // VENDA BALCÃO
  // ======================================================================
  const novaVenda = () => ({ tipo: "venda", itens: [], cliente: null, vendedorId: store.get("ts_pdv_vendedor", ""), obs: "", pagamentos: [], etapa: "itens" });
  let sale = store.get("ts_pdv_sale", null) || novaVenda();
  const saveSale = () => store.set("ts_pdv_sale", sale);
  const espera = () => store.get("ts_pdv_espera", []);

  const precoPara = (p) => sale.cliente?.tipo === "lojista" ? (p.priceLoj ?? p.price) : (p.promo ?? p.price);
  const totalItens = () => sale.itens.reduce((s, it) => s + Math.max(0, it.unit * it.qty - (it.desconto || 0)), 0);
  const totalDescontos = () => sale.itens.reduce((s, it) => s + (it.desconto || 0), 0);
  const totalPago = () => sale.pagamentos.reduce((s, p) => s + (p.valor || 0), 0);

  function viewBalcao() {
    return `<div class="admin-head"><div><h1>Venda balcão</h1></div><div id="pdv-loja"></div></div>
      ${asyncView("pdv-root", `<div class="pdv">${skel(5)}</div>`, async () => {
        await loadSetup(true);
        paint("pdv-loja", lojaPicker());
        renderPdv();
      })}`;
  }

  function renderPdv() {
    const root = $("#pdv-root");
    if (!root) return;
    const c = caixaAberto();
    if (!c) {
      root.innerHTML = abrirCaixaHTML("Abra o caixa desta loja para começar a vender.");
      return;
    }
    if (sale.vendedorId && !vendedoresDaLoja().some((v) => v.id === sale.vendedorId)) sale.vendedorId = "";
    const devol = sale.tipo === "devolucao";
    root.innerHTML = `
      ${abertoOutroDia(c) ? `<div class="alert alert--warn">${icon("i-clock")}<div>Caixa aberto desde <strong>${dia(c.abertoEm)}</strong>. As vendas de hoje vão entrar nele.</div><a class="btn btn--ghost btn--sm" href="#/admin?aba=caixa">Fechar caixa</a></div>` : ""}
      <div class="pdv ${devol ? "pdv--devol" : ""}">
        <section class="pdv__items" aria-label="Itens">
          <div class="pdv__bar">
            <div class="seg" role="radiogroup" aria-label="Tipo de operação">
              <button role="radio" aria-checked="${!devol}" class="${!devol ? "is-on" : ""}" data-pdv-tipo="venda">Venda</button>
              <button role="radio" aria-checked="${devol}" class="${devol ? "is-on" : ""}" data-pdv-tipo="devolucao">${icon("i-undo")}Devolução</button>
            </div>
            ${espera().length ? `<div class="espera">${icon("i-pause")}<span>Em espera:</span>${espera().map((e, i) => `<button class="chip" data-pdv-resume="${i}" title="Retomar">${esc(e.cliente?.nome || "Ao consumidor")} · ${e.itens.length} ${e.itens.length === 1 ? "item" : "itens"}</button>`).join("")}</div>` : ""}
          </div>
          <div class="pdv__search">
            ${icon("i-search")}
            <input id="pdv-q" type="search" autocomplete="off" placeholder="${devol ? "Produto devolvido: nome ou código" : "Buscar produto por nome ou código"}" aria-label="Buscar produto" aria-controls="pdv-results" aria-expanded="false" ${sale.etapa === "pagamento" ? "disabled" : ""}>
            <kbd>F2</kbd>
            <ul class="pdv__results" id="pdv-results" role="listbox" hidden></ul>
          </div>
          ${sale.itens.length ? `
          <div class="table-wrap"><table class="pdv__table">
            <thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Preço un.</th><th class="r">Desconto</th><th class="r">Subtotal</th><th></th></tr></thead>
            <tbody>${sale.itens.map((it, i) => {
              const p = T().prodBy(it.productId);
              const pouco = !devol && p && it.qty > p.stock;
              return `<tr>
                <td><b>${esc(it.name)}${it.code ? ` - ${esc(it.code)}` : ""}</b>${it.variant ? `<small class="muted"> (${esc(it.variant)})</small>` : ""}${pouco ? `<small class="warn-text">Só ${p.stock} em estoque</small>` : ""}</td>
                <td class="r"><input class="cell-in cell-in--qty num" type="number" min="1" step="1" value="${it.qty}" data-pdv-item="${i}" data-field="qty" aria-label="Quantidade" ${sale.etapa === "pagamento" ? "disabled" : ""}></td>
                <td class="r"><input class="cell-in num" inputmode="decimal" value="${fmtMoneyInput(it.unit)}" data-pdv-item="${i}" data-field="unit" aria-label="Preço unitário" ${sale.etapa === "pagamento" ? "disabled" : ""}></td>
                <td class="r"><input class="cell-in num" inputmode="decimal" value="${it.desconto ? fmtMoneyInput(it.desconto) : ""}" placeholder="0,00" data-pdv-item="${i}" data-field="desconto" aria-label="Desconto" ${sale.etapa === "pagamento" ? "disabled" : ""}></td>
                <td class="r num"><b>${money(Math.max(0, it.unit * it.qty - (it.desconto || 0)))}</b></td>
                <td class="r">${sale.etapa === "pagamento" ? "" : `<button class="icon-btn icon-btn--sm" data-pdv-del="${i}" aria-label="Remover ${esc(it.name)}">${icon("i-trash")}</button>`}</td>
              </tr>`;
            }).join("")}</tbody>
          </table></div>` : `<div class="pdv__empty">${icon(devol ? "i-undo" : "i-search")}<p>${devol ? "Busque o produto que o cliente está devolvendo. O valor sai do caixa e o item volta para o estoque." : "Busque o produto pelo nome ou código e aperte Enter para adicionar."}</p></div>`}
        </section>
        <aside class="pdv__side" aria-label="Fechamento">${sale.etapa === "pagamento" ? pagamentoHTML() : resumoVendaHTML()}</aside>
      </div>`;
    if (sale.etapa === "pagamento") $("#pdv-pay-0")?.focus(); else $("#pdv-q")?.focus();
  }

  function clienteHTML() {
    if (sale.cliente) {
      return `<div class="cli is-set"><div><b>${esc(sale.cliente.nome)}</b>${sale.cliente.tipo === "lojista" ? ' <span class="tag tag--pro">Lojista</span>' : ""}<small class="muted">${esc([sale.cliente.doc, sale.cliente.telefone].filter(Boolean).join(" · ")) || "sem documento"}</small></div><button class="text-btn" data-pdv-cli-clear>Trocar</button></div>`;
    }
    return `<div class="cli"><input id="pdv-cli" type="search" autocomplete="off" placeholder="Ao consumidor" aria-label="Cliente"><ul class="pdv__results" id="pdv-cli-results" role="listbox" hidden></ul></div>`;
  }

  function resumoVendaHTML() {
    const vend = vendedoresDaLoja();
    const devol = sale.tipo === "devolucao";
    return `
      <label class="field"><span>Cliente</span>${clienteHTML()}</label>
      <label class="field"><span>Vendedor</span>
        ${vend.length ? `<select id="pdv-vend" data-pdv-vend><option value="">Escolha quem vendeu</option>${vend.map((v) => `<option value="${esc(v.id)}" ${v.id === sale.vendedorId ? "selected" : ""}>${esc(v.nome)}</option>`).join("")}</select><span class="err" id="pdv-vend-err"></span>`
          : `<span class="notice">Nenhum vendedor nesta loja. <a href="#/admin?aba=equipe">Cadastrar vendedores</a></span>`}
      </label>
      <dl class="totals">
        <div><dt>Itens</dt><dd class="num">${sale.itens.reduce((s, it) => s + it.qty, 0)}</dd></div>
        ${totalDescontos() ? `<div><dt>Descontos</dt><dd class="num">-${money(totalDescontos())}</dd></div>` : ""}
        <div class="totals__main"><dt>${devol ? "Total a devolver" : "Total"}</dt><dd class="num">${money(totalItens())}</dd></div>
      </dl>
      <button class="btn ${devol ? "btn--dark" : "btn--primary"} btn--block" data-pdv-pagar ${sale.itens.length ? "" : "disabled"}>${devol ? "Devolver valor" : "Ir para o pagamento"}<kbd>F9</kbd></button>
      ${sale.itens.length ? `<div class="pdv__side-actions">${devol ? "" : `<button class="text-btn" data-pdv-hold>${icon("i-pause")}Deixar em espera</button>`}<button class="text-btn" data-pdv-clear>Limpar</button></div>` : ""}`;
  }

  function pagamentoHTML() {
    const total = totalItens(), pago = totalPago();
    const falta = Math.max(0, Math.round((total - pago) * 100) / 100);
    const troco = Math.max(0, Math.round((pago - total) * 100) / 100);
    const devol = sale.tipo === "devolucao";
    const formas = Object.entries(FORMAS).filter(([f]) => !(devol && f === "fiado"));
    return `
      <div class="pay__head"><button class="text-btn" data-pdv-voltar>${icon("i-left")}Itens</button><span class="pay__total num">${money(total)}</span></div>
      <p class="muted pay__hint">${devol ? "Como o valor volta para o cliente?" : "Escolha a forma de pagamento. Para dividir, adicione outra forma."}</p>
      <div class="pay__quick">${formas.map(([f, n]) => `<button class="pay__chip" data-pdv-forma="${f}">${icon(FORMA_IC[f])}${n}</button>`).join("")}</div>
      <div class="pay__rows">${sale.pagamentos.map((p, i) => `
        <div class="pay__row">
          <span class="pay__forma">${icon(FORMA_IC[p.forma])}${FORMAS[p.forma]}</span>
          <input id="pdv-pay-${i}" class="cell-in num" inputmode="decimal" value="${fmtMoneyInput(p.valor)}" data-pdv-pay="${i}" aria-label="Valor em ${FORMAS[p.forma]}">
          <button class="icon-btn icon-btn--sm" data-pdv-pay-del="${i}" aria-label="Remover ${FORMAS[p.forma]}">${icon("i-x")}</button>
        </div>`).join("") || `<p class="pay__none">Nenhuma forma escolhida.</p>`}
      </div>
      <dl class="totals">
        <div><dt>Recebido</dt><dd class="num">${money(pago)}</dd></div>
        ${falta ? `<div class="totals__falta"><dt>Falta</dt><dd class="num">${money(falta)}</dd></div>` : ""}
        ${troco ? `<div class="totals__troco"><dt>Troco</dt><dd class="num">${money(troco)}</dd></div>` : ""}
      </dl>
      <label class="field"><span>Observação <span class="opt">(sai na notinha)</span></span><input id="pdv-obs" maxlength="300" value="${esc(sale.obs)}" placeholder="Ex.: garantia de 90 dias"></label>
      <button class="btn ${devol ? "btn--dark" : "btn--primary"} btn--block" data-pdv-concluir ${falta || !sale.pagamentos.length ? "disabled" : ""}>${icon("i-check")}${devol ? "Concluir devolução" : "Concluir venda"}<kbd>Enter</kbd></button>
      <span class="err" id="pdv-pay-err"></span>`;
  }

  // ---- busca de produtos ----
  let results = [], resultIdx = 0;
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  function buscar(q) {
    const n = norm(q).trim();
    if (!n) return [];
    const terms = n.split(/\s+/);
    return T().products
      .map((p) => {
        const hay = norm(`${p.name} ${p.code} ${p.brand} ${(p.models || []).join(" ")}`);
        if (!terms.every((t) => hay.includes(t))) return null;
        const exact = norm(p.code) === n ? 0 : norm(p.code).startsWith(n) ? 1 : 2;
        return { p, score: exact };
      })
      .filter(Boolean).sort((a, b) => a.score - b.score || (b.p.stock > 0) - (a.p.stock > 0)).slice(0, 8).map((x) => x.p);
  }
  function renderResults() {
    const ul = $("#pdv-results"), q = $("#pdv-q");
    if (!ul) return;
    ul.hidden = !results.length && !q.value.trim();
    q.setAttribute("aria-expanded", String(!ul.hidden));
    ul.innerHTML = results.length ? results.map((p, i) => `
      <li role="option" id="pdv-r-${i}" aria-selected="${i === resultIdx}" class="${i === resultIdx ? "is-sel" : ""}" data-pdv-add="${esc(p.id)}">
        <span class="row__thumb">${T().media(p)}</span>
        <span class="res__name"><b>${esc(p.name)}</b><small class="muted">${esc(p.code)} · ${p.stock > 0 ? `${p.stock} em estoque` : '<span class="warn-text">sem estoque</span>'}</small></span>
        <span class="num res__price">${money(precoPara(p))}</span>
      </li>`).join("") : `<li class="res__none">Nada encontrado para “${esc(q.value)}”.</li>`;
    q.setAttribute("aria-activedescendant", results.length ? `pdv-r-${resultIdx}` : "");
  }
  function addProduto(id) {
    const p = T().prodBy(id);
    if (!p) return;
    const variant = p.variants ? p.variants[0][0] : null;
    const delta = p.variants ? p.variants[0][1] : 0;
    const existing = sale.itens.find((it) => it.productId === p.id && it.variant === variant);
    if (existing) existing.qty++;
    else sale.itens.push({ productId: p.id, name: p.name, code: p.code, variant, qty: 1, unit: precoPara(p) + delta, desconto: 0, custo: p.cost || 0 });
    if (sale.tipo === "venda" && p.stock <= 0) T().toast(`${p.name} está sem estoque no sistema. Confira antes de vender.`);
    results = []; saveSale(); renderPdv();
  }

  // ---- clientes (cadastros do site + clientes de vendas anteriores) ----
  function clientesConhecidos() {
    const list = T().users().map((u) => ({
      nome: u.type === "lojista" ? (u.fantasia || u.razao) : u.name, doc: u.cnpj || u.cpf || "", telefone: u.phone || "", tipo: u.type === "lojista" ? "lojista" : "cliente",
    }));
    store.get("ts_pdv_clientes", []).forEach((c) => { if (!list.some((x) => norm(x.nome) === norm(c.nome))) list.push(c); });
    return list;
  }
  function renderCliResults(q) {
    const ul = $("#pdv-cli-results");
    if (!ul) return;
    const n = norm(q).trim();
    if (!n) { ul.hidden = true; return; }
    const found = clientesConhecidos().filter((c) => norm(`${c.nome} ${c.doc} ${c.telefone}`).includes(n)).slice(0, 6);
    ul.hidden = false;
    ul.innerHTML = found.map((c, i) => `<li role="option" data-pdv-cli="${i}"><span class="res__name"><b>${esc(c.nome)}</b><small class="muted">${esc([c.doc, c.telefone].filter(Boolean).join(" · "))}</small></span>${c.tipo === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : ""}</li>`).join("")
      + `<li role="option" data-pdv-cli-new><span class="res__name"><b>Usar “${esc(q.trim())}”</b><small class="muted">Cliente sem cadastro</small></span></li>`;
    ul._found = found;
  }
  function setCliente(c) {
    sale.cliente = c;
    // ao trocar para lojista (ou voltar para consumidor), recalcula os preços que não foram editados à mão
    sale.itens.forEach((it) => {
      const p = T().prodBy(it.productId);
      if (p && !it.editado) it.unit = precoPara(p) + (p.variants?.find(([n]) => n === it.variant)?.[1] || 0);
    });
    if (c && !T().users().some((u) => norm(u.name || u.razao) === norm(c.nome))) {
      const rec = store.get("ts_pdv_clientes", []).filter((x) => norm(x.nome) !== norm(c.nome));
      store.set("ts_pdv_clientes", [c, ...rec].slice(0, 200));
    }
    saveSale(); renderPdv();
  }

  // ---- concluir ----
  async function concluir() {
    const btn = $("[data-pdv-concluir]");
    if (!btn || btn.disabled) return;
    sale.obs = $("#pdv-obs")?.value.trim() || "";
    btn.disabled = true;
    try {
      const { venda } = await api("r=venda", "POST", {
        lojaId: lojaId(), tipo: sale.tipo, vendedorId: sale.vendedorId, cliente: sale.cliente, obs: sale.obs,
        itens: sale.itens.map(({ productId, name, code, variant, qty, unit, desconto, custo }) => ({ productId, name, code, variant, qty, unit, desconto, custo })),
        pagamentos: sale.pagamentos,
      });
      // estoque local: venda tira, devolução devolve
      sale.itens.forEach((it) => {
        const p = T().prodBy(it.productId);
        if (p) p.stock = Math.max(0, p.stock + (sale.tipo === "devolucao" ? it.qty : -it.qty));
      });
      T().saveProducts();
      store.set("ts_pdv_vendedor", sale.vendedorId);
      sale = novaVenda(); saveSale();
      renderPdv();
      mostrarNota(venda);
    } catch (err) {
      btn.disabled = false;
      const e = $("#pdv-pay-err"); if (e) e.textContent = err.message;
      if (err.status === 409) { await loadSetup(true); renderPdv(); T().toast(err.message); }
    }
  }

  // ======================================================================
  // NOTINHA (cupom da venda): tela, impressão, imagem e WhatsApp
  // ======================================================================
  function notaLinhas(v) {
    const L = [];
    const devol = v.tipo === "devolucao";
    L.push({ t: "TOP SMART", a: "c", b: 1, s: 1.5 }, { t: v.lojaNome, a: "c" }, { t: "WhatsApp (33) 99941-4255", a: "c" }, { sep: 1 });
    L.push({ t: `${devol ? "DEVOLUÇÃO" : "VENDA"} ${v.code}`, a: "c", b: 1, s: 1.2 });
    L.push({ l: "Data", r: `${new Date(v.criadaEm).toLocaleDateString("pt-BR")} ${hora(v.criadaEm)}` });
    L.push({ l: "Cliente", r: v.cliente?.nome || "Ao consumidor" });
    if (v.cliente?.doc) L.push({ l: v.cliente.tipo === "lojista" ? "CNPJ" : "CPF", r: v.cliente.doc });
    L.push({ l: "Vendedor", r: v.vendedor.nome }, { sep: 1 });
    v.itens.forEach((it) => {
      L.push({ t: `${it.qty}x ${it.name}${it.code ? ` - ${it.code}` : ""}${it.variant ? ` (${it.variant})` : ""}`, wrap: 1 });
      L.push({ l: `   ${it.qty} x ${money(it.unit)}${it.desconto ? ` - desc. ${money(it.desconto)}` : ""}`, r: money(it.sub) });
    });
    L.push({ sep: 1 }, { l: devol ? "TOTAL DEVOLVIDO" : "TOTAL", r: money(v.total), b: 1, s: 1.2 }, { sep: 1 });
    v.pagamentos.forEach((p) => L.push({ l: FORMAS[p.forma], r: money(p.recebido ?? p.valor) }));
    if (v.troco) L.push({ l: "Troco", r: money(v.troco) });
    if (v.pagamentos.some((p) => p.forma === "fiado")) L.push({ t: "Valor no fiado: a pagar na loja.", a: "c" });
    if (v.obs) L.push({ sep: 1 }, { t: `Obs.: ${v.obs}`, wrap: 1 });
    L.push({ sep: 1 }, { t: "Obrigado pela preferência!", a: "c" }, { t: "Aqui tem inovação!", a: "c" });
    return L;
  }
  function notaHTML(v) {
    const rows = notaLinhas(v).map((x) => {
      if (x.sep) return '<div class="rc__cut"></div>';
      if (x.l !== undefined) return `<div class="rc__row ${x.b ? "rc__row--b" : ""}"><span>${esc(x.l)}</span><span>${esc(x.r)}</span></div>`;
      return `<div class="rc__line rc__line--${x.a || "l"} ${x.b ? "rc__line--b" : ""}" ${x.s ? `style="font-size:${x.s}em"` : ""}>${esc(x.t)}</div>`;
    }).join("");
    return `<div class="receipt-wrap"><article class="receipt nota" id="rc-${esc(v.code)}">${rows}</article></div>`;
  }
  function notaTexto(v) {
    const devol = v.tipo === "devolucao";
    return [
      `*${devol ? "DEVOLUÇÃO" : "VENDA"} ${v.code}*`, `${v.lojaNome} · ${new Date(v.criadaEm).toLocaleDateString("pt-BR")} ${hora(v.criadaEm)}`, "",
      `Cliente: ${v.cliente?.nome || "Ao consumidor"}`, `Vendedor: ${v.vendedor.nome}`, "",
      ...v.itens.map((it) => `*${it.qty}x* ${it.name}${it.code ? ` - ${it.code}` : ""}${it.variant ? ` (${it.variant})` : ""} - *${money(it.sub)}*`), "",
      `Total: *${money(v.total)}*`,
      `Pagamento: ${v.pagamentos.map((p) => `${FORMAS[p.forma]} ${money(p.recebido ?? p.valor)}`).join(" + ")}${v.troco ? ` (troco ${money(v.troco)})` : ""}`,
      ...(v.obs ? ["", `Obs.: ${v.obs}`] : []),
    ].join("\n");
  }

  // desenha a notinha num canvas (PNG) para mandar como imagem no WhatsApp
  function notaPNG(v) {
    const W = 600, pad = 36, base = 22, lh = 1.45;
    const c = document.createElement("canvas"), ctx = c.getContext("2d");
    const font = (s = 1, b) => `${b ? "700" : "400"} ${Math.round(base * s)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    const linhas = [];
    const wrap = (text, f) => {
      ctx.font = f; const out = []; let cur = "";
      for (const w of text.split(" ")) { const t = cur ? `${cur} ${w}` : w; if (ctx.measureText(t).width > W - pad * 2 && cur) { out.push(cur); cur = w; } else cur = t; }
      out.push(cur); return out;
    };
    for (const x of notaLinhas(v)) {
      if (x.sep) { linhas.push({ sep: 1, h: base }); continue; }
      const f = font(x.s, x.b);
      if (x.l !== undefined) { linhas.push({ ...x, f, h: base * (x.s || 1) * lh }); continue; }
      wrap(x.t, f).forEach((t) => linhas.push({ ...x, t, f, h: base * (x.s || 1) * lh }));
    }
    const H = pad * 2 + linhas.reduce((s, x) => s + x.h, 0);
    c.width = W; c.height = H;
    ctx.fillStyle = "#fffef9"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1a1a1a"; ctx.textBaseline = "top";
    let y = pad;
    for (const x of linhas) {
      if (x.sep) {
        ctx.strokeStyle = "#b9b9b9"; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pad, y + x.h / 2); ctx.lineTo(W - pad, y + x.h / 2); ctx.stroke();
      } else if (x.l !== undefined) {
        ctx.font = x.f; ctx.textAlign = "left"; ctx.fillText(x.l, pad, y); ctx.textAlign = "right"; ctx.fillText(x.r, W - pad, y);
      } else {
        ctx.font = x.f; ctx.textAlign = x.a === "c" ? "center" : "left"; ctx.fillText(x.t, x.a === "c" ? W / 2 : pad, y);
      }
      y += x.h;
    }
    return new Promise((res) => c.toBlob(res, "image/png"));
  }

  let notaAtual = null;
  function mostrarNota(v) {
    notaAtual = v;
    let dlg = $("#nota-modal");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "nota-modal"; dlg.className = "modal modal--nota";
      dlg.setAttribute("aria-labelledby", "nota-title");
      document.body.append(dlg);
    }
    const tel = T().digits(v.cliente?.telefone);
    dlg.innerHTML = `
      <div class="nota__head"><div class="order-badge">${icon("i-check")}${v.tipo === "devolucao" ? "Devolução registrada" : "Venda concluída"}</div><button class="icon-btn icon-btn--sm" data-close-modal aria-label="Fechar">${icon("i-x")}</button></div>
      <h2 id="nota-title" class="sr-only">Notinha ${esc(v.code)}</h2>
      <div class="nota__paper">${notaHTML(v)}</div>
      <div class="nota__actions">
        <button class="btn btn--wa" data-nota-share>${icon("i-wa")}${tel.length >= 10 ? "Enviar ao cliente" : "Enviar no WhatsApp"}</button>
        <button class="btn btn--ghost" data-nota-png>${icon("i-download")}Baixar imagem</button>
        <button class="btn btn--ghost" data-print="${esc(v.code)}">${icon("i-print")}Imprimir</button>
        <button class="btn btn--primary" data-close-modal data-pdv-focus>${icon("i-plus")}Nova venda</button>
      </div>`;
    dlg.showModal();
  }
  async function compartilharNota() {
    const v = notaAtual; if (!v) return;
    const blob = await notaPNG(v);
    const file = new File([blob], `${v.code}.png`, { type: "image/png" });
    // celular: compartilha a imagem direto (WhatsApp aparece na lista)
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], text: notaTexto(v) }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    // computador: abre a conversa com o texto da notinha
    const tel = T().digits(v.cliente?.telefone);
    window.open(`https://wa.me/${tel.length >= 10 ? `55${tel.replace(/^55/, "")}` : ""}?text=${encodeURIComponent(notaTexto(v))}`, "_blank", "noopener");
  }
  async function baixarNota() {
    const v = notaAtual; if (!v) return;
    const url = URL.createObjectURL(await notaPNG(v));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${v.code}.png` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ======================================================================
  // CAIXA
  // ======================================================================
  function abrirCaixaHTML(motivo) {
    return `<form class="box abrir" id="abrir-form" novalidate>
      <div class="abrir__ic">${icon("i-cash")}</div>
      <div class="abrir__body">
        <h2>Abrir caixa · ${esc(loja()?.nome)}</h2>
        <p class="muted">${esc(motivo)}</p>
        <label class="field"><span>Fundo de caixa (troco na gaveta)</span><span class="money-input"><span>R$</span><input name="fundo" inputmode="decimal" placeholder="0,00" autofocus></span><span class="err"></span></label>
        <button class="btn btn--primary">${icon("i-check")}Abrir caixa</button>
      </div>
    </form>`;
  }

  function viewCaixa() {
    return `<div class="admin-head"><div><h1>Caixa</h1></div><div id="caixa-loja"></div></div>
      ${asyncView("caixa-root", skel(5), async () => {
        await loadSetup(true);
        paint("caixa-loja", lojaPicker());
        await renderCaixa();
      })}`;
  }

  const stat = (label, valor, extra = "", cls = "") => `<div class="stat ${cls}"><span>${label}</span><strong class="num">${valor}</strong>${extra ? `<small>${extra}</small>` : ""}</div>`;

  async function renderCaixa() {
    const root = $("#caixa-root");
    if (!root) return;
    const c = caixaAberto();
    const historicoP = api(`r=caixas&lojaId=${encodeURIComponent(lojaId())}`);
    let atual = "";
    if (!c) {
      atual = abrirCaixaHTML("Conte o dinheiro que fica na gaveta para troco e abra o caixa do dia.");
    } else {
      const { caixa, vendas, resumo: r } = await api(`r=caixa&id=${encodeURIComponent(c.id)}`);
      const f = r.porForma;
      atual = `
        ${abertoOutroDia(caixa) ? `<div class="alert alert--warn">${icon("i-clock")}<div><strong>Aberto há ${caixaDias(caixa) || 1} ${caixaDias(caixa) > 1 ? "dias" : "dia"}, desde ${dia(caixa.abertoEm)} às ${hora(caixa.abertoEm)}.</strong> Feche este caixa e abra um novo para o dia de hoje.</div></div>` : ""}
        <section class="box caixa">
          <div class="box__head"><h2>Caixa aberto</h2><span class="muted">desde ${dia(caixa.abertoEm)} às ${hora(caixa.abertoEm)}</span></div>
          <div class="stats">
            ${stat("Vendas", money(r.liquido), `${r.qtdVendas} ${r.qtdVendas === 1 ? "venda" : "vendas"}${r.qtdDevolucoes ? ` · ${r.qtdDevolucoes} devol.` : ""}`, "stat--main")}
            ${stat("Dinheiro na gaveta", money(r.dinheiroEsperado), `fundo ${money(caixa.fundo)} + dinheiro${r.sangrias ? " - retiradas" : ""}`)}
            ${stat("Pix", money(f.pix))}
            ${stat("Cartão", money(f.credito + f.debito), `crédito ${money(f.credito)} · débito ${money(f.debito)}`)}
            ${f.fiado ? stat("Fiado a receber", money(f.fiado)) : ""}
          </div>
          <div class="caixa__cols">
            <div>
              <h3>Vendas deste caixa</h3>
              ${vendas.length ? `<ul class="vlist">${[...vendas].reverse().map((v) => `
                <li class="${v.status === "CANCELADA" ? "is-cancel" : ""}">
                  <span class="vlist__time num">${hora(v.criadaEm)}</span>
                  <span class="vlist__who"><b>${esc(v.code)}</b> ${esc(v.cliente?.nome || "Ao consumidor")}<small class="muted">${esc(v.vendedor.nome)} · ${v.pagamentos.map((p) => FORMAS[p.forma]).join(" + ")}${v.status === "CANCELADA" ? " · cancelada" : ""}</small></span>
                  <span class="num vlist__val ${v.tipo === "devolucao" ? "neg" : ""}">${v.tipo === "devolucao" ? "-" : ""}${money(v.total)}</span>
                  <span class="vlist__act">
                    <button class="icon-btn icon-btn--sm" data-caixa-nota="${esc(v.code)}" aria-label="Ver notinha ${esc(v.code)}">${icon("i-receipt")}</button>
                    ${v.status !== "CANCELADA" ? `<button class="icon-btn icon-btn--sm" data-caixa-cancel="${esc(v.code)}" aria-label="Cancelar ${esc(v.code)}">${icon("i-x")}</button>` : ""}
                  </span>
                </li>`).join("")}</ul>` : `<p class="muted">Nenhuma venda ainda. <a class="link-arrow" href="#/admin?aba=balcao">Fazer uma venda ${icon("i-arrow")}</a></p>`}
            </div>
            <div>
              <h3>Retiradas e reforços</h3>
              ${caixa.movimentos.length ? `<ul class="mlist">${caixa.movimentos.map((m) => `<li><span class="num">${hora(m.em)}</span><span>${m.tipo === "sangria" ? "Retirada" : "Reforço"}${m.motivo ? `: ${esc(m.motivo)}` : ""}</span><b class="num ${m.tipo === "sangria" ? "neg" : ""}">${m.tipo === "sangria" ? "-" : "+"}${money(m.valor)}</b></li>`).join("")}</ul>` : `<p class="muted">Pagou algo com o dinheiro da gaveta? Registre aqui.</p>`}
              <form class="mov" id="mov-form" novalidate>
                <div class="seg seg--sm" role="radiogroup" aria-label="Tipo">
                  <label><input type="radio" name="tipo" value="sangria" checked><span>Retirada</span></label>
                  <label><input type="radio" name="tipo" value="suprimento"><span>Reforço</span></label>
                </div>
                <span class="money-input"><span>R$</span><input name="valor" inputmode="decimal" placeholder="0,00" aria-label="Valor"></span>
                <input name="motivo" maxlength="120" placeholder="Motivo (ex.: almoço, fornecedor)" aria-label="Motivo">
                <button class="btn btn--ghost btn--sm">Registrar</button>
              </form>
            </div>
          </div>
        </section>
        <form class="box fechar" id="fechar-form" data-caixa="${esc(caixa.id)}" data-esperado="${r.dinheiroEsperado}" novalidate>
          <div class="box__head"><h2>Fechar caixa</h2></div>
          <div class="fechar__grid">
            <label class="field"><span>Dinheiro contado na gaveta</span><span class="money-input"><span>R$</span><input name="contado" inputmode="decimal" placeholder="${fmtMoneyInput(r.dinheiroEsperado)}"></span><span class="err"></span></label>
            <div class="fechar__dif" id="fechar-dif"><span>Esperado</span><b class="num">${money(r.dinheiroEsperado)}</b></div>
            <label class="field fechar__obs"><span>Observação <span class="opt">(opcional)</span></span><input name="obs" maxlength="300" placeholder="Ex.: deixei R$ 100 de troco para amanhã"></label>
          </div>
          <button class="btn btn--dark">${icon("i-lock")}Fechar caixa</button>
        </form>`;
    }
    root.innerHTML = `${atual}<section class="box"><div class="box__head"><h2>Caixas anteriores</h2></div><div id="caixa-hist">${skel(3)}</div></section>`;
    try {
      const { caixas } = await historicoP;
      const fechados = caixas.filter((x) => x.caixa.status === "FECHADO");
      paint("caixa-hist", fechados.length ? `<div class="olist">${fechados.map(({ caixa: k, resumo: r }) => `
        <details class="hist">
          <summary>
            <span class="num">${dia(k.abertoEm)}</span>
            <span class="hist__when">${hora(k.abertoEm)} até ${k.fechadoEm ? `${dia(k.fechadoEm) !== dia(k.abertoEm) ? `${dia(k.fechadoEm)} ` : ""}${hora(k.fechadoEm)}` : "-"}</span>
            <span class="num"><b>${money(r.liquido)}</b></span>
            <span class="hist__dif ${r.diferenca ? (r.diferenca > 0 ? "pos" : "neg") : ""}">${r.diferenca ? `${r.diferenca > 0 ? "Sobra" : "Falta"} ${money(Math.abs(r.diferenca))}` : "Bateu"}</span>
            ${icon("i-down")}
          </summary>
          <div class="hist__body">
            <pre class="fech-txt">${esc(fechamentoTexto(k, r))}</pre>
            <div class="hist__actions">
              <button class="btn btn--wa btn--sm" data-fech-wa="${esc(k.id)}">${icon("i-wa")}Enviar no grupo</button>
              <button class="btn btn--ghost btn--sm" data-fech-copy="${esc(k.id)}">${icon("i-copy")}Copiar</button>
              <a class="btn btn--ghost btn--sm" href="#/admin?aba=relatorios&de=${k.abertoEm.slice(0, 10)}&ate=${(k.fechadoEm || k.abertoEm).slice(0, 10)}">${icon("i-chart")}Relatório do período</a>
            </div>
          </div>
        </details>`).join("")}</div>` : `<p class="muted">Os caixas fechados aparecem aqui, com o texto do fechamento pronto para o WhatsApp.</p>`);
      fechamentos = Object.fromEntries(caixas.map(({ caixa: k, resumo: r }) => [k.id, fechamentoTexto(k, r)]));
    } catch (err) { paint("caixa-hist", `<p class="muted">${esc(err.message)}</p>`); }
  }
  let fechamentos = {};

  function mostrarFechamento(caixa, r) {
    const txt = fechamentoTexto(caixa, r);
    fechamentos[caixa.id] = txt;
    const root = $("#caixa-root");
    root.insertAdjacentHTML("afterbegin", `
      <section class="box fechado" id="fechado">
        <div class="order-badge">${icon("i-check")}Caixa fechado</div>
        <h2>Fechamento de ${dia(caixa.fechadoEm)}</h2>
        <pre class="fech-txt">${esc(txt)}</pre>
        <div class="hist__actions">
          <button class="btn btn--wa" data-fech-wa="${esc(caixa.id)}">${icon("i-wa")}Enviar no grupo do caixa</button>
          <button class="btn btn--ghost" data-fech-copy="${esc(caixa.id)}">${icon("i-copy")}Copiar texto</button>
          <a class="btn btn--ghost" href="#/admin?aba=relatorios&de=${caixa.abertoEm.slice(0, 10)}&ate=${caixa.fechadoEm.slice(0, 10)}">${icon("i-chart")}Relatório para imprimir</a>
        </div>
      </section>`);
    $("#fechado").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ======================================================================
  // RELATÓRIOS
  // ======================================================================
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function periodo(chave) {
    const h = new Date(); h.setHours(0, 0, 0, 0);
    const d = new Date(h), a = new Date(h);
    if (chave === "ontem") { d.setDate(d.getDate() - 1); a.setDate(a.getDate() - 1); }
    else if (chave === "semana") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    else if (chave === "mes") d.setDate(1);
    else if (chave === "mespassado") { d.setMonth(d.getMonth() - 1, 1); a.setDate(0); }
    return { de: iso(d), ate: iso(a) };
  }
  const PERIODOS = { hoje: "Hoje", ontem: "Ontem", semana: "Esta semana", mes: "Este mês", mespassado: "Mês passado" };

  function viewRelatorios() {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    const p = params.get("p") || (params.get("de") ? "custom" : "mes");
    const { de, ate } = p === "custom" ? { de: params.get("de") || iso(new Date()), ate: params.get("ate") || iso(new Date()) } : periodo(p);
    const vis = params.get("vis") || "produtos";
    const lojaSel = params.get("loja") ?? "";
    return `<div class="admin-head no-print"><div><h1>Relatórios</h1></div>
        <div class="rep__tools"><button class="btn btn--ghost btn--sm" data-rep-csv>${icon("i-download")}Planilha</button><button class="btn btn--dark btn--sm" data-rep-print>${icon("i-print")}Imprimir ou PDF</button></div></div>
      <form class="rep__filters no-print" id="rep-form">
        <div class="seg" role="radiogroup" aria-label="Período">${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${p === k}" class="${p === k ? "is-on" : ""}" data-rep-p="${k}">${v}</button>`).join("")}</div>
        <label class="rep__date"><span>De</span><input type="date" name="de" value="${de}"></label>
        <label class="rep__date"><span>Até</span><input type="date" name="ate" value="${ate}"></label>
        <span id="rep-loja"></span>
      </form>
      ${asyncView("rep-root", skel(6), async () => {
        await loadSetup();
        paint("rep-loja", setup.lojas.length > 1 ? `<select name="loja" data-rep-loja aria-label="Loja"><option value="">Todas as lojas</option>${setup.lojas.map((l) => `<option value="${esc(l.id)}" ${l.id === lojaSel ? "selected" : ""}>${esc(l.nome)}</option>`).join("")}</select>` : "");
        const from = new Date(`${de}T00:00:00`), to = new Date(`${ate}T23:59:59.999`);
        const { vendas } = await api(`r=vendas&from=${from.toISOString()}&to=${to.toISOString()}${lojaSel ? `&lojaId=${encodeURIComponent(lojaSel)}` : ""}`);
        relatorio = montarRelatorio(vendas.filter((v) => v.status !== "CANCELADA"));
        relatorio.titulo = `${de === ate ? new Date(`${de}T12:00`).toLocaleDateString("pt-BR") : `${new Date(`${de}T12:00`).toLocaleDateString("pt-BR")} a ${new Date(`${ate}T12:00`).toLocaleDateString("pt-BR")}`}`;
        paint("rep-root", relatorioHTML(relatorio, vis));
      })}`;
  }

  let relatorio = null;
  function montarRelatorio(vendas) {
    const prods = {}, formas = {}, vends = {};
    let qtd = 0, custo = 0, fat = 0;
    for (const v of vendas) {
      const s = v.tipo === "devolucao" ? -1 : 1;
      for (const it of v.itens) {
        const k = `${it.name}|${it.code}`;
        const p = (prods[k] ||= { name: it.name, code: it.code, qtd: 0, custo: 0, valor: 0 });
        p.qtd += s * it.qty; p.custo += s * it.custo * it.qty; p.valor += s * it.sub;
        qtd += s * it.qty; custo += s * it.custo * it.qty; fat += s * it.sub;
      }
      v.pagamentos.forEach((pg) => (formas[pg.forma] = (formas[pg.forma] || 0) + s * pg.valor));
      const vd = (vends[v.vendedor.nome] ||= { nome: v.vendedor.nome, vendas: 0, valor: 0 });
      if (s > 0) vd.vendas++; vd.valor += s * v.total;
    }
    const lista = Object.values(prods).map((p) => ({ ...p, lucro: p.valor - p.custo, medio: p.qtd ? p.custo / p.qtd : 0 })).sort((a, b) => b.valor - a.valor);
    return { vendas, lista, formas, vends: Object.values(vends).sort((a, b) => b.valor - a.valor), qtd, custo, fat, lucro: fat - custo };
  }

  function relatorioHTML(R, vis) {
    const margem = R.fat ? (R.lucro / R.fat) * 100 : 0;
    const tabs = { produtos: "Produtos vendidos", formas: "Formas de pagamento", vendedores: "Vendedores", vendas: "Vendas" };
    const tabela = {
      produtos: () => R.lista.length ? `<table class="rep__table"><thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Custo médio</th><th class="r">Custo total</th><th class="r">Valor total</th><th class="r">Lucro</th></tr></thead>
        <tbody>${R.lista.map((p) => `<tr><td>${esc(p.name)}${p.code ? ` <small class="muted">${esc(p.code)}</small>` : ""}</td><td class="r num">${p.qtd}</td><td class="r num">${money(p.medio)}</td><td class="r num">${money(p.custo)}</td><td class="r num">${money(p.valor)}</td><td class="r num ${p.lucro < 0 ? "neg" : ""}"><b>${money(p.lucro)}</b></td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="r num">${R.qtd}</td><td></td><td class="r num">${money(R.custo)}</td><td class="r num">${money(R.fat)}</td><td class="r num"><b>${money(R.lucro)}</b></td></tr></tfoot></table>` : "",
      formas: () => `<table class="rep__table"><thead><tr><th>Forma</th><th class="r">Recebido</th><th class="r">Parte</th></tr></thead><tbody>${Object.entries(R.formas).sort((a, b) => b[1] - a[1]).map(([f, v]) => `<tr><td>${FORMAS[f]}</td><td class="r num">${money(v)}</td><td class="r num">${R.fat ? Math.round((v / R.fat) * 100) : 0}%</td></tr>`).join("")}</tbody></table>`,
      vendedores: () => `<table class="rep__table"><thead><tr><th>Vendedor</th><th class="r">Vendas</th><th class="r">Valor</th><th class="r">Ticket médio</th></tr></thead><tbody>${R.vends.map((v) => `<tr><td>${esc(v.nome)}</td><td class="r num">${v.vendas}</td><td class="r num">${money(v.valor)}</td><td class="r num">${money(v.vendas ? v.valor / v.vendas : 0)}</td></tr>`).join("")}</tbody></table>`,
      vendas: () => `<table class="rep__table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th class="r">Total</th></tr></thead><tbody>${[...R.vendas].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).map((v) => `<tr><td><b>${esc(v.code)}</b></td><td class="num">${dia(v.criadaEm)} ${hora(v.criadaEm)}</td><td>${esc(v.cliente?.nome || "Ao consumidor")}</td><td>${esc(v.vendedor.nome)}</td><td>${v.pagamentos.map((p) => FORMAS[p.forma]).join(" + ")}</td><td class="r num ${v.tipo === "devolucao" ? "neg" : ""}">${v.tipo === "devolucao" ? "-" : ""}${money(v.total)}</td></tr>`).join("")}</tbody></table>`,
    };
    return `
      <section class="report">
        <header class="report__print-head print-only"><strong>TOP SMART</strong><span>Relatório de vendas · ${esc(R.titulo)}</span></header>
        <div class="stats stats--rep">
          ${stat("Quantidade", R.qtd, "itens vendidos")}
          ${stat("Custo total", money(R.custo), "custo das peças")}
          ${stat("Valor total", money(R.fat), (() => { const n = R.vendas.filter((v) => v.tipo !== "devolucao").length; return `${n} ${n === 1 ? "venda" : "vendas"}`; })())}
          ${stat("Lucro", money(R.lucro), `margem de ${margem.toFixed(1).replace(".", ",")}%`, "stat--main")}
        </div>
        ${R.vendas.length ? `
        <div class="rep__tabs no-print" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" aria-selected="${vis === k}" class="${vis === k ? "is-on" : ""}" data-rep-vis="${k}">${v}</button>`).join("")}</div>
        <div class="table-wrap">${tabela[vis]?.() || tabela.produtos()}</div>
        ${R.lista.some((p) => !p.custo) ? `<p class="muted rep__note no-print">Produtos sem preço de custo contam lucro igual ao valor de venda. Preencha o custo em Produtos.</p>` : ""}`
        : `<div class="empty">Nenhuma venda neste período.</div>`}
      </section>`;
  }

  function exportarCSV() {
    if (!relatorio) return;
    const linhas = [["Produto", "Código", "Quantidade", "Custo médio", "Custo total", "Valor total", "Lucro"],
      ...relatorio.lista.map((p) => [p.name, p.code, p.qtd, p.medio.toFixed(2), p.custo.toFixed(2), p.valor.toFixed(2), p.lucro.toFixed(2)])];
    const csv = "﻿" + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""').replace(".", l === linhas[0] ? "." : ",")}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `relatorio-top-smart-${relatorio.titulo.replace(/\//g, "-").replace(/\s/g, "")}.csv` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ======================================================================
  // LOJAS E VENDEDORES
  // ======================================================================
  function viewEquipe() {
    draft = null;
    return `<div class="admin-head"><div><h1>Lojas e vendedores</h1><p class="muted">Cada loja tem um caixa por dia. Os vendedores aparecem na hora de fechar a venda.</p></div></div>
      ${asyncView("equipe-root", skel(4), async () => { await loadSetup(true); renderEquipe(); })}`;
  }
  let draft = null;
  function renderEquipe() {
    draft ||= JSON.parse(JSON.stringify({ lojas: setup.lojas, vendedores: setup.vendedores }));
    paint("equipe-root", `<form class="equipe" id="equipe-form" novalidate>
      ${draft.lojas.map((l, li) => `
        <section class="box equipe__loja">
          <div class="equipe__lojahead">
            <label class="field"><span>Loja</span><input value="${esc(l.nome)}" data-eq-loja="${li}" maxlength="60" required></label>
            ${draft.lojas.length > 1 ? `<button type="button" class="icon-btn icon-btn--sm" data-eq-loja-del="${li}" aria-label="Remover loja ${esc(l.nome)}">${icon("i-trash")}</button>` : ""}
          </div>
          <ul class="equipe__vends">
            ${draft.vendedores.map((v, vi) => v.lojaId !== l.id ? "" : `
              <li class="${v.ativo ? "" : "is-off"}">
                <input value="${esc(v.nome)}" data-eq-vend="${vi}" maxlength="60" aria-label="Nome do vendedor" placeholder="Nome do vendedor">
                <label class="check"><input type="checkbox" data-eq-ativo="${vi}" ${v.ativo ? "checked" : ""}> Ativo</label>
              </li>`).join("") || '<li class="muted">Nenhum vendedor ainda.</li>'}
          </ul>
          <button type="button" class="text-btn" data-eq-add="${esc(l.id)}">${icon("i-plus")}Adicionar vendedor</button>
        </section>`).join("")}
      <div class="equipe__foot">
        <button type="button" class="btn btn--ghost" data-eq-addloja>${icon("i-store")}Nova loja</button>
        <button class="btn btn--primary">${icon("i-check")}Salvar</button>
      </div>
    </form>`);
  }

  // ======================================================================
  // EVENTOS
  // ======================================================================
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a, li[data-pdv-add], li[data-pdv-cli], li[data-pdv-cli-new]");
    if (!t) return;
    const d = t.dataset;
    if ("pdvRetry" in d) return T().router();
    // ---- venda balcão ----
    if (d.pdvAdd) return addProduto(d.pdvAdd);
    if (d.pdvDel) { sale.itens.splice(+d.pdvDel, 1); saveSale(); return renderPdv(); }
    if (d.pdvTipo) { if (sale.tipo !== d.pdvTipo) { sale.tipo = d.pdvTipo; sale.pagamentos = []; sale.etapa = "itens"; saveSale(); renderPdv(); } return; }
    if ("pdvCliClear" in d) return setCliente(null);
    if (d.pdvCli !== undefined && t.closest("#pdv-cli-results")) return setCliente($("#pdv-cli-results")._found[+d.pdvCli]);
    if ("pdvCliNew" in d) return setCliente({ nome: $("#pdv-cli").value.trim(), doc: "", telefone: "", tipo: "cliente" });
    if ("pdvPagar" in d) return irPagamento();
    if ("pdvVoltar" in d) { sale.etapa = "itens"; saveSale(); return renderPdv(); }
    if (d.pdvForma) {
      const falta = Math.max(0, Math.round((totalItens() - totalPago()) * 100) / 100);
      const ja = sale.pagamentos.find((p) => p.forma === d.pdvForma);
      if (ja) ja.valor = Math.round((ja.valor + falta) * 100) / 100;
      else sale.pagamentos.push({ forma: d.pdvForma, valor: falta || (sale.pagamentos.length ? 0 : totalItens()) });
      saveSale(); renderPdv();
      const i = sale.pagamentos.findIndex((p) => p.forma === d.pdvForma);
      $(`#pdv-pay-${i}`)?.select();
      return;
    }
    if (d.pdvPayDel) { sale.pagamentos.splice(+d.pdvPayDel, 1); saveSale(); return renderPdv(); }
    if ("pdvConcluir" in d) return concluir();
    if ("pdvHold" in d) {
      store.set("ts_pdv_espera", [{ ...sale, etapa: "itens", pagamentos: [] }, ...espera()].slice(0, 8));
      sale = novaVenda(); saveSale(); T().toast("Venda guardada em espera"); return renderPdv();
    }
    if (d.pdvResume !== undefined) {
      const list = espera();
      if (sale.itens.length) list.push({ ...sale, etapa: "itens", pagamentos: [] });
      sale = list.splice(+d.pdvResume, 1)[0];
      store.set("ts_pdv_espera", list); saveSale(); return renderPdv();
    }
    if ("pdvClear" in d) { if (confirm("Limpar todos os itens desta venda?")) { sale = { ...novaVenda(), tipo: sale.tipo }; saveSale(); renderPdv(); } return; }
    if ("pdvFocus" in d) return setTimeout(() => $("#pdv-q")?.focus(), 50);
    // ---- notinha ----
    if ("notaShare" in d) return compartilharNota();
    if ("notaPng" in d) return baixarNota();
    if (d.caixaNota) {
      const { venda } = { venda: (await api(`r=vendas&from=2000-01-01T00:00:00Z`)).vendas.find((v) => v.code === d.caixaNota) };
      if (venda) mostrarNota(venda);
      return;
    }
    if (d.caixaCancel) {
      const motivo = prompt(`Cancelar a venda ${d.caixaCancel}? Ela deixa de contar no caixa. Escreva o motivo:`);
      if (motivo === null) return;
      try { await api(`r=venda&acao=cancelar&code=${encodeURIComponent(d.caixaCancel)}`, "POST", { motivo }); T().toast(`Venda ${d.caixaCancel} cancelada. Confira o estoque do produto.`); renderCaixa(); }
      catch (err) { T().toast(err.message); }
      return;
    }
    // ---- fechamento ----
    if (d.fechWa) return window.open(`https://wa.me/?text=${encodeURIComponent(fechamentos[d.fechWa] || "")}`, "_blank", "noopener");
    if (d.fechCopy) {
      try { await navigator.clipboard.writeText(fechamentos[d.fechCopy] || ""); T().toast("Fechamento copiado. Cole no grupo do caixa."); } catch { T().toast("Não foi possível copiar"); }
      return;
    }
    // ---- relatórios ----
    if (d.repP) return setRep({ p: d.repP, de: null, ate: null });
    if (d.repVis) return setRep({ vis: d.repVis });
    if ("repPrint" in d) { document.body.classList.add("printing-report"); window.print(); document.body.classList.remove("printing-report"); return; }
    if ("repCsv" in d) return exportarCSV();
    // ---- equipe ----
    if (d.eqAdd) { syncDraft(); draft.vendedores.push({ id: "", nome: "", lojaId: d.eqAdd, ativo: true }); renderEquipe(); $$("[data-eq-vend]").at(-1)?.focus(); return; }
    if ("eqAddloja" in d) { syncDraft(); draft.lojas.push({ id: Math.random().toString(36).slice(2, 10), nome: "" }); renderEquipe(); $$("[data-eq-loja]").at(-1)?.focus(); return; }
    if (d.eqLojaDel) {
      syncDraft(); const l = draft.lojas[+d.eqLojaDel];
      if (!confirm(`Remover a loja ${l.nome || "sem nome"} e os vendedores dela?`)) return;
      draft.lojas.splice(+d.eqLojaDel, 1); draft.vendedores = draft.vendedores.filter((v) => v.lojaId !== l.id); renderEquipe();
    }
  });

  function setRep(changes) {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    Object.entries(changes).forEach(([k, v]) => (v === null ? params.delete(k) : params.set(k, v)));
    params.set("aba", "relatorios");
    location.hash = `#/admin?${params}`;
  }

  function irPagamento() {
    if (!sale.itens.length) return;
    if (!sale.vendedorId) {
      const e = $("#pdv-vend-err"); if (e) e.textContent = "Escolha o vendedor";
      $("#pdv-vend")?.focus(); return;
    }
    sale.etapa = "pagamento";
    if (!sale.pagamentos.length && sale.tipo === "venda") sale.pagamentos = [];
    saveSale(); renderPdv();
  }

  function syncDraft() {
    $$("[data-eq-loja]").forEach((i) => (draft.lojas[+i.dataset.eqLoja].nome = i.value.trim()));
    $$("[data-eq-vend]").forEach((i) => (draft.vendedores[+i.dataset.eqVend].nome = i.value.trim()));
    $$("[data-eq-ativo]").forEach((i) => (draft.vendedores[+i.dataset.eqAtivo].ativo = i.checked));
  }

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "pdv-q") { results = buscar(t.value); resultIdx = 0; renderResults(); return; }
    if (t.id === "pdv-cli") return renderCliResults(t.value);
    if (t.dataset.pdvPay !== undefined) {
      sale.pagamentos[+t.dataset.pdvPay].valor = parseMoney(t.value); saveSale();
      // atualiza só os totais para não tirar o foco do campo
      const side = $(".pdv__side"); const pos = t.selectionStart, id = t.id;
      side.innerHTML = pagamentoHTML(); const n = document.getElementById(id); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      return;
    }
    if (t.closest("#fechar-form") && t.name === "contado") {
      const esp = +t.form.dataset.esperado, cont = parseMoney(t.value), dif = Math.round((cont - esp) * 100) / 100;
      $("#fechar-dif").innerHTML = !t.value.trim() ? `<span>Esperado</span><b class="num">${money(esp)}</b>`
        : `<span>${dif === 0 ? "Bateu certinho" : dif > 0 ? "Sobrando" : "Faltando"}</span><b class="num ${dif < 0 ? "neg" : dif > 0 ? "pos" : ""}">${dif ? money(Math.abs(dif)) : money(esp)}</b>`;
    }
  });

  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.pdvLoja !== undefined) { store.set("ts_loja", t.value); sale.vendedorId = ""; saveSale(); return T().router(); }
    if (t.dataset.pdvVend !== undefined) { sale.vendedorId = t.value; store.set("ts_pdv_vendedor", t.value); saveSale(); const er = $("#pdv-vend-err"); if (er) er.textContent = ""; return; }
    if (t.dataset.pdvItem !== undefined) {
      const it = sale.itens[+t.dataset.pdvItem], f = t.dataset.field;
      if (f === "qty") it.qty = Math.max(1, parseInt(t.value, 10) || 1);
      if (f === "unit") { it.unit = parseMoney(t.value); it.editado = true; }
      if (f === "desconto") it.desconto = Math.min(parseMoney(t.value), it.unit * it.qty);
      saveSale(); return renderPdv();
    }
    if (t.closest("#rep-form") && t.type === "date") {
      const f = t.form; return setRep({ p: "custom", de: f.de.value, ate: f.ate.value });
    }
    if (t.dataset.repLoja !== undefined) return setRep({ loja: t.value });
  });

  document.addEventListener("keydown", (e) => {
    if (!location.hash.includes("aba=balcao")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "F2") { e.preventDefault(); $("#pdv-q")?.focus(); return; }
    if (e.key === "F9") { e.preventDefault(); if (sale.etapa === "itens") irPagamento(); return; }
    const t = e.target;
    if (t.id === "pdv-q") {
      if (e.key === "ArrowDown" && results.length) { e.preventDefault(); resultIdx = (resultIdx + 1) % results.length; renderResults(); }
      else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); resultIdx = (resultIdx - 1 + results.length) % results.length; renderResults(); }
      else if (e.key === "Enter") { e.preventDefault(); if (results[resultIdx]) addProduto(results[resultIdx].id); }
      else if (e.key === "Escape") { t.value = ""; results = []; renderResults(); }
      return;
    }
    if (t.id === "pdv-cli" && e.key === "Enter") {
      e.preventDefault();
      const first = $("#pdv-cli-results")?._found?.[0];
      if (first) setCliente(first); else if (t.value.trim()) setCliente({ nome: t.value.trim(), doc: "", telefone: "", tipo: "cliente" });
      return;
    }
    if (sale.etapa === "pagamento" && e.key === "Enter" && (t.dataset.pdvPay !== undefined || t.id === "pdv-obs")) { e.preventDefault(); concluir(); }
    if (sale.etapa === "pagamento" && e.key === "Escape") { sale.etapa = "itens"; saveSale(); renderPdv(); }
  });

  document.addEventListener("submit", async (e) => {
    const f = e.target;
    if (f.id === "abrir-form") {
      e.preventDefault();
      const btn = f.querySelector("button"); btn.disabled = true;
      try {
        await api("r=caixa&acao=abrir", "POST", { lojaId: lojaId(), fundo: parseMoney(f.fundo.value) });
        await loadSetup(true); T().toast("Caixa aberto. Boas vendas!");
        if (location.hash.includes("aba=balcao")) renderPdv(); else renderCaixa();
      } catch (err) { btn.disabled = false; T().setErr(f, "fundo", err.message); }
      return;
    }
    if (f.id === "mov-form") {
      e.preventDefault();
      const valor = parseMoney(f.valor.value);
      if (!(valor > 0)) { f.valor.focus(); return T().toast("Informe o valor"); }
      try { await api(`r=caixa&acao=movimento&id=${encodeURIComponent(caixaAberto().id)}`, "POST", { tipo: f.tipo.value, valor, motivo: f.motivo.value }); T().toast("Registrado"); renderCaixa(); }
      catch (err) { T().toast(err.message); }
      return;
    }
    if (f.id === "fechar-form") {
      e.preventDefault();
      if (!f.contado.value.trim()) { T().setErr(f, "contado", "Conte o dinheiro da gaveta e digite o valor"); f.contado.focus(); return; }
      const contado = parseMoney(f.contado.value);
      const esp = +f.dataset.esperado;
      const dif = Math.round((contado - esp) * 100) / 100;
      if (dif && !confirm(`O dinheiro contado ${dif > 0 ? "sobra" : "falta"} ${money(Math.abs(dif))} em relação ao esperado. Fechar assim mesmo?`)) return;
      const btn = f.querySelector("button"); btn.disabled = true;
      try {
        const { caixa, resumo: r } = await api(`r=caixa&acao=fechar&id=${encodeURIComponent(f.dataset.caixa)}`, "POST", { contado, obs: f.obs.value });
        await loadSetup(true); await renderCaixa(); mostrarFechamento(caixa, r);
      } catch (err) { btn.disabled = false; T().toast(err.message); }
      return;
    }
    if (f.id === "equipe-form") {
      e.preventDefault(); syncDraft();
      draft.vendedores = draft.vendedores.filter((v) => v.nome);
      if (draft.lojas.some((l) => !l.nome)) return T().toast("Dê um nome para cada loja");
      try { const s = await api("r=setup", "PUT", draft); setup = { ...setup, ...s }; draft = null; T().toast("Lojas e vendedores salvos"); renderEquipe(); }
      catch (err) { T().toast(err.message); }
    }
  });

  window.TS_EXT = { tabs: { inicio: viewInicio, balcao: viewBalcao, caixa: viewCaixa, relatorios: viewRelatorios, equipe: viewEquipe } };
})();
