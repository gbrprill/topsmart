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

  const FORMAS = { dinheiro: "Dinheiro", pix: "Pix", credito: "Cartão crédito", debito: "Cartão débito", fiado: "Fiado", credito_loja: "Crédito na loja" };
  const FORMA_IC = { dinheiro: "i-cash", pix: "i-pix", credito: "i-card", debito: "i-card", fiado: "i-clock", credito_loja: "i-wallet" };
  // saldo de crédito do cliente cadastrado no balcão (0,00 por padrão)
  const saldoCredito = (c) => (c?.id ? (setup?.clientes || []).find((x) => x.id === c.id)?.credito || 0 : 0);
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
    const f = r.porForma, e = r.entradas || f;
    const linhas = [
      `*FECHAMENTO ${c.lojaNome.toUpperCase()} ${dia(c.fechadoEm || new Date().toISOString())}*`,
      `Aberto ${dia(c.abertoEm)} ${hora(c.abertoEm)}${c.abertoPor ? ` por ${c.abertoPor}` : ""}${c.fechadoEm ? ` · fechado ${dia(c.fechadoEm)} ${hora(c.fechadoEm)}${c.fechadoPor ? ` por ${c.fechadoPor}` : ""}` : ""}`,
      "",
      `Fundo de caixa: ${money(c.fundo)}`,
      `Vendas: ${money(r.liquido)} (${r.qtdVendas} ${r.qtdVendas === 1 ? "venda" : "vendas"})`,
      `Pix: ${money(e.pix)}`,
      `Dinheiro: ${money(e.dinheiro)}`,
    ];
    if (e.credito) linhas.push(`Crédito: ${money(e.credito)}`);
    if (e.debito) linhas.push(`Débito: ${money(e.debito)}`);
    if (r.recebido) linhas.push(`Fiado recebido: ${money(r.recebido)} (já somado acima)`);
    if (f.fiado) linhas.push(`Vendido no fiado (a receber): ${money(f.fiado)}`);
    if (f.credito_loja < 0) linhas.push(`Crédito gerado para clientes: ${money(-f.credito_loja)}`);
    if (f.credito_loja > 0) linhas.push(`Pago com crédito da loja: ${money(f.credito_loja)}`);
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
        const abaixoMin = prods.filter((p) => p.min && p.stock > 0 && p.stock <= p.min).length;

        paint("inicio-body", `
          ${T().avisoCatalogo()}
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
              <a href="#/admin?aba=estoque&f=sem"><span>Produtos sem estoque</span><b class="num">${semEstoque}</b></a>
              ${abaixoMin ? `<a href="#/admin?aba=estoque&f=min"><span>Abaixo do mínimo</span><b class="num">${abaixoMin}</b></a>` : ""}
              <a href="#/admin?aba=dashboard"><span>Dashboard financeiro</span>${icon("i-arrow")}</a>
            </nav>
          </div>`);
      })}`;
  }

  // ======================================================================
  // VENDA BALCÃO
  // ======================================================================
  const novaVenda = () => ({ tipo: "venda", itens: [], devolvidos: [], cliente: null, vendedorId: store.get("ts_pdv_vendedor", ""), obs: "", pagamentos: [], etapa: "itens" });
  let sale = { ...novaVenda(), ...(store.get("ts_pdv_sale", null) || {}) };
  sale.devolvidos ||= [];
  const saveSale = () => store.set("ts_pdv_sale", sale);
  const espera = () => store.get("ts_pdv_espera", []);
  let cliForm = null; // formulário de cliente novo aberto (com o nome já digitado)

  const r2 = (v) => Math.round(v * 100) / 100;
  const precoPara = (p) => sale.cliente?.tipo === "lojista" ? (p.priceLoj ?? p.price) : (p.promo ?? p.price);
  const subItem = (it) => Math.max(0, it.unit * it.qty - (it.desconto || 0));
  const soma = (lista) => r2(lista.reduce((s, it) => s + subItem(it), 0));
  const totalDescontos = () => sale.itens.reduce((s, it) => s + (it.desconto || 0), 0);
  // positivo: o cliente paga; negativo: a loja devolve dinheiro ao cliente
  // cupom só vale em venda e só enquanto os itens forem os mesmos que o servidor conferiu
  const cupomKey = () => `${sale.itens.map((it) => `${it.productId}:${it.qty}:${it.unit}:${it.desconto || 0}`).join("|")}#${sale.cliente?.tipo || ""}`;
  const descCupom = () => (sale.tipo === "venda" && sale.cupom?.ok && sale.cupom.base === cupomKey() ? sale.cupom.desconto : 0);
  const saldo = () => sale.tipo === "troca" ? r2(soma(sale.itens) - soma(sale.devolvidos)) : sale.tipo === "devolucao" ? -soma(sale.itens) : r2(soma(sale.itens) - descCupom());
  const aPagar = () => Math.abs(saldo());
  const devolvendo = () => saldo() < 0;
  const totalPago = () => sale.pagamentos.reduce((s, p) => s + (p.valor || 0), 0);
  const prontoParaPagar = () => sale.itens.length > 0 && (sale.tipo !== "troca" || sale.devolvidos.length > 0);

  function viewBalcao() {
    return `<div class="admin-head"><div><h1>Venda balcão</h1></div><div id="pdv-loja"></div></div>
      ${asyncView("pdv-root", `<div class="pdv">${skel(5)}</div>`, async () => {
        await loadSetup(true);
        paint("pdv-loja", lojaPicker());
        renderPdv();
      })}`;
  }

  const searchBox = (alvo, placeholder, atalho) => `
    <div class="pdv__search">
      ${icon("i-search")}
      <input id="pdv-q-${alvo}" class="pdv-q" data-alvo="${alvo}" type="search" autocomplete="off" placeholder="${placeholder}" aria-label="${placeholder}" aria-controls="pdv-res-${alvo}" aria-expanded="false" ${sale.etapa === "pagamento" ? "disabled" : ""}>
      ${atalho ? "<kbd>F2</kbd>" : ""}
      <ul class="pdv__results" id="pdv-res-${alvo}" role="listbox" hidden></ul>
    </div>`;

  function tabelaItens(lista, alvo, { estado = false } = {}) {
    const travado = sale.etapa === "pagamento";
    return `<div class="table-wrap"><table class="pdv__table">
      <thead><tr><th>Produto</th><th class="r">Qtd</th><th class="r">Preço un.</th>${estado ? "<th>Estado</th>" : '<th class="r">Desconto</th>'}<th class="r">Subtotal</th><th></th></tr></thead>
      <tbody>${lista.map((it, i) => {
        const p = T().prodBy(it.productId);
        const pouco = alvo === "itens" && sale.tipo !== "devolucao" && p && it.qty > p.stock;
        const ref = `${alvo}:${i}`;
        return `<tr>
          <td><b>${esc(it.name)}${it.code ? ` - ${esc(it.code)}` : ""}</b>${it.variant ? `<small class="muted"> (${esc(it.variant)})</small>` : ""}${pouco ? `<small class="warn-text">Só ${p.stock} em estoque</small>` : ""}</td>
          <td class="r"><input class="cell-in cell-in--qty num" type="number" min="1" step="1" value="${it.qty}" data-pdv-item="${ref}" data-field="qty" aria-label="Quantidade" ${travado ? "disabled" : ""}></td>
          <td class="r"><input class="cell-in num" inputmode="decimal" value="${fmtMoneyInput(it.unit)}" data-pdv-item="${ref}" data-field="unit" aria-label="Preço unitário" ${travado ? "disabled" : ""}></td>
          ${estado
            ? `<td><select class="cell-sel ${it.estado === "defeito" ? "is-bad" : ""}" data-pdv-item="${ref}" data-field="estado" aria-label="Estado do produto devolvido" ${travado ? "disabled" : ""}>
                <option value="bom" ${it.estado !== "defeito" ? "selected" : ""}>Bom</option>
                <option value="defeito" ${it.estado === "defeito" ? "selected" : ""}>Com defeito</option></select><small class="estado-hint">${it.estado === "defeito" ? "não volta ao estoque" : "volta ao estoque"}</small></td>`
            : `<td class="r"><input class="cell-in num" inputmode="decimal" value="${it.desconto ? fmtMoneyInput(it.desconto) : ""}" placeholder="0,00" data-pdv-item="${ref}" data-field="desconto" aria-label="Desconto" ${travado ? "disabled" : ""}></td>`}
          <td class="r num"><b>${money(subItem(it))}</b></td>
          <td class="r">${travado ? "" : `<button class="icon-btn icon-btn--sm" data-pdv-del="${ref}" aria-label="Remover ${esc(it.name)}">${icon("i-trash")}</button>`}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }

  const vazio = (ic, txt) => `<div class="pdv__empty">${icon(ic)}<p>${txt}</p></div>`;

  function renderPdv() {
    const root = $("#pdv-root");
    if (!root) return;
    const c = caixaAberto();
    if (!c) {
      root.innerHTML = abrirCaixaHTML("Abra o caixa desta loja para começar a vender.");
      return;
    }
    if (sale.vendedorId && !vendedoresDaLoja().some((v) => v.id === sale.vendedorId)) sale.vendedorId = "";
    if (sale.cupom?.ok && sale.cupom.base !== cupomKey() && !cupomPdvLoad && sale.itens.length && sale.tipo === "venda") setTimeout(() => aplicarCupomPdv(sale.cupom.code), 0);
    const tipo = sale.tipo;
    const modos = [["venda", "Venda", ""], ["troca", "Troca", "i-swap"], ["devolucao", "Devolução", "i-undo"]];
    let corpo;
    if (tipo === "troca") {
      corpo = `
        <div class="troca">
          <section class="troca__lado troca__lado--volta">
            <h2>${icon("i-undo")}Cliente devolveu</h2>
            ${searchBox("devolvidos", "Produto que voltou: nome ou código", true)}
            ${sale.devolvidos.length ? tabelaItens(sale.devolvidos, "devolvidos", { estado: true }) : vazio("i-undo", "Busque o produto que o cliente trouxe de volta e diga se ele voltou bom ou com defeito.")}
          </section>
          <section class="troca__lado">
            <h2>${icon("i-bag")}Cliente vai levar</h2>
            ${searchBox("itens", "Produto novo: nome ou código")}
            ${sale.itens.length ? tabelaItens(sale.itens, "itens") : vazio("i-bag", "Busque o produto que o cliente vai levar no lugar.")}
          </section>
        </div>`;
    } else {
      const devol = tipo === "devolucao";
      corpo = `${searchBox("itens", devol ? "Produto devolvido: nome ou código" : "Buscar produto por nome ou código", true)}
        ${sale.itens.length ? tabelaItens(sale.itens, "itens", { estado: devol })
          : vazio(devol ? "i-undo" : "i-search", devol ? "Busque o produto que o cliente está devolvendo. Se voltar bom, entra de novo no estoque." : "Busque o produto pelo nome ou código e aperte Enter para adicionar.")}`;
    }
    root.innerHTML = `
      ${abertoOutroDia(c) ? `<div class="alert alert--warn">${icon("i-clock")}<div>Caixa aberto desde <strong>${dia(c.abertoEm)}</strong>. As vendas de hoje vão entrar nele.</div><a class="btn btn--ghost btn--sm" href="#/admin?aba=caixa">Fechar caixa</a></div>` : ""}
      <div class="pdv pdv--${tipo}">
        <section class="pdv__items" aria-label="Itens">
          <div class="pdv__bar">
            <div class="seg" role="radiogroup" aria-label="Tipo de operação">
              ${modos.map(([k, n, ic]) => `<button role="radio" aria-checked="${tipo === k}" class="${tipo === k ? "is-on" : ""}" data-pdv-tipo="${k}">${ic ? icon(ic) : ""}${n}</button>`).join("")}
            </div>
            ${tipo === "venda" && espera().length ? `<div class="espera">${icon("i-pause")}<span>Em espera:</span>${espera().map((e, i) => `<button class="chip" data-pdv-resume="${i}" title="Retomar">${esc(e.cliente?.nome || "Ao consumidor")} · ${e.itens.length} ${e.itens.length === 1 ? "item" : "itens"}</button>`).join("")}</div>` : ""}
          </div>
          ${corpo}
        </section>
        <aside class="pdv__side" aria-label="Fechamento">${sale.etapa === "pagamento" ? pagamentoHTML() : resumoVendaHTML()}</aside>
      </div>`;
    if (sale.etapa === "pagamento") $("#pdv-pay-0")?.focus();
    else if (!cliForm) $(".pdv-q")?.focus();
  }

  const fmtDoc = (v) => (T().digits(v).length > 11 ? T().masks.cnpj(v) : T().masks.cpf(v));

  function clienteHTML() {
    if (cliForm) {
      return `<form class="cli-form" id="cli-form" novalidate>
        <div class="cli-form__head"><b>Cliente novo</b><button type="button" class="text-btn" data-cli-cancel>Cancelar</button></div>
        <div class="seg seg--sm" role="radiogroup" aria-label="Tipo de cliente">
          <label><input type="radio" name="tipo" value="cliente" ${cliForm.tipo !== "lojista" ? "checked" : ""}><span>Cliente</span></label>
          <label><input type="radio" name="tipo" value="lojista" ${cliForm.tipo === "lojista" ? "checked" : ""}><span>Lojista</span></label>
        </div>
        <label class="field"><span>Nome ou razão social</span><input name="nome" value="${esc(cliForm.nome)}" maxlength="120" required autocomplete="off"><span class="err"></span></label>
        <label class="field"><span>CPF ou CNPJ <span class="opt">(opcional)</span></span><input name="doc" inputmode="numeric" data-mask-doc maxlength="18" autocomplete="off"><span class="err"></span></label>
        <label class="field"><span>WhatsApp <span class="opt">(para mandar a notinha)</span></span><input name="phone" inputmode="tel" maxlength="16" placeholder="(33) 99999-9999" autocomplete="off"><span class="err"></span></label>
        <button class="btn btn--primary btn--block btn--sm">${icon("i-check")}Cadastrar e usar</button>
      </form>`;
    }
    if (sale.cliente) {
      const cr = saldoCredito(sale.cliente);
      return `<div class="cli is-set"><div><b>${esc(sale.cliente.nome)}</b>${sale.cliente.tipo === "lojista" ? ' <span class="tag tag--pro">Lojista</span>' : ""}<small class="muted">${esc([sale.cliente.doc, sale.cliente.telefone].filter(Boolean).join(" · ")) || "sem documento"}</small>
        ${sale.cliente.id ? `<small class="cli__credito ${cr > 0 ? "has" : ""}">${icon("i-wallet")}Crédito na loja: <b class="num">${money(cr)}</b></small>` : `<small class="muted">Sem cadastro: não acumula crédito</small>`}</div><button class="text-btn" data-pdv-cli-clear>Trocar</button></div>`;
    }
    return `<div class="cli"><input id="pdv-cli" type="search" autocomplete="off" placeholder="Ao consumidor" aria-label="Cliente"><ul class="pdv__results" id="pdv-cli-results" role="listbox" hidden></ul></div>
      <button type="button" class="text-btn cli-new" data-cli-new>${icon("i-plus")}Cadastrar cliente novo</button>`;
  }

  let cupomPdvLoad = false;
  function cupomPdvHTML() {
    const cp = sale.cupom;
    if (cupomPdvLoad) return `<div class="cupom cupom--load">${icon("i-tag")}Conferindo cupom…</div>`;
    if (cp?.ok && cp.base === cupomKey()) return `<div class="cupom cupom--ok">${icon("i-tag")}<span><b>${esc(cp.code)}</b><small>${esc(cp.descricao)}</small></span><button class="text-btn" data-pdv-cupom-del>Remover</button></div>`;
    return `<form class="cupom-form" id="pdv-cupom" novalidate><input name="cupom" value="${esc(cp && !cp.ok ? cp.code : "")}" placeholder="Cupom de desconto" aria-label="Cupom de desconto" autocomplete="off" maxlength="24"><button class="btn btn--ghost btn--sm">Aplicar</button>${cp && !cp.ok ? `<span class="cupom-err">${esc(cp.error)}</span>` : ""}</form>`;
  }
  async function aplicarCupomPdv(codeRaw) {
    const code = String(codeRaw || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (!code) return;
    cupomPdvLoad = true; renderPdv();
    try {
      const d = await T().fetchJSON("/api/coupons", "POST", { code, canal: "balcao", tipo: sale.cliente?.tipo === "lojista" ? "lojista" : "cliente", itens: sale.itens.map((it) => ({ productId: it.productId, qty: it.qty, sub: subItem(it) })) });
      sale.cupom = d.ok ? { ok: true, code: d.code, desconto: d.desconto, descricao: d.descricao, base: cupomKey() } : { ok: false, code, error: d.error };
    } catch (err) { sale.cupom = { ok: false, code, error: err.message }; }
    cupomPdvLoad = false; saveSale(); renderPdv();
  }

  function resumoVendaHTML() {
    const vend = vendedoresDaLoja();
    const tipo = sale.tipo, s = saldo();
    let totais, botao;
    if (tipo === "troca") {
      totais = `
        <div><dt>Devolveu</dt><dd class="num">-${money(soma(sale.devolvidos))}</dd></div>
        <div><dt>Vai levar</dt><dd class="num">${money(soma(sale.itens))}</dd></div>
        <div class="totals__main"><dt>${s > 0 ? "Cliente paga" : s < 0 ? "Devolver ao cliente" : "Diferença"}</dt><dd class="num ${s < 0 ? "neg" : ""}">${money(Math.abs(s))}</dd></div>`;
      botao = s > 0 ? "Cobrar diferença" : s < 0 ? "Devolver diferença" : "Concluir troca";
    } else {
      totais = `
        <div><dt>Itens</dt><dd class="num">${sale.itens.reduce((n, it) => n + it.qty, 0)}</dd></div>
        ${totalDescontos() && tipo === "venda" ? `<div><dt>Descontos</dt><dd class="num">-${money(totalDescontos())}</dd></div>` : ""}
        ${descCupom() ? `<div><dt>Cupom ${esc(sale.cupom.code)}</dt><dd class="num pos">-${money(descCupom())}</dd></div>` : ""}
        <div class="totals__main"><dt>${tipo === "devolucao" ? "Total a devolver" : "Total"}</dt><dd class="num">${money(aPagar())}</dd></div>`;
      botao = tipo === "devolucao" ? "Devolver valor" : "Ir para o pagamento";
    }
    return `
      <div class="field"><span class="field__label">Cliente</span>${clienteHTML()}</div>
      <div class="field"><label class="field__label" for="pdv-vend">Vendedor</label>
        ${vend.length ? `<select id="pdv-vend" data-pdv-vend><option value="">Escolha quem atendeu</option>${vend.map((v) => `<option value="${esc(v.id)}" ${v.id === sale.vendedorId ? "selected" : ""}>${esc(v.nome)}</option>`).join("")}</select><span class="err" id="pdv-vend-err"></span>`
          : `<form class="vend-rapido" id="vend-rapido" novalidate>
              <p>Nenhum vendedor cadastrado nesta loja. Cadastre quem está atendendo:</p>
              <div class="vend-rapido__row"><input name="nome" id="pdv-vend" maxlength="60" placeholder="Nome do vendedor" aria-label="Nome do vendedor" autocomplete="off"><button class="btn btn--primary btn--sm">Adicionar</button></div>
              <a class="text-btn" href="#/admin?aba=equipe">Gerenciar lojas e vendedores</a>
            </form>`}
      </div>
      ${tipo === "venda" && sale.itens.length ? cupomPdvHTML() : ""}
      <dl class="totals">${totais}</dl>
      <button class="btn ${tipo === "venda" ? "btn--primary" : "btn--dark"} btn--block" data-pdv-pagar ${prontoParaPagar() ? "" : "disabled"}>${botao}<kbd>F9</kbd></button>
      ${sale.itens.length || sale.devolvidos.length ? `<div class="pdv__side-actions">${tipo === "venda" ? `<button class="text-btn" data-pdv-hold>${icon("i-pause")}Deixar em espera</button>` : "<span></span>"}<button class="text-btn" data-pdv-clear>Limpar</button></div>` : ""}`;
  }

  function pagamentoHTML() {
    const total = aPagar(), pago = totalPago();
    const falta = Math.max(0, r2(total - pago));
    const troco = Math.max(0, r2(pago - total));
    const devol = devolvendo();
    const formas = Object.entries(FORMAS).filter(([f]) => !(devol && f === "fiado"));
    const temCad = !!sale.cliente?.id, saldoCli = saldoCredito(sale.cliente);
    const titulo = sale.tipo === "troca" ? (devol ? "Diferença a devolver" : "Diferença a cobrar") : devol ? "Valor a devolver" : "Total";
    return `
      <div class="pay__head"><button class="text-btn" data-pdv-voltar>${icon("i-left")}Itens</button><span class="pay__total num"><small>${titulo}</small>${money(total)}</span></div>
      <p class="muted pay__hint">${devol ? "Como o valor volta para o cliente?" : "Escolha a forma de pagamento. Para dividir, adicione outra forma."}</p>
      <div class="pay__quick">${formas.map(([f, n]) => {
        if (f !== "credito_loja") return `<button class="pay__chip" data-pdv-forma="${f}">${icon(FORMA_IC[f])}${n}</button>`;
        const off = !temCad || (!devol && saldoCli <= 0);
        return `<button class="pay__chip pay__chip--credito ${devol ? "is-sug" : ""}" data-pdv-forma="credito_loja" ${off ? "disabled" : ""} title="${!temCad ? "Cadastre o cliente para usar crédito" : ""}">${icon("i-wallet")}${devol ? "Gerar crédito" : `Crédito <small class="num">${money(saldoCli)}</small>`}</button>`;
      }).join("")}</div>
      ${!temCad ? `<p class="pay__note">Para ${devol ? "gerar" : "usar"} crédito na loja, escolha ou cadastre o cliente.</p>` : devol ? `<p class="pay__note">O valor vira crédito para ${esc(sale.cliente.nome)} usar em outra compra.</p>` : ""}
      <div class="pay__rows">${sale.pagamentos.map((p, i) => `
        <div class="pay__row">
          <span class="pay__forma">${icon(FORMA_IC[p.forma])}${FORMAS[p.forma]}</span>
          <input id="pdv-pay-${i}" class="cell-in num" inputmode="decimal" value="${fmtMoneyInput(p.valor)}" data-pdv-pay="${i}" aria-label="Valor em ${FORMAS[p.forma]}">
          <button class="icon-btn icon-btn--sm" data-pdv-pay-del="${i}" aria-label="Remover ${FORMAS[p.forma]}">${icon("i-x")}</button>
        </div>`).join("") || `<p class="pay__none">Nenhuma forma escolhida.</p>`}
      </div>
      <dl class="totals">
        <div><dt>${devol ? "Devolvido" : "Recebido"}</dt><dd class="num">${money(pago)}</dd></div>
        ${falta ? `<div class="totals__falta"><dt>Falta</dt><dd class="num">${money(falta)}</dd></div>` : ""}
        ${troco ? `<div class="totals__troco"><dt>Troco</dt><dd class="num">${money(troco)}</dd></div>` : ""}
      </dl>
      <label class="field"><span>Observação <span class="opt">(sai na notinha)</span></span><input id="pdv-obs" maxlength="300" value="${esc(sale.obs)}" placeholder="Ex.: garantia de 90 dias"></label>
      <button class="btn ${sale.tipo === "venda" ? "btn--primary" : "btn--dark"} btn--block" data-pdv-concluir ${falta || !sale.pagamentos.length ? "disabled" : ""}>${icon("i-check")}${{ venda: "Concluir venda", troca: "Concluir troca", devolucao: "Concluir devolução" }[sale.tipo]}<kbd>Enter</kbd></button>
      <span class="err" id="pdv-pay-err"></span>`;
  }

  // ---- busca de produtos (uma caixa por lista: "itens" e, na troca, "devolvidos") ----
  let results = [], resultIdx = 0, searchAlvo = "itens";
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // sugestões só a partir de 4 letras ("TEL" não sugere, "TELA" já sugere)
  const MIN_BUSCA = 4;
  const curta = (q) => norm(q).replace(/\s+/g, "").length < MIN_BUSCA;
  const dicaBusca = (q) => `<li class="res__none">Digite pelo menos ${MIN_BUSCA} letras${q.trim() ? ` (faltam ${MIN_BUSCA - norm(q).replace(/\s+/g, "").length})` : ""}.</li>`;
  function buscar(q) {
    const n = norm(q).trim();
    if (!n || curta(q)) return [];
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
    const ul = $(`#pdv-res-${searchAlvo}`), q = $(`#pdv-q-${searchAlvo}`);
    if (!ul || !q) return;
    $$(".pdv__search .pdv__results").forEach((u) => { if (u !== ul) u.hidden = true; });
    ul.hidden = !results.length && !q.value.trim();
    q.setAttribute("aria-expanded", String(!ul.hidden));
    const voltando = searchAlvo === "devolvidos" || sale.tipo === "devolucao";
    ul.innerHTML = results.length ? results.map((p, i) => `
      <li role="option" id="pdv-r-${i}" aria-selected="${i === resultIdx}" class="${i === resultIdx ? "is-sel" : ""}" data-pdv-add="${esc(p.id)}">
        <span class="row__thumb">${T().media(p)}</span>
        <span class="res__name"><b>${esc(p.name)}</b><small class="muted">${esc(p.code)} · ${voltando ? "volta para o estoque se estiver bom" : p.stock > 0 ? `${p.stock} em estoque` : '<span class="warn-text">sem estoque</span>'}</small></span>
        <span class="num res__price">${money(precoPara(p))}</span>
      </li>`).join("") : curta(q.value) ? dicaBusca(q.value) : `<li class="res__none">Nada encontrado para “${esc(q.value)}”.</li>`;
    q.setAttribute("aria-activedescendant", results.length ? `pdv-r-${resultIdx}` : "");
  }
  function addProduto(id, alvo = searchAlvo) {
    const p = T().prodBy(id);
    if (!p) return;
    const lista = alvo === "devolvidos" ? sale.devolvidos : sale.itens;
    const variant = p.variants ? p.variants[0][0] : null;
    const delta = p.variants ? p.variants[0][1] : 0;
    const existing = lista.find((it) => it.productId === p.id && it.variant === variant);
    if (existing) existing.qty++;
    else {
      const item = { productId: p.id, name: p.name, code: p.code, variant, qty: 1, unit: precoPara(p) + delta, desconto: 0, custo: p.cost || 0 };
      if (alvo === "devolvidos" || sale.tipo === "devolucao") item.estado = "bom";
      lista.push(item);
    }
    if (alvo === "itens" && sale.tipo !== "devolucao" && p.stock <= 0) T().toast(`${p.name} está sem estoque no sistema. Confira antes de entregar.`);
    results = []; saveSale(); renderPdv();
    // na troca, depois de lançar o que voltou, já posiciona na busca do produto novo
    if (alvo === "devolvidos" && !sale.itens.length) $("#pdv-q-itens")?.focus();
    else $(`#pdv-q-${alvo}`)?.focus();
  }

  // ---- clientes (cadastros do site + clientes do balcão no servidor + usados recentemente) ----
  function clientesConhecidos() {
    const list = T().users().map((u) => ({
      nome: u.type === "lojista" ? (u.fantasia || u.razao) : u.name, doc: u.cnpj || u.cpf || "", telefone: u.phone || "", tipo: u.type === "lojista" ? "lojista" : "cliente",
    }));
    const add = (c) => { if (c?.nome && !list.some((x) => norm(x.nome) === norm(c.nome) && (x.doc || "") === (c.doc || ""))) list.push(c); };
    // clientes cadastrados no balcão vêm primeiro (têm id e crédito)
    const cad = (setup?.clientes || []).map((c) => ({ id: c.id, nome: c.nome, doc: c.doc, telefone: c.telefone, tipo: c.tipo, credito: c.credito || 0 }));
    const out = [...cad];
    list.forEach((c) => { if (!out.some((x) => norm(x.nome) === norm(c.nome) && (x.doc || "") === (c.doc || ""))) out.push(c); });
    store.get("ts_pdv_clientes", []).forEach((c) => { if (!out.some((x) => norm(x.nome) === norm(c.nome))) out.push(c); });
    return out;
  }
  function renderCliResults(q) {
    const ul = $("#pdv-cli-results");
    if (!ul) return;
    const n = norm(q).trim();
    if (!n) { ul.hidden = true; return; }
    const found = clientesConhecidos().filter((c) => norm(`${c.nome} ${c.doc} ${c.telefone}`).includes(n) || (T().digits(q).length >= 3 && T().digits(`${c.doc}${c.telefone}`).includes(T().digits(q)))).slice(0, 6);
    ul.hidden = false;
    ul.innerHTML = found.map((c, i) => `<li role="option" data-pdv-cli="${i}"><span class="res__name"><b>${esc(c.nome)}</b><small class="muted">${esc([c.doc, c.telefone].filter(Boolean).join(" · "))}${c.credito ? ` · crédito ${money(c.credito)}` : ""}</small></span>${c.tipo === "lojista" ? '<span class="tag tag--pro">Lojista</span>' : ""}</li>`).join("")
      + `<li role="option" data-cli-new><span class="res__name"><b>${icon("i-plus")} Cadastrar “${esc(q.trim())}”</b><small class="muted">Cliente novo, com CPF ou CNPJ e WhatsApp</small></span></li>`
      + `<li role="option" data-pdv-cli-new><span class="res__name"><b>Usar só o nome</b><small class="muted">Sem cadastro</small></span></li>`;
    ul._found = found;
  }
  function setCliente(c) {
    sale.cliente = c;
    cliForm = null;
    // ao trocar para lojista (ou voltar para consumidor), recalcula os preços que não foram editados à mão
    [...sale.itens, ...sale.devolvidos].forEach((it) => {
      const p = T().prodBy(it.productId);
      if (p && !it.editado) it.unit = precoPara(p) + (p.variants?.find(([n]) => n === it.variant)?.[1] || 0);
    });
    if (c) {
      const rec = store.get("ts_pdv_clientes", []).filter((x) => norm(x.nome) !== norm(c.nome));
      store.set("ts_pdv_clientes", [c, ...rec].slice(0, 200));
    }
    saveSale(); renderPdv();
  }
  async function salvarClienteNovo(f) {
    const nome = f.nome.value.trim(), doc = f.doc.value.trim(), tel = f.phone.value.trim();
    const dig = T().digits(doc);
    const erros = {
      nome: nome.length < 2 ? "Informe o nome" : "",
      doc: !dig ? "" : dig.length === 11 ? "" : dig.length === 14 ? "" : "CPF tem 11 dígitos e CNPJ tem 14",
      phone: !tel || T().digits(tel).length >= 10 ? "" : "WhatsApp incompleto",
    };
    Object.entries(erros).forEach(([k, m]) => T().setErr(f, k, m));
    if (Object.values(erros).some(Boolean)) return;
    const btn = f.querySelector("button.btn"); btn.disabled = true;
    try {
      const { cliente, existente } = await api("r=clientes", "POST", { nome, doc, telefone: tel, tipo: f.tipo.value });
      setup.clientes = [cliente, ...(setup.clientes || []).filter((x) => x.id !== cliente.id)];
      if (existente) T().toast(`${cliente.nome} já estava cadastrado. Usando o cadastro existente.`);
      setCliente({ id: cliente.id, nome: cliente.nome, doc: cliente.doc, telefone: cliente.telefone, tipo: cliente.tipo });
    } catch (err) { btn.disabled = false; T().toast(err.message); }
  }

  // ---- concluir ----
  async function concluir() {
    const btn = $("[data-pdv-concluir]") || $("[data-pdv-pagar]");
    if (!btn || btn.disabled) return;
    sale.obs = $("#pdv-obs")?.value.trim() || sale.obs || "";
    btn.disabled = true;
    const limpa = (l) => l.map(({ productId, name, code, variant, qty, unit, desconto, custo, estado }) => ({ productId, name, code, variant, qty, unit, desconto, custo, estado }));
    try {
      const { venda, estoque } = await api("r=venda", "POST", {
        lojaId: lojaId(), tipo: sale.tipo, vendedorId: sale.vendedorId, cliente: sale.cliente, obs: sale.obs, por: T().session()?.name,
        itens: limpa(sale.itens), devolvidos: limpa(sale.devolvidos),
        pagamentos: aPagar() ? sale.pagamentos : [],
        cupom: descCupom() ? sale.cupom.code : undefined,
      });
      // o servidor já deu baixa (ou devolveu) e manda o saldo novo de cada produto
      if (T().catalogoServidor) T().aplicarEstoque(estoque);
      else {
        // catálogo ainda só neste navegador: estoque local, como antes
        const mexe = (it, delta) => { const p = T().prodBy(it.productId); if (p) p.stock = Math.max(0, p.stock + delta); };
        if (sale.tipo === "devolucao") sale.itens.forEach((it) => it.estado !== "defeito" && mexe(it, it.qty));
        else sale.itens.forEach((it) => mexe(it, -it.qty));
        sale.devolvidos.forEach((it) => it.estado !== "defeito" && mexe(it, it.qty));
        T().saveProducts();
      }
      store.set("ts_pdv_vendedor", sale.vendedorId);
      sale = novaVenda(); saveSale();
      renderPdv();
      mostrarNota(venda);
      if (venda.creditoMov) loadSetup(true).catch(() => {}); // atualiza o saldo de crédito dos clientes
    } catch (err) {
      btn.disabled = false;
      const e = $("#pdv-pay-err"); if (e) e.textContent = err.message; else T().toast(err.message);
      if (err.status === 409) { await loadSetup(true); renderPdv(); T().toast(err.message); }
    }
  }

  // ======================================================================
  // NOTINHA (cupom da venda): tela, impressão, imagem e WhatsApp
  // ======================================================================
  const TITULO = { venda: "VENDA", devolucao: "DEVOLUÇÃO", troca: "TROCA" };
  const linhaItem = (it) => `${it.qty}x ${it.name}${it.code ? ` - ${it.code}` : ""}${it.variant ? ` (${it.variant})` : ""}`;
  const estadoTxt = (it) => (it.estado === "defeito" ? "com defeito" : "bom estado");
  function notaLinhas(v) {
    const L = [];
    L.push({ t: "TOP SMART", a: "c", b: 1, s: 1.5 }, { t: v.lojaNome, a: "c" }, { t: "WhatsApp (33) 99941-4255", a: "c" }, { sep: 1 });
    L.push({ t: `${TITULO[v.tipo] || "VENDA"} ${v.code}`, a: "c", b: 1, s: 1.2 });
    L.push({ l: "Data", r: `${new Date(v.criadaEm).toLocaleDateString("pt-BR")} ${hora(v.criadaEm)}` });
    L.push({ l: "Cliente", r: v.cliente?.nome || "Ao consumidor" });
    if (v.cliente?.doc) L.push({ l: v.cliente.tipo === "lojista" ? "CNPJ" : "CPF", r: v.cliente.doc });
    L.push({ l: "Vendedor", r: v.vendedor.nome }, { sep: 1 });
    const bloco = (lista, comEstado) => lista.forEach((it) => {
      L.push({ t: linhaItem(it), wrap: 1 });
      L.push({ l: `   ${it.qty} x ${money(it.unit)}${it.desconto ? ` - desc. ${money(it.desconto)}` : ""}${comEstado ? ` · ${estadoTxt(it)}` : ""}`, r: money(it.sub) });
    });
    if (v.tipo === "troca") {
      L.push({ t: "DEVOLVEU", b: 1 }); bloco(v.devolvidos, true);
      L.push({ l: "Crédito", r: `-${money(v.voltou)}` }, { sep: 1 });
      L.push({ t: "LEVOU", b: 1 }); bloco(v.itens, false);
      L.push({ l: "Total levado", r: money(v.levado) }, { sep: 1 });
      L.push({ l: v.diferenca > 0 ? "CLIENTE PAGOU" : v.diferenca < 0 ? "DEVOLVIDO AO CLIENTE" : "SEM DIFERENÇA", r: money(Math.abs(v.diferenca)), b: 1, s: 1.15 }, { sep: 1 });
    } else {
      bloco(v.itens, v.tipo === "devolucao");
      L.push({ sep: 1 });
      if (v.cupom) L.push({ l: "Subtotal", r: money(v.subtotal) }, { l: `Cupom ${v.cupom.code}`, r: `-${money(v.cupom.desconto)}` });
      L.push({ l: v.tipo === "devolucao" ? "TOTAL DEVOLVIDO" : "TOTAL", r: money(v.total), b: 1, s: 1.2 }, { sep: 1 });
    }
    v.pagamentos.forEach((p) => L.push({ l: FORMAS[p.forma], r: money(p.recebido ?? p.valor) }));
    if (v.troco) L.push({ l: "Troco", r: money(v.troco) });
    if (v.pagamentos.some((p) => p.forma === "fiado")) L.push({ t: "Valor no fiado: a pagar na loja.", a: "c" });
    if (v.creditoMov > 0) L.push({ t: `Crédito gerado: ${money(v.creditoMov)}`, a: "c", b: 1 });
    if (v.creditoMov && v.creditoSaldo != null) L.push({ t: `Saldo de crédito na loja: ${money(v.creditoSaldo)}`, a: "c" });
    if (v.obs) L.push({ sep: 1 }, { t: `Obs.: ${v.obs}`, wrap: 1 });
    L.push({ sep: 1 }, { t: "Obrigado pela preferência!", a: "c" }, { t: "Aqui tem inovação!", a: "c" });
    return L;
  }  function notaHTML(v) {
    const rows = notaLinhas(v).map((x) => {
      if (x.sep) return '<div class="rc__cut"></div>';
      if (x.l !== undefined) return `<div class="rc__row ${x.b ? "rc__row--b" : ""}"><span>${esc(x.l)}</span><span>${esc(x.r)}</span></div>`;
      return `<div class="rc__line rc__line--${x.a || "l"} ${x.b ? "rc__line--b" : ""}" ${x.s ? `style="font-size:${x.s}em"` : ""}>${esc(x.t)}</div>`;
    }).join("");
    return `<div class="receipt-wrap"><article class="receipt nota" id="rc-${esc(v.code)}">${rows}</article></div>`;
  }
  function notaTexto(v) {
    const item = (it, comEstado) => `*${it.qty}x* ${it.name}${it.code ? ` - ${it.code}` : ""}${it.variant ? ` (${it.variant})` : ""}${comEstado ? ` (${estadoTxt(it)})` : ""} - *${money(it.sub)}*`;
    const corpo = v.tipo === "troca"
      ? ["Devolveu:", ...v.devolvidos.map((it) => item(it, true)), "", "Levou:", ...v.itens.map((it) => item(it)), "",
        v.diferenca > 0 ? `Diferença paga: *${money(v.diferenca)}*` : v.diferenca < 0 ? `Devolvido ao cliente: *${money(-v.diferenca)}*` : "Troca sem diferença de valor"]
      : [...v.itens.map((it) => item(it, v.tipo === "devolucao")), "", ...(v.cupom ? [`Cupom ${v.cupom.code}: -${money(v.cupom.desconto)}`] : []), `${v.tipo === "devolucao" ? "Total devolvido" : "Total"}: *${money(v.total)}*`];
    return [
      `*${TITULO[v.tipo] || "VENDA"} ${v.code}*`, `${v.lojaNome} · ${new Date(v.criadaEm).toLocaleDateString("pt-BR")} ${hora(v.criadaEm)}`, "",
      `Cliente: ${v.cliente?.nome || "Ao consumidor"}`, `Vendedor: ${v.vendedor.nome}`, "",
      ...corpo,
      ...(v.pagamentos.length ? [`Pagamento: ${v.pagamentos.map((p) => `${FORMAS[p.forma]} ${money(p.recebido ?? p.valor)}`).join(" + ")}${v.troco ? ` (troco ${money(v.troco)})` : ""}`] : []),
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
      <div class="nota__head"><div class="order-badge">${icon("i-check")}${{ devolucao: "Devolução registrada", troca: "Troca concluída" }[v.tipo] || "Venda concluída"}</div><button class="icon-btn icon-btn--sm" data-close-modal aria-label="Fechar">${icon("i-x")}</button></div>
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

  // produtos que saíram e voltaram num conjunto de vendas (relatório do fim do dia)
  function movProdutos(vendas) {
    const saiu = {}, voltou = {};
    const add = (map, it, estado = "") => {
      const x = (map[`${it.productId || it.name}|${it.variant || ""}|${estado}`] ||= { name: it.name, code: it.code, variant: it.variant, estado, qty: 0, valor: 0 });
      x.qty += it.qty; x.valor += it.sub ?? it.unit * it.qty;
    };
    vendas.filter((v) => v.status !== "CANCELADA").forEach((v) => {
      if (v.tipo === "devolucao") v.itens.forEach((it) => add(voltou, it, it.estado || "bom"));
      else v.itens.forEach((it) => add(saiu, it));
      (v.devolvidos || []).forEach((it) => add(voltou, it, it.estado || "bom"));
    });
    const ord = (m) => Object.values(m).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
    return { saiu: ord(saiu), voltou: ord(voltou) };
  }
  const somaQtd = (l) => l.reduce((s, x) => s + x.qty, 0);
  function produtosDiaHTML(vendas) {
    const { saiu, voltou } = movProdutos(vendas);
    const linha = (x) => `<li><span class="num">${x.qty}x</span><span>${esc(x.name)}${x.code ? ` <small class="muted">${esc(x.code)}</small>` : ""}${x.variant ? ` (${esc(x.variant)})` : ""}${x.estado ? ` <span class="tag ${x.estado === "defeito" ? "tag--bad" : "tag--ok"}">${x.estado === "defeito" ? "com defeito" : "voltou ao estoque"}</span>` : ""}</span><b class="num">${money(x.valor)}</b></li>`;
    return `<div class="pdia">
      <div><h3>Saiu <span class="muted">(${somaQtd(saiu)} ${somaQtd(saiu) === 1 ? "item" : "itens"})</span></h3>${saiu.length ? `<ul class="mlist">${saiu.map(linha).join("")}</ul>` : '<p class="muted">Nada saiu ainda.</p>'}</div>
      <div><h3>Voltou <span class="muted">(${somaQtd(voltou)} ${somaQtd(voltou) === 1 ? "item" : "itens"})</span></h3>${voltou.length ? `<ul class="mlist">${voltou.map(linha).join("")}</ul>` : '<p class="muted">Nenhuma devolução ou troca.</p>'}</div>
    </div>`;
  }
  const ACAO = { abriu: "Abriu o caixa", retirada: "Retirada", reforco: "Reforço", recebimento: "Fiado recebido", fechou: "Fechou o caixa", estorno: "Despesa estornada" };
  const logHTML = (c) => (c.log || []).length
    ? `<ul class="mlist mlist--log">${c.log.map((l) => `<li><span class="num">${dia(l.em)} ${hora(l.em)}</span><span>${ACAO[l.acao] || esc(l.acao)}${l.forma ? ` (${FORMAS[l.forma]})` : ""}${l.por ? ` · <b>${esc(l.por)}</b>` : ""}</span><b class="num">${l.valor != null ? money(l.valor) : ""}</b></li>`).join("")}</ul>`
    : `<p class="muted">Aberto em ${dia(c.abertoEm)} às ${hora(c.abertoEm)}${c.fechadoEm ? `, fechado em ${dia(c.fechadoEm)} às ${hora(c.fechadoEm)}` : ""}.</p>`;
  const quem = (c) => `${dia(c.abertoEm)} às ${hora(c.abertoEm)}${c.abertoPor ? ` por ${esc(c.abertoPor)}` : ""}`;
  const movTxt = (m) => m.tipo === "recebimento" ? `Fiado recebido (${FORMAS[m.forma]})${m.motivo ? `: ${esc(m.motivo.replace(/^Fiado de /, ""))}` : ""}` : `${m.tipo === "sangria" ? "Retirada" : "Reforço"}${m.motivo ? `: ${esc(m.motivo)}` : ""}`;

  // folha A4 do fechamento: formas de pagamento, movimentos e produtos do dia
  function imprimirFechamento(c, r, vendas) {
    const e = r.entradas || r.porForma;
    const { saiu, voltou } = movProdutos(vendas);
    const tab = (l, estado) => l.length ? `<table class="rep__table"><thead><tr><th>Qtd</th><th>Produto</th>${estado ? "<th>Estado</th>" : ""}<th class="r">Valor</th></tr></thead><tbody>${l.map((x) => `<tr><td class="num">${x.qty}</td><td>${esc(x.name)}${x.code ? ` - ${esc(x.code)}` : ""}${x.variant ? ` (${esc(x.variant)})` : ""}</td>${estado ? `<td>${x.estado === "defeito" ? "Com defeito" : "Bom (voltou ao estoque)"}</td>` : ""}<td class="r num">${money(x.valor)}</td></tr>`).join("")}</tbody></table>` : "<p>Nenhum.</p>";
    const sheet = document.createElement("div");
    sheet.id = "print-sheet";
    sheet.innerHTML = `
      <header class="sheet__head"><strong>TOP SMART · ${esc(c.lojaNome)}</strong><span>Fechamento de caixa · ${dia(c.abertoEm)}</span></header>
      <p>Aberto em ${quem(c)}${c.fechadoEm ? ` · Fechado em ${dia(c.fechadoEm)} às ${hora(c.fechadoEm)}${c.fechadoPor ? ` por ${esc(c.fechadoPor)}` : ""}` : " · ainda aberto"}</p>
      <table class="rep__table"><tbody>
        <tr><td>Fundo de caixa</td><td class="r num">${money(c.fundo)}</td></tr>
        <tr><td><b>Vendas (${r.qtdVendas})</b></td><td class="r num"><b>${money(r.liquido)}</b></td></tr>
        <tr><td>Pix</td><td class="r num">${money(e.pix)}</td></tr>
        <tr><td>Dinheiro</td><td class="r num">${money(e.dinheiro)}</td></tr>
        <tr><td>Cartão de crédito</td><td class="r num">${money(e.credito)}</td></tr>
        <tr><td>Cartão de débito</td><td class="r num">${money(e.debito)}</td></tr>
        ${r.recebido ? `<tr><td>Fiado recebido (já somado nas formas)</td><td class="r num">${money(r.recebido)}</td></tr>` : ""}
        ${r.porForma.fiado ? `<tr><td>Vendido no fiado (a receber)</td><td class="r num">${money(r.porForma.fiado)}</td></tr>` : ""}
        ${r.devolvido ? `<tr><td>Devoluções</td><td class="r num">-${money(r.devolvido)}</td></tr>` : ""}
        ${r.sangrias ? `<tr><td>Retiradas</td><td class="r num">-${money(r.sangrias)}</td></tr>` : ""}
        ${r.suprimentos ? `<tr><td>Reforços</td><td class="r num">${money(r.suprimentos)}</td></tr>` : ""}
        <tr><td><b>Dinheiro na gaveta (esperado)</b></td><td class="r num"><b>${money(r.dinheiroEsperado)}</b></td></tr>
        ${c.contado != null ? `<tr><td>Contado</td><td class="r num">${money(c.contado)}${r.diferenca ? ` (${r.diferenca > 0 ? "sobra" : "falta"} ${money(Math.abs(r.diferenca))})` : ""}</td></tr>` : ""}
      </tbody></table>
      <h3>Produtos que saíram (${somaQtd(saiu)})</h3>${tab(saiu)}
      <h3>Produtos que voltaram (${somaQtd(voltou)})</h3>${tab(voltou, true)}
      ${c.obs ? `<p>Obs.: ${esc(c.obs)}</p>` : ""}`;
    document.body.append(sheet);
    document.body.classList.add("printing-sheet");
    window.print();
    document.body.classList.remove("printing-sheet");
    sheet.remove();
  }

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
      const f = r.porForma, e = r.entradas || f;
      atual = `
        ${abertoOutroDia(caixa) ? `<div class="alert alert--warn">${icon("i-clock")}<div><strong>Aberto há ${caixaDias(caixa) || 1} ${caixaDias(caixa) > 1 ? "dias" : "dia"}, desde ${dia(caixa.abertoEm)} às ${hora(caixa.abertoEm)}.</strong> Feche este caixa e abra um novo para o dia de hoje.</div></div>` : ""}
        <section class="box caixa">
          <div class="box__head"><h2>Caixa aberto</h2><span class="muted">desde ${quem(caixa)}</span>
            <button class="btn btn--ghost btn--sm" data-caixa-print="${esc(caixa.id)}">${icon("i-print")}Imprimir</button></div>
          <div class="stats">
            ${stat("Vendas", money(r.liquido), `${r.qtdVendas} ${r.qtdVendas === 1 ? "venda" : "vendas"}${r.qtdDevolucoes ? ` · ${r.qtdDevolucoes} devol.` : ""}`, "stat--main")}
            ${stat("Dinheiro na gaveta", money(r.dinheiroEsperado), `fundo ${money(caixa.fundo)} + dinheiro${r.sangrias ? " - retiradas" : ""}`)}
            ${stat("Pix", money(e.pix), r.recebimentos?.pix ? `inclui ${money(r.recebimentos.pix)} de fiado` : "")}
            ${stat("Cartão", money(e.credito + e.debito), `crédito ${money(e.credito)} · débito ${money(e.debito)}`)}
            ${f.fiado ? stat("Vendido no fiado", money(f.fiado), "a receber") : ""}
            ${r.recebido ? stat("Fiado recebido", money(r.recebido), "já somado nas formas") : ""}
            ${f.credito_loja ? stat(f.credito_loja < 0 ? "Crédito gerado" : "Pago com crédito", money(Math.abs(f.credito_loja)), f.credito_loja < 0 ? "trocas e devoluções" : "não entra na gaveta") : ""}
          </div>
          <div class="caixa__cols">
            <div>
              <h3>Vendas deste caixa</h3>
              ${vendas.length ? `<ul class="vlist">${[...vendas].reverse().map((v) => `
                <li class="${v.status === "CANCELADA" ? "is-cancel" : ""}">
                  <span class="vlist__time num">${hora(v.criadaEm)}</span>
                  <span class="vlist__who"><b>${esc(v.code)}</b> ${esc(v.cliente?.nome || "Ao consumidor")}<small class="muted">${esc(v.vendedor.nome)} · ${v.pagamentos.map((p) => FORMAS[p.forma]).join(" + ")}${v.status === "CANCELADA" ? " · cancelada" : ""}</small></span>
                  <span class="num vlist__val ${v.tipo === "devolucao" || v.diferenca < 0 ? "neg" : ""}">${v.tipo === "devolucao" || v.diferenca < 0 ? "-" : ""}${money(v.total)}${v.tipo === "troca" ? "<small>troca</small>" : ""}</span>
                  <span class="vlist__act">
                    <button class="icon-btn icon-btn--sm" data-caixa-nota="${esc(v.code)}" aria-label="Ver notinha ${esc(v.code)}">${icon("i-receipt")}</button>
                    ${v.status !== "CANCELADA" ? `<button class="icon-btn icon-btn--sm" data-caixa-cancel="${esc(v.code)}" aria-label="Cancelar ${esc(v.code)}">${icon("i-x")}</button>` : ""}
                  </span>
                </li>`).join("")}</ul>` : `<p class="muted">Nenhuma venda ainda. <a class="link-arrow" href="#/admin?aba=balcao">Fazer uma venda ${icon("i-arrow")}</a></p>`}
            </div>
            <div>
              <h3>Retiradas, reforços e fiado recebido</h3>
              ${caixa.movimentos.length ? `<ul class="mlist">${caixa.movimentos.map((m) => `<li><span class="num">${hora(m.em)}</span><span>${movTxt(m)}</span><b class="num ${m.tipo === "sangria" ? "neg" : ""}">${m.tipo === "sangria" ? "-" : "+"}${money(m.valor)}</b></li>`).join("")}</ul>` : `<p class="muted">Pagou algo com o dinheiro da gaveta? Registre aqui.</p>`}
              <form class="mov" id="mov-form" novalidate>
                <div class="seg seg--sm" role="radiogroup" aria-label="Tipo">
                  <label><input type="radio" name="tipo" value="sangria" checked><span>Retirada</span></label>
                  <label><input type="radio" name="tipo" value="suprimento"><span>Reforço</span></label>
                </div>
                <span class="money-input"><span>R$</span><input name="valor" inputmode="decimal" placeholder="0,00" aria-label="Valor"></span>
                <input name="motivo" maxlength="120" placeholder="Motivo (ex.: almoço, fornecedor)" aria-label="Motivo">
                <button class="btn btn--ghost btn--sm">Registrar</button>
              </form>
              <p class="muted mov__hint">Conta de luz, aluguel ou fornecedor? Lance em <a href="#/admin?aba=despesas">Despesas</a> e marque "pago com o dinheiro do caixa".</p>
            </div>
          </div>
        </section>
        <section class="box">
          <div class="box__head"><h2>Produtos do dia</h2><span class="muted">o que saiu e o que voltou neste caixa</span></div>
          ${produtosDiaHTML(vendas)}
        </section>
        <details class="box caixa-log"><summary><h2>Registro do caixa</h2><span class="muted">abertura, retiradas, fiado e fechamento, com horário e quem fez</span>${icon("i-down")}</summary>${logHTML(caixa)}</details>
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
    root.innerHTML = `${atual}<section class="box"><div class="box__head"><h2>Caixas anteriores</h2><span class="muted">um por dia</span></div><div id="caixa-hist">${skel(3)}</div></section>`;
    try {
      const { caixas } = await historicoP;
      const fechados = caixas.filter((x) => x.caixa.status === "FECHADO");
      paint("caixa-hist", fechados.length ? `<div class="olist">${fechados.map(({ caixa: k, resumo: r }) => {
        const e = r.entradas || r.porForma;
        return `
        <details class="hist">
          <summary>
            <span class="num">${dia(k.abertoEm)}</span>
            <span class="hist__when">${hora(k.abertoEm)} até ${k.fechadoEm ? `${dia(k.fechadoEm) !== dia(k.abertoEm) ? `${dia(k.fechadoEm)} ` : ""}${hora(k.fechadoEm)}` : "-"}<small class="hist__formas">Pix ${money(e.pix)} · Dinheiro ${money(e.dinheiro)} · Cartão ${money(e.credito + e.debito)}</small></span>
            <span class="num"><b>${money(r.liquido)}</b></span>
            <span class="hist__dif ${r.diferenca ? (r.diferenca > 0 ? "pos" : "neg") : ""}">${r.diferenca ? `${r.diferenca > 0 ? "Sobra" : "Falta"} ${money(Math.abs(r.diferenca))}` : "Bateu"}</span>
            ${icon("i-down")}
          </summary>
          <div class="hist__body">
            <pre class="fech-txt">${esc(fechamentoTexto(k, r))}</pre>
            <div class="hist__actions">
              <button class="btn btn--wa btn--sm" data-fech-wa="${esc(k.id)}">${icon("i-wa")}Enviar no grupo</button>
              <button class="btn btn--ghost btn--sm" data-fech-copy="${esc(k.id)}">${icon("i-copy")}Copiar</button>
              <button class="btn btn--ghost btn--sm" data-caixa-print="${esc(k.id)}">${icon("i-print")}Imprimir fechamento</button>
              <button class="btn btn--ghost btn--sm" data-caixa-prod="${esc(k.id)}">${icon("i-box")}Produtos do dia</button>
              <a class="btn btn--ghost btn--sm" href="#/admin?aba=relatorios&de=${k.abertoEm.slice(0, 10)}&ate=${(k.fechadoEm || k.abertoEm).slice(0, 10)}">${icon("i-chart")}Relatório do período</a>
            </div>
            <div id="hist-prod-${esc(k.id)}"></div>
          </div>
        </details>`;
      }).join("")}</div>` : `<p class="muted">Os caixas fechados aparecem aqui, com o texto do fechamento pronto para o WhatsApp.</p>`);
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
    // datas vêm do endereço (#...&de=&ate=): só aceita AAAA-MM-DD, nunca texto livre
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    const dataOk = (v) => (isoRe.test(v || "") ? v : iso(new Date()));
    const { de, ate } = p === "custom" ? { de: dataOk(params.get("de")), ate: dataOk(params.get("ate")) } : periodo(p);
    const vis = params.get("vis") || "produtos";
    const lojaSel = params.get("loja") ?? "";
    return `<div class="admin-head no-print"><div><h1>Relatórios</h1></div>
        <div class="rep__tools"><button class="btn btn--ghost btn--sm" data-rep-csv>${icon("i-download")}Planilha</button><button class="btn btn--dark btn--sm" data-rep-print>${icon("i-print")}Imprimir ou PDF</button></div></div>
      <form class="rep__filters no-print" id="rep-form">
        <div class="seg" role="radiogroup" aria-label="Período">${Object.entries(PERIODOS).map(([k, v]) => `<button type="button" role="radio" aria-checked="${p === k}" class="${p === k ? "is-on" : ""}" data-rep-p="${k}">${v}</button>`).join("")}</div>
        <label class="rep__date"><span>De</span><input type="date" name="de" value="${esc(de)}"></label>
        <label class="rep__date"><span>Até</span><input type="date" name="ate" value="${esc(ate)}"></label>
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
    let qtd = 0, custo = 0, fat = 0, perdas = 0, cupons = 0;
    // sai: venda e o que o cliente levou na troca. volta: devolução e o que o cliente trouxe na troca.
    // o que volta bom recupera o custo (volta ao estoque); com defeito, o custo vira perda.
    const conta = (it, sinal) => {
      const k = `${it.name}|${it.code}`;
      const p = (prods[k] ||= { name: it.name, code: it.code, qtd: 0, custo: 0, valor: 0 });
      const c = sinal > 0 || it.estado !== "defeito" ? sinal * it.custo * it.qty : 0;
      if (sinal < 0 && it.estado === "defeito") perdas += it.custo * it.qty;
      p.qtd += sinal * it.qty; p.custo += c; p.valor += sinal * it.sub;
      qtd += sinal * it.qty; custo += c; fat += sinal * it.sub;
    };
    for (const v of vendas) {
      if (v.tipo === "devolucao") v.itens.forEach((it) => conta(it, -1));
      else v.itens.forEach((it) => conta(it, 1));
      (v.devolvidos || []).forEach((it) => conta(it, -1));
      if (v.cupom) { cupons += v.cupom.desconto; fat -= v.cupom.desconto; }
      const s = v.tipo === "devolucao" || (v.tipo === "troca" && v.diferenca < 0) ? -1 : 1;
      v.pagamentos.forEach((pg) => (formas[pg.forma] = (formas[pg.forma] || 0) + s * pg.valor));
      const vd = (vends[v.vendedor.nome] ||= { nome: v.vendedor.nome, vendas: 0, valor: 0 });
      if (v.tipo === "venda") vd.vendas++;
      vd.valor += s * v.total;
    }
    const lista = Object.values(prods).map((p) => ({ ...p, lucro: p.valor - p.custo, medio: p.qtd ? p.custo / p.qtd : 0 })).sort((a, b) => b.valor - a.valor);
    return { vendas, lista, formas, vends: Object.values(vends).sort((a, b) => b.valor - a.valor), qtd, custo, fat, lucro: fat - custo, perdas, cupons };
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
      vendas: () => `<table class="rep__table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th class="r">Total</th></tr></thead><tbody>${[...R.vendas].sort((a, b) => b.criadaEm.localeCompare(a.criadaEm)).map((v) => `<tr><td><b>${esc(v.code)}</b></td><td class="num">${dia(v.criadaEm)} ${hora(v.criadaEm)}</td><td>${esc(v.cliente?.nome || "Ao consumidor")}</td><td>${esc(v.vendedor.nome)}</td><td>${v.pagamentos.map((p) => FORMAS[p.forma]).join(" + ")}</td><td class="r num ${v.tipo === "devolucao" || v.diferenca < 0 ? "neg" : ""}">${v.tipo === "devolucao" || v.diferenca < 0 ? "-" : ""}${money(v.total)}</td></tr>`).join("")}</tbody></table>`,
    };
    return `
      <section class="report">
        <header class="report__print-head print-only"><strong>TOP SMART</strong><span>Relatório de vendas · ${esc(R.titulo)}</span></header>
        <div class="stats stats--rep">
          ${stat("Quantidade", R.qtd, "itens vendidos")}
          ${stat("Custo total", money(R.custo), "custo das peças")}
          ${stat("Valor total", money(R.fat), (() => { const n = R.vendas.filter((v) => v.tipo === "venda").length, t = R.vendas.filter((v) => v.tipo === "troca").length; return `${n} ${n === 1 ? "venda" : "vendas"}${t ? ` · ${t} ${t === 1 ? "troca" : "trocas"}` : ""}`; })())}
          ${stat("Lucro", money(R.lucro), `margem de ${margem.toFixed(1).replace(".", ",")}%`, "stat--main")}
        </div>
        ${R.vendas.length ? `
        <div class="rep__tabs no-print" role="tablist">${Object.entries(tabs).map(([k, v]) => `<button role="tab" aria-selected="${vis === k}" class="${vis === k ? "is-on" : ""}" data-rep-vis="${k}">${v}</button>`).join("")}</div>
        <div class="table-wrap">${tabela[vis]?.() || tabela.produtos()}</div>
        ${R.cupons ? `<p class="rep__note muted">Descontos de cupom no período: ${money(R.cupons)}, já descontados do valor total e do lucro.</p>` : ""}
        ${R.perdas ? `<p class="rep__note rep__note--perda">Produtos devolvidos com defeito: ${money(R.perdas)} de custo perdido, já descontado do lucro.</p>` : ""}
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
    draft ||= JSON.parse(JSON.stringify({ lojas: setup.lojas, vendedores: setup.vendedores, taxas: setup.taxas || { credito: 0, debito: 0 } }));
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
      <section class="box equipe__taxas">
        <div class="box__head"><h2>Taxas da maquininha</h2><span class="muted">entram no dashboard como desconto da receita</span></div>
        <div class="equipe__taxasgrid">
          <label class="field"><span>Cartão de crédito (%)</span><input data-eq-taxa="credito" inputmode="decimal" value="${String(draft.taxas.credito || "").replace(".", ",")}" placeholder="0,00"></label>
          <label class="field"><span>Cartão de débito (%)</span><input data-eq-taxa="debito" inputmode="decimal" value="${String(draft.taxas.debito || "").replace(".", ",")}" placeholder="0,00"></label>
        </div>
      </section>
      <div class="equipe__foot">
        <button type="button" class="btn btn--ghost" data-eq-addloja>${icon("i-store")}Nova loja</button>
        <button class="btn btn--primary">${icon("i-check")}Salvar</button>
      </div>
    </form>`);
  }

  // ======================================================================
  // CLIENTES (cadastro do balcão + crédito na loja)
  // ======================================================================
  let cliEdit = null;   // null | {} (novo) | cliente (editando)
  let cliFiltro = "";
  function viewClientes() {
    cliEdit = null;
    return `<div class="admin-head"><div><h1>Clientes</h1><p class="muted">Cadastro do balcão. Todo cliente começa com R$ 0,00 de crédito na loja.</p></div>
        <button class="btn btn--primary btn--sm" data-cad-cli-new>${icon("i-plus")}Cadastrar cliente</button></div>
      ${asyncView("cli-root", skel(5), async () => { await loadSetup(true); renderClientes(); })}`;
  }
  function cliFormBox() {
    if (!cliEdit) return "";
    const c = cliEdit;
    return `<form class="box cad-form" id="cad-cli-form" novalidate>
      <div class="box__head"><h2>${c.id ? "Editar cliente" : "Cliente novo"}</h2><button type="button" class="text-btn" data-cad-cli-cancel>Cancelar</button></div>
      <div class="seg seg--sm" role="radiogroup" aria-label="Tipo">
        <label><input type="radio" name="tipo" value="cliente" ${c.tipo !== "lojista" ? "checked" : ""}><span>Cliente</span></label>
        <label><input type="radio" name="tipo" value="lojista" ${c.tipo === "lojista" ? "checked" : ""}><span>Lojista</span></label>
      </div>
      <div class="cad-form__grid">
        <label class="field"><span>Nome ou razão social</span><input name="nome" value="${esc(c.nome || "")}" maxlength="120" required><span class="err"></span></label>
        <label class="field"><span>CPF ou CNPJ <span class="opt">(opcional)</span></span><input name="doc" value="${esc(c.doc || "")}" inputmode="numeric" data-mask-doc maxlength="18"><span class="err"></span></label>
        <label class="field"><span>WhatsApp</span><input name="phone" value="${esc(c.telefone || "")}" inputmode="tel" maxlength="16" placeholder="(33) 99999-9999"><span class="err"></span></label>
      </div>
      <button class="btn btn--primary">${icon("i-check")}${c.id ? "Salvar" : "Cadastrar"}</button>
    </form>`;
  }
  function renderClientes() {
    const lista = (setup.clientes || []).filter((c) => !cliFiltro || norm(`${c.nome} ${c.doc} ${c.telefone}`).includes(norm(cliFiltro)) || (T().digits(cliFiltro).length >= 3 && T().digits(`${c.doc}${c.telefone}`).includes(T().digits(cliFiltro))));
    const totalCredito = (setup.clientes || []).reduce((s, c) => s + (c.credito || 0), 0);
    const totalFiado = (setup.clientes || []).reduce((s, c) => s + (c.fiado || 0), 0);
    paint("cli-root", `
      ${cliFormBox()}
      <section class="box">
        <div class="box__head"><h2>Clientes do balcão <span class="muted">(${(setup.clientes || []).length})</span></h2>
          <span class="cli-totais">${totalFiado ? `<span class="cred-total cred-total--debt">${icon("i-clock")}Fiado a receber: <b class="num">${money(totalFiado)}</b></span>` : ""}
          ${totalCredito ? `<span class="cred-total">${icon("i-wallet")}Crédito em aberto: <b class="num">${money(totalCredito)}</b></span>` : ""}</span></div>
        <input type="search" class="admin-search" id="cli-busca" value="${esc(cliFiltro)}" placeholder="Buscar por nome, CPF, CNPJ ou telefone" aria-label="Buscar cliente">
        ${lista.length ? `<div class="olist">${lista.map((c) => `
          <details class="hist cli-row">
            <summary>
              <span class="cli-row__nome"><b>${esc(c.nome)}</b>${c.tipo === "lojista" ? ' <span class="tag tag--pro">Lojista</span>' : ""}<small class="muted">${esc([c.doc, c.telefone].filter(Boolean).join(" · ")) || "sem documento"}</small></span>
              <span class="cli-row__cred ${c.fiado > 0 ? "debt" : c.credito > 0 ? "has" : ""}"><small>${c.fiado > 0 ? "Deve (fiado)" : "Crédito"}</small><b class="num">${money(c.fiado > 0 ? c.fiado : c.credito || 0)}</b></span>
              ${icon("i-down")}
            </summary>
            <div class="hist__body">
              ${c.fiado > 0 ? `
              <form class="ajuste receber" data-cad-receber="${esc(c.id)}" novalidate>
                <span class="receber__t">Deve <b class="num">${money(c.fiado)}</b>${c.fiadoDesde ? ` desde ${dia(c.fiadoDesde)}` : ""}</span>
                <span class="money-input"><span>R$</span><input name="valor" inputmode="decimal" value="${fmtMoneyInput(c.fiado)}" aria-label="Valor recebido"></span>
                <select name="forma" aria-label="Forma de pagamento">${["pix", "dinheiro", "debito", "credito"].map((f) => `<option value="${f}">${FORMAS[f]}</option>`).join("")}</select>
                <button class="btn btn--primary btn--sm">${icon("i-check")}Receber no caixa</button>
                ${T().digits(c.telefone).length >= 10 ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/55${T().digits(c.telefone).replace(/^55/, "")}?text=${encodeURIComponent(`Olá${c.nome ? `, ${c.nome.split(" ")[0]}` : ""}! Aqui é da Top Smart. Passando para lembrar do valor de ${money(c.fiado)} em aberto na loja. Pode pagar no Pix ou aqui no balcão. Obrigado!`)}">${icon("i-wa")}Cobrar</a>` : ""}
              </form>` : ""}
              <div class="hist__actions">
                <button class="btn btn--ghost btn--sm" data-cad-cli-edit="${esc(c.id)}">${icon("i-edit")}Editar</button>
                ${T().digits(c.telefone).length >= 10 ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="https://wa.me/55${T().digits(c.telefone).replace(/^55/, "")}?text=${encodeURIComponent(`Olá${c.nome ? `, ${c.nome.split(" ")[0]}` : ""}! Aqui é da Top Smart. Você tem ${money(c.credito || 0)} de crédito na loja.`)}">${icon("i-wa")}Avisar saldo</a>` : ""}
              </div>
              <form class="ajuste" data-cad-ajuste="${esc(c.id)}" novalidate>
                <span class="money-input"><span>R$</span><input name="valor" inputmode="decimal" placeholder="0,00" aria-label="Valor do ajuste"></span>
                <input name="motivo" maxlength="120" placeholder="Motivo (ex.: crédito de garantia)" aria-label="Motivo">
                <button class="btn btn--ghost btn--sm" name="op" value="mais">+ Dar crédito</button>
                <button class="btn btn--ghost btn--sm" name="op" value="menos">- Tirar crédito</button>
              </form>
              <h3 class="ext__t">Extrato do crédito</h3>
              ${(c.extrato || []).length ? `<ul class="mlist">${c.extrato.map((m) => `<li><span class="num">${dia(m.em)}</span><span>${esc(m.motivo)}${m.ref ? ` · ${esc(m.ref)}` : ""}</span><b class="num ${m.valor < 0 ? "neg" : "pos"}">${m.valor > 0 ? "+" : "-"}${money(Math.abs(m.valor))}</b></li>`).join("")}</ul>` : '<p class="muted">Nenhum movimento ainda.</p>'}
              ${(c.fiadoExtrato || []).length ? `<h3 class="ext__t">Extrato do fiado</h3><ul class="mlist">${c.fiadoExtrato.map((m) => `<li><span class="num">${dia(m.em)}</span><span>${esc(m.motivo)}${m.ref ? ` · ${esc(m.ref)}` : ""}</span><b class="num ${m.valor > 0 ? "neg" : "pos"}">${m.valor > 0 ? "+" : "-"}${money(Math.abs(m.valor))}</b></li>`).join("")}</ul>` : ""}
            </div>
          </details>`).join("")}</div>` : `<div class="empty">${cliFiltro ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado no balcão ainda. Cadastre aqui ou na hora da venda."}</div>`}
      </section>
      ${T().adminUsersHTML()}`);
  }

  // ======================================================================
  // FORNECEDORES
  // ======================================================================
  let forn = null;        // { fornecedores, compras }
  let fornEdit = null;
  async function loadForn(force) { if (!forn || force) forn = await api("r=fornecedores"); return forn; }
  function viewFornecedores() {
    fornEdit = null;
    return `<div class="admin-head"><div><h1>Fornecedores</h1><p class="muted">De quem a loja compra. Cada entrada de estoque fica no histórico do fornecedor.</p></div>
        <div class="rep__tools"><a class="btn btn--ghost btn--sm" href="#/admin?aba=entrada">${icon("i-download")}Registrar entrada</a><button class="btn btn--primary btn--sm" data-forn-new>${icon("i-plus")}Novo fornecedor</button></div></div>
      ${asyncView("forn-root", skel(4), async () => { await loadForn(true); renderFornecedores(); })}`;
  }
  function fornFormBox() {
    if (!fornEdit) return "";
    const x = fornEdit;
    return `<form class="box cad-form" id="forn-form" novalidate>
      <div class="box__head"><h2>${x.id ? "Editar fornecedor" : "Novo fornecedor"}</h2><button type="button" class="text-btn" data-forn-cancel>Cancelar</button></div>
      <div class="cad-form__grid">
        <label class="field"><span>Nome</span><input name="nome" value="${esc(x.nome || "")}" maxlength="120" required placeholder="Ex.: Diamonds Parts"><span class="err"></span></label>
        <label class="field"><span>CNPJ ou CPF <span class="opt">(opcional)</span></span><input name="doc" value="${esc(x.doc || "")}" inputmode="numeric" data-mask-doc maxlength="18"></label>
        <label class="field"><span>WhatsApp ou telefone</span><input name="phone" value="${esc(x.telefone || "")}" inputmode="tel" maxlength="16"></label>
        <label class="field"><span>Contato <span class="opt">(opcional)</span></span><input name="contato" value="${esc(x.contato || "")}" maxlength="80" placeholder="Nome de quem atende"></label>
        <label class="field"><span>Cidade <span class="opt">(opcional)</span></span><input name="cidade" value="${esc(x.cidade || "")}" maxlength="80"></label>
        <label class="field"><span>Observação <span class="opt">(opcional)</span></span><input name="obs" value="${esc(x.obs || "")}" maxlength="300" placeholder="Prazo, condições, chave Pix..."></label>
      </div>
      <button class="btn btn--primary">${icon("i-check")}${x.id ? "Salvar" : "Cadastrar fornecedor"}</button>
    </form>`;
  }
  function renderFornecedores() {
    const { fornecedores, compras } = forn;
    paint("forn-root", `
      ${fornFormBox()}
      ${fornecedores.length ? `<div class="olist">${fornecedores.map((x) => {
        const cs = compras.filter((c) => c.fornecedor.id === x.id);
        const total = cs.reduce((s, c) => s + c.total, 0);
        return `<details class="hist forn-row">
          <summary>
            <span class="cli-row__nome"><b>${esc(x.nome)}</b><small class="muted">${esc([x.doc, x.telefone, x.cidade].filter(Boolean).join(" · ")) || "sem dados de contato"}</small></span>
            <span class="cli-row__cred"><small>${cs.length} ${cs.length === 1 ? "compra" : "compras"}</small><b class="num">${money(total)}</b></span>
            ${icon("i-down")}
          </summary>
          <div class="hist__body">
            ${x.contato || x.obs ? `<p class="muted forn-obs">${esc([x.contato && `Contato: ${x.contato}`, x.obs].filter(Boolean).join(" · "))}</p>` : ""}
            <div class="hist__actions">
              <a class="btn btn--primary btn--sm" href="#/admin?aba=entrada&forn=${encodeURIComponent(x.id)}">${icon("i-download")}Nova entrada deste fornecedor</a>
              ${T().digits(x.telefone).length >= 10 ? `<a class="btn btn--wa btn--sm" target="_blank" rel="noopener" href="https://wa.me/55${T().digits(x.telefone).replace(/^55/, "")}">${icon("i-wa")}WhatsApp</a>` : ""}
              <button class="btn btn--ghost btn--sm" data-forn-edit="${esc(x.id)}">${icon("i-edit")}Editar</button>
              <button class="btn btn--ghost btn--sm" data-forn-del="${esc(x.id)}">${icon("i-trash")}Remover</button>
            </div>
            <h3 class="ext__t">Compras</h3>
            ${cs.length ? `<ul class="mlist">${cs.map((c) => `<li><span class="num">${new Date(`${c.data}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span><span>${c.itens.map((it) => `${it.qty}x ${esc(it.name)}`).join(", ")}${c.nota ? ` · nota ${esc(c.nota)}` : ""}</span><b class="num">${money(c.total)}</b></li>`).join("")}</ul>` : '<p class="muted">Nenhuma compra registrada.</p>'}
          </div>
        </details>`;
      }).join("")}</div>` : (fornEdit ? "" : `<div class="empty">Nenhum fornecedor ainda.<br><button class="btn btn--primary btn--sm" data-forn-new style="margin-top:12px">${icon("i-plus")}Cadastrar o primeiro</button></div>`)}`);
  }

  // ======================================================================
  // ENTRADA DE ESTOQUE (compra de fornecedor)
  // ======================================================================
  let ent = store.get("ts_entrada", null) || { fornecedorId: "", nota: "", data: "", itens: [], atualizaCusto: true };
  const saveEnt = () => store.set("ts_entrada", ent);
  let entResults = [], entIdx = 0;
  function viewEntrada() {
    const params = new URLSearchParams(location.hash.split("?")[1] || "");
    if (params.get("forn")) ent.fornecedorId = params.get("forn");
    return `<div class="admin-head"><div><h1>Entrada de estoque</h1><p class="muted">Lance o que chegou do fornecedor. O estoque e o custo dos produtos são atualizados.</p></div></div>
      ${asyncView("ent-root", skel(4), async () => { await loadForn(true); renderEntrada(); })}`;
  }
  function renderEntrada() {
    const { fornecedores, compras } = forn;
    const total = ent.itens.reduce((s, it) => s + it.qty * it.custo, 0);
    paint("ent-root", `
      <form class="box entrada" id="ent-form" novalidate>
        <div class="entrada__top">
          <div class="field"><label class="field__label" for="ent-forn">Fornecedor</label>
            ${fornecedores.length ? `<select id="ent-forn" name="forn" data-ent="fornecedorId"><option value="">Escolha o fornecedor</option>${fornecedores.map((x) => `<option value="${esc(x.id)}" ${x.id === ent.fornecedorId ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>` : ""}
            <a class="text-btn ent-newforn" href="#/admin?aba=fornecedores">${icon("i-plus")}${fornecedores.length ? "Cadastrar outro fornecedor" : "Cadastre um fornecedor primeiro"}</a></div>
          <label class="field"><span>Nota ou pedido nº <span class="opt">(opcional)</span></span><input data-ent="nota" value="${esc(ent.nota)}" maxlength="40"></label>
          <label class="field"><span>Data da compra</span><input type="date" data-ent="data" value="${esc(ent.data || iso(new Date()))}"></label>
        </div>
        <div class="pdv__search">
          ${icon("i-search")}
          <input id="ent-q" type="search" autocomplete="off" placeholder="Produto que chegou: nome ou código" aria-label="Buscar produto" aria-controls="ent-res">
          <ul class="pdv__results" id="ent-res" role="listbox" hidden></ul>
        </div>
        ${ent.itens.length ? `<div class="table-wrap"><table class="pdv__table">
          <thead><tr><th>Produto</th><th class="r">Estoque hoje</th><th class="r">Qtd que chegou</th><th class="r">Custo unitário</th><th class="r">Subtotal</th><th></th></tr></thead>
          <tbody>${ent.itens.map((it, i) => { const p = T().prodBy(it.productId); return `<tr>
            <td><b>${esc(it.name)}${it.code ? ` - ${esc(it.code)}` : ""}</b></td>
            <td class="r num">${p ? p.stock : "-"}</td>
            <td class="r"><input class="cell-in cell-in--qty num" type="number" min="1" value="${it.qty}" data-ent-item="${i}" data-field="qty" aria-label="Quantidade"></td>
            <td class="r"><input class="cell-in num" inputmode="decimal" value="${fmtMoneyInput(it.custo)}" data-ent-item="${i}" data-field="custo" aria-label="Custo unitário"></td>
            <td class="r num"><b>${money(it.qty * it.custo)}</b></td>
            <td class="r"><button type="button" class="icon-btn icon-btn--sm" data-ent-del="${i}" aria-label="Remover">${icon("i-trash")}</button></td>
          </tr>`; }).join("")}</tbody>
          <tfoot><tr><td colspan="4">Total da compra</td><td class="r num"><b>${money(total)}</b></td><td></td></tr></tfoot>
        </table></div>` : vazio("i-download", "Busque os produtos que chegaram e informe a quantidade e o custo de cada um.")}
        <label class="check"><input type="checkbox" data-ent="atualizaCusto" ${ent.atualizaCusto ? "checked" : ""}> Atualizar o preço de custo dos produtos com o valor desta compra</label>
        <span class="err" id="ent-err"></span>
        <div class="entrada__foot"><button type="button" class="text-btn" data-ent-clear ${ent.itens.length ? "" : "hidden"}>Limpar</button><button class="btn btn--primary" ${ent.itens.length ? "" : "disabled"}>${icon("i-check")}Registrar entrada</button></div>
      </form>
      <section class="box">
        <div class="box__head"><h2>Últimas entradas</h2></div>
        ${compras.length ? `<div class="olist">${compras.slice(0, 40).map((c) => `
          <details class="hist">
            <summary><span class="num">${new Date(`${c.data}T12:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span><span class="hist__when"><b>${esc(c.fornecedor.nome)}</b> · ${c.itens.reduce((n, it) => n + it.qty, 0)} itens${c.nota ? ` · nota ${esc(c.nota)}` : ""}</span><span class="num"><b>${money(c.total)}</b></span><span></span>${icon("i-down")}</summary>
            <div class="hist__body"><ul class="mlist">${c.itens.map((it) => `<li><span class="num">${it.qty}x</span><span>${esc(it.name)}${it.code ? ` - ${esc(it.code)}` : ""} · ${money(it.custo)} cada</span><b class="num">${money(it.sub)}</b></li>`).join("")}</ul></div>
          </details>`).join("")}</div>` : '<p class="muted">As compras registradas aparecem aqui e no histórico de cada fornecedor.</p>'}
      </section>`);
  }
  function entBuscar(q) {
    entResults = buscar(q); entIdx = 0;
    const ul = $("#ent-res"); if (!ul) return;
    ul.hidden = !q.trim();
    ul.innerHTML = entResults.length ? entResults.map((p, i) => `<li role="option" class="${i === entIdx ? "is-sel" : ""}" data-ent-add="${esc(p.id)}"><span class="row__thumb">${T().media(p)}</span><span class="res__name"><b>${esc(p.name)}</b><small class="muted">${esc(p.code)} · estoque ${p.stock}</small></span><span class="num res__price">${money(p.cost || 0)}</span></li>`).join("")
      : curta(q) ? dicaBusca(q) : `<li class="res__none">Nada encontrado. Cadastre o produto em Produtos primeiro.</li>`;
  }
  function entAdd(id) {
    const p = T().prodBy(id); if (!p) return;
    const ja = ent.itens.find((it) => it.productId === p.id);
    if (ja) ja.qty++; else ent.itens.push({ productId: p.id, name: p.name, code: p.code, qty: 1, custo: p.cost || 0 });
    saveEnt(); renderEntrada();
    const n = $$("[data-ent-item][data-field=qty]").at(ent.itens.findIndex((it) => it.productId === p.id));
    n?.select();
  }

  // ======================================================================
  // CUPONS DE DESCONTO (com trava de margem de lucro por produto)
  // ======================================================================
  let cup = null;        // { cupons, usos }
  let cupEdit = null;    // cupom em edição (com sel: Set de produtos na promoção)
  let cupFiltro = { q: "", cat: "", so: "" };
  const apiCupons = (method = "GET", body) => T().fetchJSON("/api/coupons", method, body, true);
  const fmtData = (d) => (d ? d.split("-").reverse().join("/") : "");

  function viewCupons() {
    cupEdit = null;
    return `<div class="admin-head"><div><h1>Cupons de desconto</h1><p class="muted">O cupom só vale nos produtos da promoção e nunca passa do lucro de cada um.</p></div>
        <button class="btn btn--primary btn--sm" data-cup-new>${icon("i-plus")}Novo cupom</button></div>
      ${asyncView("cup-root", skel(4), async () => { cup = await apiCupons(); renderCupons(); })}`;
  }

  // lucro de um produto com o cupom, para cliente (CPF) e lojista (CNPJ)
  function margem(p, e) {
    const custo = p.cost || 0;
    const precoCli = p.promo ?? p.price, precoLoj = p.priceLoj ?? p.price;
    const desc = (preco) => (e.tipo === "pct" ? (preco * (parseMoney(e.valor) || 0)) / 100 : Math.min(parseMoney(e.valor) || 0, preco));
    const lado = (preco) => ({ preco, com: Math.max(0, preco - desc(preco)), lucro: preco - custo, sobra: preco - desc(preco) - custo });
    const cli = lado(precoCli), loj = lado(precoLoj);
    const lados = e.publico === "cliente" ? [cli] : e.publico === "lojista" ? [loj] : [cli, loj];
    const semLucroBase = lados.some((l) => l.lucro <= 0);
    // %: o desconto inteiro precisa caber no lucro. R$: o servidor limita ao lucro, então só bloqueia quem já não tem lucro
    const semMargem = semLucroBase || (e.tipo === "pct" && lados.some((l) => l.sobra <= 0));
    const limitado = e.tipo === "valor" && !semMargem && lados.some((l) => l.sobra <= 0);
    return { custo, cli, loj, lados, semMargem, limitado, semCusto: !custo };
  }

  function renderCupons() {
    if (!cup) return;
    const hoje = iso(new Date());
    const status = (c) => !c.ativo ? ["Pausado", "off"] : c.fim && c.fim < hoje ? ["Vencido", "off"] : c.inicio && c.inicio > hoje ? ["Agendado", "warn"] : c.limite && (cup.usos[c.code] || 0) >= c.limite ? ["Esgotado", "off"] : ["Ativo", "on"];
    paint("cup-root", `
      ${cupEdit ? cupFormHTML() : ""}
      ${cup.cupons.length ? `<div class="olist">${cup.cupons.map((c) => {
        const [st, cls] = status(c);
        const nProd = Object.keys(c.produtos || {}).length;
        return `<div class="cup-row">
          <span class="cup-code">${esc(c.code)}</span>
          <span class="cup-info"><b>${c.tipo === "pct" ? `${String(c.valor).replace(".", ",")}% off` : `${money(c.valor)} off`}</b>${c.descricao ? ` · ${esc(c.descricao)}` : ""}
            <small class="muted">${[nProd ? `${nProd} ${nProd === 1 ? "produto" : "produtos"}` : "nenhum produto", c.minimo ? `mín. ${money(c.minimo)}` : "", c.canal === "ambos" ? "site e loja" : c.canal === "site" ? "só site" : "só loja", c.publico === "todos" ? "" : c.publico === "lojista" ? "só lojistas" : "só clientes", c.fim ? `até ${fmtData(c.fim)}` : ""].filter(Boolean).join(" · ")}</small></span>
          <span class="cup-uso num">${cup.usos[c.code] || 0}${c.limite ? `/${c.limite}` : ""} <small>usos</small></span>
          <span class="cup-st cup-st--${cls}">${st}</span>
          <span class="tbl-actions">
            <button class="icon-btn icon-btn--sm" data-cup-share="${esc(c.code)}" aria-label="Divulgar ${esc(c.code)} no WhatsApp">${icon("i-wa")}</button>
            <button class="icon-btn icon-btn--sm" data-cup-toggle="${esc(c.code)}" aria-label="${c.ativo ? "Pausar" : "Ativar"} ${esc(c.code)}">${icon(c.ativo ? "i-pause" : "i-check")}</button>
            <button class="icon-btn icon-btn--sm" data-cup-edit="${esc(c.code)}" aria-label="Editar ${esc(c.code)}">${icon("i-edit")}</button>
            <button class="icon-btn icon-btn--sm danger" data-cup-del="${esc(c.code)}" aria-label="Excluir ${esc(c.code)}">${icon("i-trash")}</button>
          </span>
        </div>`;
      }).join("")}</div>` : (cupEdit ? "" : `<div class="empty">Nenhum cupom ainda.<br><button class="btn btn--primary btn--sm" data-cup-new style="margin-top:12px">${icon("i-plus")}Criar o primeiro cupom</button></div>`)}`);
  }

  function novoCupom() {
    const e = { code: "", descricao: "", tipo: "pct", valor: "10", minimo: "", maxDesconto: "", inicio: "", fim: "", limite: "", porCliente: false, canal: "ambos", publico: "todos", ativo: true, sel: new Set() };
    T().products.forEach((p) => { if (!margem(p, e).semMargem) e.sel.add(p.id); });
    return e;
  }

  function cupFormHTML() {
    const e = cupEdit;
    return `<form class="box cad-form cup-form" id="cup-form" novalidate>
      <div class="box__head"><h2>${e.original ? `Editar cupom ${esc(e.original)}` : "Novo cupom"}</h2><button type="button" class="text-btn" data-cup-cancel>Cancelar</button></div>
      <div class="cad-form__grid">
        <label class="field"><span>Código</span><input name="code" value="${esc(e.code)}" maxlength="24" placeholder="Ex.: TOPSMART10" autocomplete="off" data-cup="code" required><span class="err"></span></label>
        <label class="field"><span>Descrição <span class="opt">(aparece pro cliente)</span></span><input name="descricao" value="${esc(e.descricao)}" maxlength="80" placeholder="Ex.: 10% em películas" data-cup="descricao"></label>
        <div class="field"><span class="field__label">Tipo de desconto</span><div class="seg seg--sm" role="radiogroup" aria-label="Tipo de desconto">
          <label><input type="radio" name="tipo" value="pct" ${e.tipo === "pct" ? "checked" : ""} data-cup="tipo"><span>Porcentagem (%)</span></label>
          <label><input type="radio" name="tipo" value="valor" ${e.tipo === "valor" ? "checked" : ""} data-cup="tipo"><span>Valor (R$)</span></label></div></div>
        <label class="field"><span>${e.tipo === "pct" ? "Desconto (%)" : "Desconto (R$)"}</span><input name="valor" inputmode="decimal" value="${esc(e.valor)}" data-cup="valor" required><span class="err"></span></label>
        <label class="field"><span>Pedido mínimo <span class="opt">(R$, opcional)</span></span><input name="minimo" inputmode="decimal" value="${esc(e.minimo)}" data-cup="minimo"></label>
        ${e.tipo === "pct" ? `<label class="field"><span>Desconto máximo <span class="opt">(R$, opcional)</span></span><input name="maxDesconto" inputmode="decimal" value="${esc(e.maxDesconto)}" data-cup="maxDesconto"></label>` : ""}
        <label class="field"><span>Válido de <span class="opt">(opcional)</span></span><input type="date" name="inicio" value="${esc(e.inicio)}" data-cup="inicio"></label>
        <label class="field"><span>Válido até <span class="opt">(opcional)</span></span><input type="date" name="fim" value="${esc(e.fim)}" data-cup="fim"></label>
        <label class="field"><span>Limite de usos <span class="opt">(opcional)</span></span><input name="limite" type="number" min="0" step="1" value="${esc(e.limite)}" data-cup="limite"></label>
        <label class="field"><span>Onde vale</span><select name="canal" data-cup="canal"><option value="ambos" ${e.canal === "ambos" ? "selected" : ""}>Site e loja física</option><option value="site" ${e.canal === "site" ? "selected" : ""}>Só pedidos pelo site</option><option value="balcao" ${e.canal === "balcao" ? "selected" : ""}>Só na loja (balcão)</option></select></label>
        <label class="field"><span>Para quem</span><select name="publico" data-cup="publico"><option value="todos" ${e.publico === "todos" ? "selected" : ""}>Todos</option><option value="cliente" ${e.publico === "cliente" ? "selected" : ""}>Só clientes (CPF)</option><option value="lojista" ${e.publico === "lojista" ? "selected" : ""}>Só lojistas (CNPJ)</option></select></label>
      </div>
      <div class="cup-checks">
        <label class="check"><input type="checkbox" data-cup="porCliente" ${e.porCliente ? "checked" : ""}> Cada cliente usa uma vez só</label>
        <label class="check"><input type="checkbox" data-cup="ativo" ${e.ativo ? "checked" : ""}> Cupom ativo</label>
      </div>
      <section class="cup-prods" id="cup-prods">${cupProdutosHTML()}</section>
      <span class="err" id="cup-err"></span>
      <button class="btn btn--primary" id="cup-save">${icon("i-check")}${e.original ? "Salvar cupom" : "Criar cupom"}</button>
    </form>`;
  }

  function cupProdutosHTML() {
    const e = cupEdit;
    const prods = T().products;
    const m = Object.fromEntries(prods.map((p) => [p.id, margem(p, e)]));
    const semMargemDentro = prods.filter((p) => e.sel.has(p.id) && m[p.id].semMargem);
    const semCusto = prods.filter((p) => e.sel.has(p.id) && m[p.id].semCusto);
    const norm2 = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const cats = [...new Set(prods.map((p) => p.cat))];
    const visiveis = prods.filter((p) => (!cupFiltro.cat || p.cat === cupFiltro.cat) && (!cupFiltro.q || norm2(`${p.name} ${p.code}`).includes(norm2(cupFiltro.q)))
      && (!cupFiltro.so || (cupFiltro.so === "dentro" ? e.sel.has(p.id) : cupFiltro.so === "risco" ? m[p.id].semMargem : !e.sel.has(p.id))));
    const precoTxt = (l) => `${money(l.preco)} → <b>${money(l.com)}</b>`;
    const ladoTxt = (mm) => (e.publico === "lojista" ? [["Lojista", mm.loj]] : e.publico === "cliente" ? [["Cliente", mm.cli]] : [["Cliente", mm.cli], ["Lojista", mm.loj]]);
    return `
      <div class="cup-prods__head">
        <h3>Produtos na promoção <span class="muted">(${e.sel.size} de ${prods.length})</span></h3>
        <div class="cup-prods__tools">
          <button type="button" class="btn btn--ghost btn--sm" data-cup-sel="margem">Incluir todos com lucro</button>
          <button type="button" class="btn btn--ghost btn--sm" data-cup-sel="nenhum">Tirar todos</button>
        </div>
      </div>
      ${semMargemDentro.length ? `<div class="alert alert--bad">${icon("i-lock")}<div><strong>${semMargemDentro.length} ${semMargemDentro.length === 1 ? "produto fica" : "produtos ficam"} sem lucro com esse desconto.</strong> ${semMargemDentro.slice(0, 4).map((p) => esc(p.name)).join(", ")}${semMargemDentro.length > 4 ? "…" : ""}</div><button type="button" class="btn btn--dark btn--sm" data-cup-sel="tirar-risco">Tirar ${semMargemDentro.length === 1 ? "esse" : `esses ${semMargemDentro.length}`} da promoção</button></div>` : ""}
      ${semCusto.length ? `<div class="alert alert--warn">${icon("i-clock")}<div>${semCusto.length} ${semCusto.length === 1 ? "produto está" : "produtos estão"} sem preço de custo: o lucro deles não dá pra conferir. Preencha o custo em Produtos.</div></div>` : ""}
      <div class="cup-prods__filters">
        <input type="search" class="admin-search" placeholder="Buscar produto ou código" value="${esc(cupFiltro.q)}" data-cup-f="q" aria-label="Buscar produto">
        <select data-cup-f="cat" aria-label="Categoria"><option value="">Todas as categorias</option>${cats.map((c) => `<option value="${esc(c)}" ${cupFiltro.cat === c ? "selected" : ""}>${esc(T().catBy(c).name)}</option>`).join("")}</select>
        <select data-cup-f="so" aria-label="Mostrar"><option value="">Mostrar todos</option><option value="dentro" ${cupFiltro.so === "dentro" ? "selected" : ""}>Só os da promoção</option><option value="fora" ${cupFiltro.so === "fora" ? "selected" : ""}>Só os fora</option><option value="risco" ${cupFiltro.so === "risco" ? "selected" : ""}>Só os sem lucro</option></select>
      </div>
      <div class="table-wrap"><table class="cup-table">
        <thead><tr><th><span class="sr-only">Na promoção</span></th><th>Produto</th><th class="r">Custo</th><th>Preço → com cupom</th><th class="r">Lucro que sobra</th><th></th></tr></thead>
        <tbody>${visiveis.map((p) => {
          const mm = m[p.id], dentro = e.sel.has(p.id);
          const st = mm.semMargem ? '<span class="cup-st cup-st--bad">Sem lucro</span>' : mm.semCusto ? '<span class="cup-st cup-st--warn">Sem custo</span>' : mm.limitado ? '<span class="cup-st cup-st--warn">Limitado ao lucro</span>' : '<span class="cup-st cup-st--on">OK</span>';
          return `<tr class="${dentro ? "" : "is-out"} ${mm.semMargem && dentro ? "is-bad" : ""}">
            <td><input type="checkbox" data-cup-prod="${esc(p.id)}" ${dentro ? "checked" : ""} aria-label="Incluir ${esc(p.name)} na promoção"></td>
            <td><b>${esc(p.name)}</b> <small class="muted">${esc(p.code)}</small></td>
            <td class="r num">${mm.custo ? money(mm.custo) : "-"}</td>
            <td class="num">${ladoTxt(mm).map(([n, l]) => `<div><small class="muted">${n}</small> ${precoTxt(l)}</div>`).join("")}</td>
            <td class="r num">${ladoTxt(mm).map(([, l]) => `<div class="${l.sobra <= 0 ? "neg" : "pos"}">${l.sobra <= 0 && e.tipo === "valor" && l.lucro > 0 ? money(0) : money(l.sobra)}</div>`).join("")}</td>
            <td>${st}</td>
          </tr>`;
        }).join("") || '<tr><td colspan="6" class="muted">Nenhum produto com esse filtro.</td></tr>'}</tbody>
      </table></div>`;
  }

  // redesenha a tabela sem perder o foco do campo de busca
  function refreshCupProds() {
    const el = $("#cup-prods"); if (!el) return;
    const a = document.activeElement, f = a?.dataset?.cupF, pos = a?.selectionStart;
    el.innerHTML = cupProdutosHTML();
    if (f) { const n = $(`[data-cup-f=${f}]`); n?.focus(); if (pos != null && n?.setSelectionRange) n.setSelectionRange(pos, pos); }
  }

  async function salvarCupom(f) {
    const e = cupEdit, err = $("#cup-err");
    const code = e.code.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    const valor = parseMoney(e.valor);
    T().setErr(f, "code", code.length < 3 ? "Use pelo menos 3 letras ou números" : cup.cupons.some((c) => c.code === code && c.code !== e.original) ? "Já existe um cupom com esse código" : "");
    T().setErr(f, "valor", !(valor > 0) ? "Informe o desconto" : e.tipo === "pct" && valor >= 100 ? "Use menos de 100%" : "");
    if (code.length < 3 || !(valor > 0) || (e.tipo === "pct" && valor >= 100) || cup.cupons.some((c) => c.code === code && c.code !== e.original)) return;
    const prods = T().products.filter((p) => e.sel.has(p.id));
    const risco = prods.filter((p) => margem(p, e).semMargem);
    if (risco.length) { err.textContent = `Tire da promoção os ${risco.length} produtos sem lucro antes de salvar.`; $(".cup-prods .alert--bad")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    if (!prods.length) { err.textContent = "Coloque pelo menos um produto na promoção."; return; }
    if (e.inicio && e.fim && e.fim < e.inicio) { err.textContent = "A data final está antes da inicial."; return; }
    // desconto máximo por unidade = lucro de cada produto (um centavo de folga): o servidor nunca passa disso
    const produtos = Object.fromEntries(prods.map((p) => { const mm = margem(p, e); return [p.id, { cli: Math.max(0, Math.round((mm.cli.lucro - 0.01) * 100) / 100), loj: Math.max(0, Math.round((mm.loj.lucro - 0.01) * 100) / 100) }]; }));
    const novo = { code, descricao: e.descricao, tipo: e.tipo, valor, minimo: parseMoney(e.minimo), maxDesconto: e.tipo === "pct" ? parseMoney(e.maxDesconto) : 0, inicio: e.inicio, fim: e.fim, limite: parseInt(e.limite, 10) || 0, porCliente: e.porCliente, canal: e.canal, publico: e.publico, ativo: e.ativo, criadoEm: e.criadoEm, produtos };
    const lista = e.original ? cup.cupons.map((c) => (c.code === e.original ? novo : c)) : [novo, ...cup.cupons];
    const btn = $("#cup-save"); btn.disabled = true;
    try { cup = await apiCupons("PUT", { cupons: lista }); cupEdit = null; T().toast(e.original ? "Cupom salvo" : `Cupom ${code} criado`); renderCupons(); }
    catch (er) { btn.disabled = false; err.textContent = er.message; }
  }

  // ======================================================================
  // EVENTOS
  // ======================================================================
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a, li[data-pdv-add], li[data-pdv-cli], li[data-pdv-cli-new], li[data-cli-new], li[data-ent-add]");
    if (!t) return;
    const d = t.dataset;
    if ("pdvRetry" in d) return T().router();
    // ---- cupons ----
    if ("cupNew" in d) { cupEdit = novoCupom(); cupFiltro = { q: "", cat: "", so: "" }; renderCupons(); $("#cup-form [name=code]")?.focus(); return; }
    if ("cupCancel" in d) { cupEdit = null; return renderCupons(); }
    if (d.cupEdit) {
      const c = cup.cupons.find((x) => x.code === d.cupEdit); if (!c) return;
      const txt = (v) => (v ? String(v).replace(".", ",") : "");
      cupEdit = { ...c, original: c.code, valor: txt(c.valor), minimo: txt(c.minimo), maxDesconto: txt(c.maxDesconto), limite: c.limite ? String(c.limite) : "", sel: new Set(Object.keys(c.produtos || {})) };
      cupFiltro = { q: "", cat: "", so: "" }; renderCupons(); window.scrollTo({ top: 0, behavior: "smooth" }); return;
    }
    if (d.cupSel) {
      const prods = T().products;
      if (d.cupSel === "margem") prods.forEach((p) => { if (!margem(p, cupEdit).semMargem) cupEdit.sel.add(p.id); });
      if (d.cupSel === "nenhum") cupEdit.sel.clear();
      if (d.cupSel === "tirar-risco") { const n = prods.filter((p) => cupEdit.sel.has(p.id) && margem(p, cupEdit).semMargem); n.forEach((p) => cupEdit.sel.delete(p.id)); T().toast(`${n.length} ${n.length === 1 ? "produto saiu" : "produtos saíram"} da promoção`); }
      $("#cup-err").textContent = ""; return refreshCupProds();
    }
    if (d.cupToggle || d.cupDel) {
      const c = cup.cupons.find((x) => x.code === (d.cupToggle || d.cupDel)); if (!c) return;
      if (d.cupDel && !confirm(`Excluir o cupom ${c.code}? Quem tiver o código não consegue mais usar.`)) return;
      const lista = d.cupDel ? cup.cupons.filter((x) => x !== c) : cup.cupons.map((x) => (x === c ? { ...x, ativo: !x.ativo } : x));
      try { cup = await apiCupons("PUT", { cupons: lista }); T().toast(d.cupDel ? "Cupom excluído" : c.ativo ? `${c.code} pausado` : `${c.code} ativado`); renderCupons(); } catch (err) { T().toast(err.message); }
      return;
    }
    if (d.cupShare) {
      const c = cup.cupons.find((x) => x.code === d.cupShare); if (!c) return;
      const v = c.tipo === "pct" ? `${String(c.valor).replace(".", ",")}% de desconto` : `${money(c.valor)} de desconto`;
      const txt = `*Cupom Top Smart: ${c.code}*\n\n${c.descricao || v} em produtos selecionados${c.minimo ? ` (pedido mínimo ${money(c.minimo)})` : ""}.${c.fim ? `\nVálido até ${fmtData(c.fim)}.` : ""}\n\nUse no site ou na loja: ${location.origin}`;
      return window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank", "noopener");
    }
    // ---- clientes ----
    if ("cadCliNew" in d) { cliEdit = {}; renderClientes(); $("#cad-cli-form [name=nome]")?.focus(); return; }
    if ("cadCliCancel" in d) { cliEdit = null; return renderClientes(); }
    if (d.cadCliEdit) { cliEdit = setup.clientes.find((x) => x.id === d.cadCliEdit) || null; renderClientes(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    // ---- fornecedores ----
    if ("fornNew" in d) { fornEdit = {}; renderFornecedores(); $("#forn-form [name=nome]")?.focus(); return; }
    if ("fornCancel" in d) { fornEdit = null; return renderFornecedores(); }
    if (d.fornEdit) { fornEdit = forn.fornecedores.find((x) => x.id === d.fornEdit) || null; renderFornecedores(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (d.fornDel) {
      const x = forn.fornecedores.find((y) => y.id === d.fornDel);
      if (!x || !confirm(`Remover ${x.nome}? O histórico de compras continua guardado.`)) return;
      try { const r = await api("r=fornecedores", "PUT", { fornecedores: forn.fornecedores.filter((y) => y.id !== x.id) }); forn.fornecedores = r.fornecedores; T().toast("Fornecedor removido"); renderFornecedores(); } catch (err) { T().toast(err.message); }
      return;
    }
    // ---- entrada de estoque ----
    if (d.entAdd) { const q = $("#ent-q"); if (q) q.value = ""; return entAdd(d.entAdd); }
    if (d.entDel !== undefined) { ent.itens.splice(+d.entDel, 1); saveEnt(); return renderEntrada(); }
    if ("entClear" in d) { if (confirm("Limpar os itens desta entrada?")) { ent.itens = []; saveEnt(); renderEntrada(); } return; }
    // ---- venda balcão ----
    if (d.pdvAdd) return addProduto(d.pdvAdd, t.closest(".pdv__results")?.id.replace("pdv-res-", "") || "itens");
    if (d.pdvDel) { const [alvo, i] = d.pdvDel.split(":"); sale[alvo].splice(+i, 1); saveSale(); return renderPdv(); }
    if (d.pdvTipo) {
      if (sale.tipo !== d.pdvTipo) {
        // ao sair da troca, os produtos devolvidos deixam de valer; na devolução, os itens ganham o campo de estado
        sale.tipo = d.pdvTipo; sale.pagamentos = []; sale.etapa = "itens";
        if (d.pdvTipo !== "troca") sale.devolvidos = [];
        sale.itens.forEach((it) => { if (d.pdvTipo === "devolucao") it.estado ||= "bom"; else delete it.estado; });
        saveSale(); renderPdv();
      }
      return;
    }
    if ("cliNew" in d) { cliForm = { nome: $("#pdv-cli")?.value.trim() || "", tipo: "cliente" }; renderPdv(); setTimeout(() => $("#cli-form [name=" + (cliForm?.nome ? "doc" : "nome") + "]")?.focus(), 30); return; }
    if ("cliCancel" in d) { cliForm = null; return renderPdv(); }
    if ("pdvCliClear" in d) return setCliente(null);
    if ("pdvCupomDel" in d) { sale.cupom = null; saveSale(); return renderPdv(); }
    if (d.pdvCli !== undefined && t.closest("#pdv-cli-results")) return setCliente($("#pdv-cli-results")._found[+d.pdvCli]);
    if ("pdvCliNew" in d) return setCliente({ nome: $("#pdv-cli").value.trim(), doc: "", telefone: "", tipo: "cliente" });
    if ("pdvPagar" in d) return irPagamento();
    if ("pdvVoltar" in d) { sale.etapa = "itens"; saveSale(); return renderPdv(); }
    if (d.pdvForma) {
      let falta = Math.max(0, Math.round((aPagar() - totalPago()) * 100) / 100);
      // usar crédito: no máximo o saldo que o cliente tem
      if (d.pdvForma === "credito_loja" && !devolvendo()) falta = Math.min(falta, Math.max(0, saldoCredito(sale.cliente) - (sale.pagamentos.find((p) => p.forma === "credito_loja")?.valor || 0)));
      const ja = sale.pagamentos.find((p) => p.forma === d.pdvForma);
      if (ja) ja.valor = Math.round((ja.valor + falta) * 100) / 100;
      else sale.pagamentos.push({ forma: d.pdvForma, valor: falta || (sale.pagamentos.length ? 0 : aPagar()) });
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
    if ("pdvFocus" in d) return setTimeout(() => $(".pdv-q")?.focus(), 50);
    // ---- notinha ----
    if ("notaShare" in d) return compartilharNota();
    if ("notaPng" in d) return baixarNota();
    if (d.caixaNota) {
      const { venda } = { venda: (await api(`r=vendas&from=2000-01-01T00:00:00Z`)).vendas.find((v) => v.code === d.caixaNota) };
      if (venda) mostrarNota(venda);
      return;
    }
    if (d.caixaPrint || d.caixaProd) {
      const id = d.caixaPrint || d.caixaProd;
      try {
        const x = await api(`r=caixa&id=${encodeURIComponent(id)}`);
        if (d.caixaPrint) imprimirFechamento(x.caixa, x.resumo, x.vendas);
        else { paint(`hist-prod-${id}`, produtosDiaHTML(x.vendas)); t.hidden = true; }
      } catch (err) { T().toast(err.message); }
      return;
    }
    if (d.caixaCancel) {
      const motivo = prompt(`Cancelar a venda ${d.caixaCancel}? Ela deixa de contar no caixa. Escreva o motivo:`);
      if (motivo === null) return;
      try {
        const { estoque } = await api(`r=venda&acao=cancelar&code=${encodeURIComponent(d.caixaCancel)}`, "POST", { motivo, por: T().session()?.name });
        if (T().catalogoServidor) T().aplicarEstoque(estoque);
        T().toast(T().catalogoServidor ? `Venda ${d.caixaCancel} cancelada. O estoque voltou.` : `Venda ${d.caixaCancel} cancelada. Confira o estoque do produto.`);
        renderCaixa();
      }
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
    if (!prontoParaPagar()) return;
    if (!sale.vendedorId) {
      const e = $("#pdv-vend-err"); if (e) e.textContent = "Escolha o vendedor";
      $("#pdv-vend")?.focus(); return;
    }
    // troca de mesmo valor: não há o que cobrar nem devolver
    if (sale.tipo === "troca" && aPagar() === 0) { sale.pagamentos = []; saveSale(); return concluir(); }
    sale.etapa = "pagamento";
    // a loja não devolve dinheiro: com cliente cadastrado, a devolução já sugere virar crédito
    if (devolvendo() && sale.cliente?.id && !sale.pagamentos.length) sale.pagamentos = [{ forma: "credito_loja", valor: aPagar() }];
    saveSale(); renderPdv();
  }

  function syncDraft() {
    $$("[data-eq-loja]").forEach((i) => (draft.lojas[+i.dataset.eqLoja].nome = i.value.trim()));
    $$("[data-eq-vend]").forEach((i) => (draft.vendedores[+i.dataset.eqVend].nome = i.value.trim()));
    $$("[data-eq-ativo]").forEach((i) => (draft.vendedores[+i.dataset.eqAtivo].ativo = i.checked));
    $$("[data-eq-taxa]").forEach((i) => (draft.taxas[i.dataset.eqTaxa] = parseMoney(i.value)));
  }

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("pdv-q")) { searchAlvo = t.dataset.alvo; results = buscar(t.value); resultIdx = 0; renderResults(); return; }
    if (t.dataset.maskDoc !== undefined) { t.value = fmtDoc(t.value); return; }
    if (t.dataset.cup !== undefined && cupEdit && t.type !== "checkbox" && t.type !== "radio" && t.tagName !== "SELECT") {
      cupEdit[t.dataset.cup] = t.value;
      if (t.dataset.cup === "valor") refreshCupProds();
      return;
    }
    if (t.dataset.cupF !== undefined && cupEdit && t.tagName === "INPUT") { cupFiltro[t.dataset.cupF] = t.value; return refreshCupProds(); }
    if (t.id === "ent-q") return entBuscar(t.value);
    if (t.id === "cli-busca") { cliFiltro = t.value; const pos = t.selectionStart; renderClientes(); const n = $("#cli-busca"); n?.focus(); n?.setSelectionRange(pos, pos); return; }
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
    if (t.dataset.cup !== undefined && cupEdit && (t.type === "checkbox" || t.type === "radio" || t.tagName === "SELECT")) {
      const k = t.dataset.cup;
      cupEdit[k] = t.type === "checkbox" ? t.checked : t.value;
      if (k === "tipo") { renderCupons(); $("#cup-form [name=valor]")?.focus(); }
      else if (k === "publico") refreshCupProds();
      return;
    }
    if (t.dataset.cupF !== undefined && cupEdit && t.tagName === "SELECT") { cupFiltro[t.dataset.cupF] = t.value; return refreshCupProds(); }
    if (t.dataset.cupProd !== undefined && cupEdit) { if (t.checked) cupEdit.sel.add(t.dataset.cupProd); else cupEdit.sel.delete(t.dataset.cupProd); $("#cup-err").textContent = ""; return refreshCupProds(); }
    if (t.dataset.pdvLoja !== undefined) { store.set("ts_loja", t.value); sale.vendedorId = ""; saveSale(); return T().router(); }
    if (t.dataset.pdvVend !== undefined) { sale.vendedorId = t.value; store.set("ts_pdv_vendedor", t.value); saveSale(); const er = $("#pdv-vend-err"); if (er) er.textContent = ""; return; }
    if (t.dataset.ent !== undefined) { ent[t.dataset.ent] = t.type === "checkbox" ? t.checked : t.value; saveEnt(); return; }
    if (t.dataset.entItem !== undefined) {
      const it = ent.itens[+t.dataset.entItem];
      if (t.dataset.field === "qty") it.qty = Math.max(1, parseInt(t.value, 10) || 1);
      if (t.dataset.field === "custo") it.custo = Math.max(0, parseMoney(t.value));
      saveEnt(); return renderEntrada();
    }
    if (t.dataset.pdvItem !== undefined) {
      const [alvo, i] = t.dataset.pdvItem.split(":");
      const it = sale[alvo][+i], f = t.dataset.field;
      if (f === "estado") it.estado = t.value === "defeito" ? "defeito" : "bom";
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
    if (e.target.id === "ent-q" && e.key === "Enter") { e.preventDefault(); if (entResults[0]) { e.target.value = ""; entAdd(entResults[0].id); } return; }
    if (e.target.closest?.("#ent-form") && e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); e.target.dispatchEvent(new Event("change", { bubbles: true })); return; }
    if (!location.hash.includes("aba=balcao")) return;
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "F2") { e.preventDefault(); $(".pdv-q")?.focus(); return; }
    if (e.key === "F9") { e.preventDefault(); if (sale.etapa === "itens") irPagamento(); return; }
    const t = e.target;
    if (t.classList.contains("pdv-q")) {
      searchAlvo = t.dataset.alvo;
      if (e.key === "ArrowDown" && results.length) { e.preventDefault(); resultIdx = (resultIdx + 1) % results.length; renderResults(); }
      else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); resultIdx = (resultIdx - 1 + results.length) % results.length; renderResults(); }
      else if (e.key === "Enter") { e.preventDefault(); if (results[resultIdx]) addProduto(results[resultIdx].id, searchAlvo); }
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
    if (f.id === "cli-form") { e.preventDefault(); return salvarClienteNovo(f); }
    if (f.id === "cup-form") { e.preventDefault(); return salvarCupom(f); }
    if (f.id === "pdv-cupom") { e.preventDefault(); return aplicarCupomPdv(f.cupom.value); }
    if (f.id === "cad-cli-form") {
      e.preventDefault();
      const nome = f.nome.value.trim(), doc = f.doc.value.trim(), tel = f.phone.value.trim(), dig = T().digits(doc);
      T().setErr(f, "nome", nome.length < 2 ? "Informe o nome" : "");
      T().setErr(f, "doc", !dig || dig.length === 11 || dig.length === 14 ? "" : "CPF tem 11 dígitos e CNPJ tem 14");
      T().setErr(f, "phone", !tel || T().digits(tel).length >= 10 ? "" : "WhatsApp incompleto");
      if (nome.length < 2 || (dig && dig.length !== 11 && dig.length !== 14) || (tel && T().digits(tel).length < 10)) return;
      const body = { nome, doc, telefone: tel, tipo: f.tipo.value };
      try {
        const r = cliEdit?.id ? await api(`r=clientes&id=${encodeURIComponent(cliEdit.id)}`, "PUT", body) : await api("r=clientes", "POST", body);
        if (r.existente) T().toast(`${r.cliente.nome} já estava cadastrado (mesmo CPF/CNPJ ou telefone).`); else T().toast(cliEdit?.id ? "Cliente atualizado" : "Cliente cadastrado");
        cliEdit = null; await loadSetup(true); renderClientes();
      } catch (err) { T().toast(err.message); }
      return;
    }
    if (f.dataset.cadReceber) {
      e.preventDefault();
      const v = parseMoney(f.valor.value);
      if (!(v > 0)) { f.valor.focus(); return T().toast("Informe o valor recebido"); }
      const btn = f.querySelector("button"); btn.disabled = true;
      try {
        await loadSetup(true);
        const r = await api(`r=clientes&acao=receber&id=${encodeURIComponent(f.dataset.cadReceber)}`, "POST", { valor: v, forma: f.forma.value, lojaId: lojaId(), por: T().session()?.name });
        T().toast(r.fiado ? `Recebido ${money(v)}. Ainda deve ${money(r.fiado)}.` : `Recebido ${money(v)}. Fiado quitado!`);
        await loadSetup(true); renderClientes();
      } catch (err) { btn.disabled = false; T().toast(err.message); }
      return;
    }
    if (f.dataset.cadAjuste) {
      e.preventDefault();
      const v = parseMoney(f.valor.value);
      if (!(v > 0)) { f.valor.focus(); return T().toast("Informe o valor"); }
      const sinal = e.submitter?.value === "menos" ? -1 : 1;
      try { const r = await api(`r=clientes&acao=credito&id=${encodeURIComponent(f.dataset.cadAjuste)}`, "POST", { valor: sinal * v, motivo: f.motivo.value }); T().toast(`Crédito atualizado: ${money(r.credito)}`); await loadSetup(true); renderClientes(); }
      catch (err) { T().toast(err.message); }
      return;
    }
    if (f.id === "forn-form") {
      e.preventDefault();
      const nome = f.nome.value.trim();
      T().setErr(f, "nome", nome.length < 2 ? "Informe o nome do fornecedor" : "");
      if (nome.length < 2) return;
      const dados = { nome, doc: f.doc.value.trim(), telefone: f.phone.value.trim(), contato: f.contato.value.trim(), cidade: f.cidade.value.trim(), obs: f.obs.value.trim() };
      const lista = fornEdit?.id ? forn.fornecedores.map((x) => (x.id === fornEdit.id ? { ...x, ...dados } : x)) : [{ ...dados }, ...forn.fornecedores];
      try { const r = await api("r=fornecedores", "PUT", { fornecedores: lista }); forn.fornecedores = r.fornecedores; T().toast(fornEdit?.id ? "Fornecedor atualizado" : "Fornecedor cadastrado"); fornEdit = null; renderFornecedores(); }
      catch (err) { T().toast(err.message); }
      return;
    }
    if (f.id === "ent-form") {
      e.preventDefault();
      const er = $("#ent-err");
      if (!ent.fornecedorId) { er.textContent = "Escolha o fornecedor"; $("#ent-forn")?.focus(); return; }
      if (!ent.itens.length) { er.textContent = "Adicione os produtos que chegaram"; return; }
      const btn = f.querySelector("button.btn--primary"); btn.disabled = true;
      try {
        const { compra, estoque, custos } = await api("r=compra", "POST", { fornecedorId: ent.fornecedorId, nota: ent.nota, data: ent.data || iso(new Date()), itens: ent.itens, lojaId: lojaId(), atualizaCusto: ent.atualizaCusto, por: T().session()?.name });
        if (T().catalogoServidor) T().aplicarEstoque(estoque, custos);
        else {
          // catálogo ainda só neste navegador: estoque e custo locais, como antes
          ent.itens.forEach((it) => { const p = T().prodBy(it.productId); if (p) { p.stock += it.qty; if (ent.atualizaCusto && it.custo > 0) p.cost = it.custo; } });
          T().saveProducts();
        }
        T().toast(`Entrada registrada: ${compra.itens.reduce((n, it) => n + it.qty, 0)} itens de ${compra.fornecedor.nome}`);
        ent = { fornecedorId: ent.fornecedorId, nota: "", data: "", itens: [], atualizaCusto: ent.atualizaCusto }; saveEnt();
        await loadForn(true); renderEntrada();
      } catch (err) { btn.disabled = false; er.textContent = err.message; }
      return;
    }
    if (f.id === "vend-rapido") {
      e.preventDefault();
      const nome = f.nome.value.trim();
      if (nome.length < 2) { f.nome.focus(); return T().toast("Digite o nome do vendedor"); }
      try {
        const s = await api("r=setup", "PUT", { lojas: setup.lojas, vendedores: [...setup.vendedores, { nome, lojaId: lojaId(), ativo: true }] });
        setup = { ...setup, ...s };
        sale.vendedorId = s.vendedores.find((v) => v.nome === nome && v.lojaId === lojaId())?.id || "";
        store.set("ts_pdv_vendedor", sale.vendedorId); saveSale();
        T().toast(`${nome} cadastrado como vendedor`); renderPdv();
      } catch (err) { T().toast(err.message); }
      return;
    }
    if (f.id === "abrir-form") {
      e.preventDefault();
      const btn = f.querySelector("button"); btn.disabled = true;
      try {
        await api("r=caixa&acao=abrir", "POST", { lojaId: lojaId(), fundo: parseMoney(f.fundo.value), por: T().session()?.name });
        await loadSetup(true); T().toast("Caixa aberto. Boas vendas!");
        if (location.hash.includes("aba=balcao")) renderPdv(); else renderCaixa();
      } catch (err) { btn.disabled = false; T().setErr(f, "fundo", err.message); }
      return;
    }
    if (f.id === "mov-form") {
      e.preventDefault();
      const valor = parseMoney(f.valor.value);
      if (!(valor > 0)) { f.valor.focus(); return T().toast("Informe o valor"); }
      try { await api(`r=caixa&acao=movimento&id=${encodeURIComponent(caixaAberto().id)}`, "POST", { tipo: f.tipo.value, valor, motivo: f.motivo.value, por: T().session()?.name }); T().toast("Registrado"); renderCaixa(); }
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
        const { caixa, resumo: r } = await api(`r=caixa&acao=fechar&id=${encodeURIComponent(f.dataset.caixa)}`, "POST", { contado, obs: f.obs.value, por: T().session()?.name });
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

  // usado pelo financeiro.js (estoque, despesas e dashboard)
  window.TS_PDV = { api, loadSetup, get setup() { return setup; }, lojaId, loja, caixaAberto, lojaPicker, asyncView, skel, paint, stat, money, parseMoney, fmtMoneyInput, FORMAS, periodo, PERIODOS, iso, dia, hora, norm, store };
  window.TS_EXT = { tabs: { inicio: viewInicio, balcao: viewBalcao, caixa: viewCaixa, relatorios: viewRelatorios, equipe: viewEquipe, clientes: viewClientes, fornecedores: viewFornecedores, entrada: viewEntrada, cupons: viewCupons } };
})();
