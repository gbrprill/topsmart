// Películas compatíveis: escolhe marca e modelo e mostra em quais aparelhos a mesma película serve.
// Os dados vêm de assets/peliculas.json (tabela de compatibilidade enviada pela loja) e só carregam ao abrir a página.
(() => {
  const T = () => window.TS;
  const esc = (s) => T().esc(s);
  const icon = (id) => T().icon(id);

  let dados = null;        // { fonte, atualizado, marcas: [[marca, [[modelo, [compatíveis]]]]] }
  let carregando = null;
  let idx = null;          // índices montados a partir dos dados
  let busca = "";

  // chave de comparação: "Samsung A12", "Galaxy A12" e "A12" viram "a12"; "Moto G20" e "G20" viram "g20"
  const MARCAS_NOME = /\b(samsung|galaxy|motorola|moto|apple|lg|asus|oppo|xiaomi|realme|infinix)\b/g;
  const chave = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(MARCAS_NOME, " ").replace(/[^a-z0-9+().]+/g, " ").trim();
  const curto = (marca, nome) => (nome.toLowerCase().startsWith(marca.toLowerCase() + " ") ? nome.slice(marca.length + 1) : nome);

  function montar() {
    const bases = new Map();     // chave -> { nome, marca, compat: [nomes] }
    const nomes = new Map();     // chave -> nome para mostrar (prefere o nome da tabela própria)
    const usadoEm = new Map();   // chave do aparelho -> [chaves das películas que servem nele]
    for (const [marca, modelos] of dados.marcas) {
      for (const [nome, compat] of modelos) {
        const k = chave(nome);
        if (!bases.has(k)) bases.set(k, { nome, marca, compat });
        nomes.set(k, nome);
        for (const c of compat) {
          const kc = chave(c);
          if (!nomes.has(kc)) nomes.set(kc, c);
          if (!usadoEm.has(kc)) usadoEm.set(kc, []);
          if (!usadoEm.get(kc).includes(k)) usadoEm.get(kc).push(k);
        }
      }
    }
    idx = { bases, nomes, usadoEm };
  }

  async function carregar() {
    if (dados) return dados;
    carregando ||= fetch("assets/peliculas.json").then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { dados = d; montar(); return d; })
      .finally(() => { carregando = null; });
    return carregando;
  }

  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const linkPara = (marca, k) => `#/peliculas?${new URLSearchParams({ ...(marca ? { marca } : {}), ...(k ? { m: k } : {}) })}`;

  function view() {
    queueMicrotask(async () => {
      try { await carregar(); desenhar(); }
      catch { const el = document.getElementById("pel-root"); if (el) el.innerHTML = `<div class="empty">Não foi possível carregar a tabela agora.<br><button class="btn btn--ghost btn--sm" data-pel-retry style="margin-top:12px">Tentar de novo</button></div>`; }
    });
    return `<div class="view container pel">
      <nav class="crumbs" aria-label="Você está em"><a href="#/">Início</a>/<span>Películas compatíveis</span></nav>
      <div class="page-head"><h1>Películas compatíveis</h1><p class="muted">Escolha a marca e o modelo do celular para ver em quais aparelhos a mesma película serve.</p></div>
      <div id="pel-root">${dados ? miolo() : '<div class="skel"><div class="skel__row"></div><div class="skel__row"></div><div class="skel__row"></div></div>'}</div>
    </div>`;
  }

  function desenhar() {
    const el = document.getElementById("pel-root");
    if (el) el.innerHTML = miolo();
  }

  function miolo() {
    const p = params();
    const marcas = dados.marcas.map(([m]) => m);
    const marca = marcas.includes(p.get("marca")) ? p.get("marca") : marcas[0];
    const sel = p.get("m") && idx.nomes.has(p.get("m")) ? p.get("m") : null;
    return `<div class="pel__wrap ${sel ? "has-sel" : ""}">
      <div class="pel__tools">
        <label class="pel__search">${icon("i-search")}<span class="sr-only">Buscar modelo</span>
          <input type="search" id="pel-q" value="${esc(busca)}" placeholder="Buscar modelo, ex.: A12, Moto G54, iPhone 13" autocomplete="off" enterkeyhint="search"></label>
        <div class="pills" role="tablist" aria-label="Marca">${marcas.map((m) =>
          `<a class="pill" role="tab" href="${linkPara(m)}" aria-selected="${!busca && m === marca}">${esc(m)}</a>`).join("")}</div>
      </div>
      <div class="pel__grid">
        <div class="pel__list" id="pel-list">${lista(marca, sel)}</div>
        <section class="pel__detail" id="pel-detail" aria-live="polite">${detalhe(sel, marca)}</section>
      </div>
      <p class="pel__fonte">Fonte: ${esc(dados.fonte)}, atualizado em ${esc(dados.atualizado)}. Confira o encaixe na loja antes de aplicar.</p>
    </div>`;
  }

  function lista(marca, sel) {
    const q = chave(busca);
    if (q) {
      // busca em todas as marcas: modelos com tabela própria primeiro, depois aparelhos que só aparecem nas listas
      const achados = [...idx.nomes.keys()].filter((k) => k.includes(q))
        .sort((a, b) => (idx.bases.has(b) - idx.bases.has(a)) || (a.startsWith(q) ? -1 : 0) - (b.startsWith(q) ? -1 : 0) || a.localeCompare(b, "pt-BR", { numeric: true }))
        .slice(0, 80);
      if (!achados.length) return `<p class="pel__vazio">Nenhum modelo com “${esc(busca)}”. Tente só o número, ex.: <b>A12</b> ou <b>G54</b>.</p>`;
      return `<p class="pel__count">${achados.length === 80 ? "80+" : achados.length} ${achados.length === 1 ? "modelo" : "modelos"}</p>
        <ul class="pel__models">${achados.map((k) => {
          const b = idx.bases.get(k);
          return `<li><a href="${linkPara(b?.marca || marca, k)}" class="${k === sel ? "is-active" : ""}" ${k === sel ? 'aria-current="true"' : ""}>${esc(idx.nomes.get(k))}${b ? `<small>${esc(b.marca)}</small>` : ""}</a></li>`;
        }).join("")}</ul>`;
    }
    const modelos = dados.marcas.find(([m]) => m === marca)[1];
    return `<p class="pel__count">${modelos.length} modelos de ${esc(marca)}</p>
      <ul class="pel__models">${modelos.map(([nome]) => {
        const k = chave(nome);
        return `<li><a href="${linkPara(marca, k)}" class="${k === sel ? "is-active" : ""}" ${k === sel ? 'aria-current="true"' : ""}>${esc(curto(marca, nome))}</a></li>`;
      }).join("")}</ul>`;
  }

  function chips(chaves, marcaCtx) {
    return `<ul class="pel__chips">${chaves.map((k) => {
      const b = idx.bases.get(k);
      // dentro da mesma marca, "Samsung A03" aparece só como "A03"
      const nome = esc(curto(marcaCtx, idx.nomes.get(k) || k));
      return `<li>${b ? `<a href="${linkPara(b.marca || marcaCtx, k)}">${nome}</a>` : `<span>${nome}</span>`}</li>`;
    }).join("")}</ul>`;
  }

  function detalhe(k, marca) {
    if (!k) return `<div class="pel__hint">${icon("c-peliculas")}<p><strong>Escolha um modelo</strong>Toque no modelo do celular para ver as películas que servem nele.</p></div>`;
    const base = idx.bases.get(k);
    const nome = idx.nomes.get(k);
    // mesma película: aparelhos listados na tabela deste modelo
    const mesma = base ? [...new Set(base.compat.map(chave))].filter((x) => x !== k) : [];
    // outras películas que servem neste aparelho: tabelas de outros modelos que citam este
    const outras = (idx.usadoEm.get(k) || []).filter((x) => x !== k && !mesma.includes(x));
    const wa = `https://wa.me/${T().whatsapp}?text=${encodeURIComponent(`Olá! Quero uma película para ${nome}.`)}`;
    return `<div class="pel__card">
      <a class="pel__back" href="${linkPara(marca)}">${icon("i-left")}Todos os modelos</a>
      <span class="pel__eyebrow">${esc(base?.marca || "Aparelho")}</span>
      <h2>${esc(nome)}</h2>
      ${mesma.length ? `<div class="pel__sec"><h3>A película deste modelo também serve em <span>${mesma.length}</span></h3>${chips(mesma, base.marca)}</div>` : ""}
      ${outras.length ? `<div class="pel__sec"><h3>${mesma.length ? "Outras películas que servem nele" : "Películas que servem neste aparelho"} <span>${outras.length}</span></h3>${chips(outras, base?.marca || marca)}</div>` : ""}
      ${!mesma.length && !outras.length ? `<p class="pel__vazio">Não há película compatível de outro modelo na tabela. Use a película própria do ${esc(nome)}.</p>` : ""}
      <a class="btn btn--wa pel__cta" href="${wa}" target="_blank" rel="noopener">${icon("i-wa")}Pedir película do ${esc(nome)}</a>
    </div>`;
  }

  // busca sem recarregar a página: só a lista muda e o campo mantém o foco
  document.addEventListener("input", (e) => {
    if (e.target.id !== "pel-q" || !idx) return;
    busca = e.target.value;
    const p = params();
    const marcas = dados.marcas.map(([m]) => m);
    const marca = marcas.includes(p.get("marca")) ? p.get("marca") : marcas[0];
    const sel = p.get("m");
    document.getElementById("pel-list").innerHTML = lista(marca, sel);
    document.querySelectorAll(".pel .pill").forEach((a) => a.setAttribute("aria-selected", String(!busca && a.textContent === marca)));
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-pel-retry]")) return T().router();
    // ao trocar de marca, a busca é limpa
    if (e.target.closest(".pel .pill")) busca = "";
  });

  window.TS_PEL = { view, titulo: "Películas compatíveis" };
})();
