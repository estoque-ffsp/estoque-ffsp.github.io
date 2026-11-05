import { CONFIG } from "./config.js";

const PRAZOS = ["7 Dias","15 dias","21 Dias","28 Dias","30/60/90 Dias","35 Dias","42/56/70 Dias","45 Dias","45/60/75 Dias","56 Dias","63 Dias","ANTECIPADO","49 Dias","35/42/49/56 dias","35/42/63 Dias","42/49 Dias","28/35/42 Dias","14/21/28 dias","30/45/60/75/90 Dias"];
const COLS = ["SETOR","CNPJ_PDV","CNPJ_DISTRIBUIDOR_1","ID_CONDICAO_DISTRIBUIDOR_1","PRAZO_DISTRIBUIDOR_1","CNPJ_DISTRIBUIDOR_2","ID_CONDICAO_DISTRIBUIDOR_2","PRAZO_DISTRIBUIDOR_2","CNPJ_DISTRIBUIDOR_3","ID_CONDICAO_DISTRIBUIDOR_3","PRAZO_DISTRIBUIDOR_3","CNPJ_DISTRIBUIDOR_4","ID_CONDICAO_DISTRIBUIDOR_4","PRAZO_DISTRIBUIDOR_4","CNPJ_DISTRIBUIDOR_5","ID_CONDICAO_DISTRIBUIDOR_5","PRAZO_DISTRIBUIDOR_5","EAN","DESCRICAO_EAN","QTDE","DESCONTO","ID_CAMPANHA","NUMERO_OS","DATA_PROGRAMADO"];
const MIN = CONFIG.PEDIDO_MINIMO;

const $ = (s) => document.querySelector(s);
const brl = (v) => (+v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dig = (s) => String(s ?? "").replace(/\D/g, "");
const fmtCnpj = (c) => dig(c).padStart(14, "0").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const ler = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3500); }

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  caixa: svg('<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>'),
  falta: svg('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
  baixo: svg('<path d="M3 7l6 6 4-4 8 8"/><path d="M21 11v6h-6"/>'),
  pedido: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  hist: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  mais: svg('<path d="M12 5v14M5 12h14"/>'),
  voltar: svg('<path d="M15 18l-6-6 6-6"/>'),
  busca: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  sino: svg('<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/>'),
  ok: svg('<path d="M20 6L9 17l-5-5"/>'),
  seta: svg('<path d="M12 19V5M5 12l7-7 7 7"/>'),
};
const TITULOS = { estoque: "Estoque F&F", ruptura: "Em falta", baixo: "Estoque baixo", pedidos: "Pré-pedidos", historico: "Entradas e faltas", novo: "Novo pré-pedido" };

const S = { sb: null, user: null, rep: null, produtos: [], pm: {}, leitura: null, eventos: [], voltaram: [], pedidos: [], view: "estoque", sel: new Set(), editId: null, fItens: [], forcar: false };

/* ===================== início ===================== */
(async function init() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
    S.sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  } catch (e) {
    $("#app").innerHTML = `<div class="notice bad">Não foi possível carregar o app. Verifique a internet e abra de novo.</div>`;
    return;
  }
  const { data } = await S.sb.auth.getSession();
  if (data.session) await entrou(data.session.user); else telaLogin();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.rep) carregar(); });
})();

/* ===================== login ===================== */
function telaLogin(msg) {
  $("#app").innerHTML = `
  <form class="login" id="fLogin" novalidate>
    <div><div class="logo">${IC.caixa}</div><h1>Estoque FFSP</h1><p>Estoque da F&amp;F Taboão e seus pré-pedidos.</p></div>
    <label>Setor <input id="lSetor" inputmode="numeric" autocomplete="username" placeholder="Número do seu setor" required></label>
    <label>Senha <input id="lSenha" type="password" autocomplete="current-password" required></label>
    <div class="notice bad" id="lErr" ${msg ? "" : "hidden"}>${esc(msg || "")}</div>
    <button class="btn primary" type="submit" id="lBtn">Entrar</button>
    <p style="font-size:13px;color:var(--muted);margin:0;text-align:center">No primeiro acesso, a senha é o próprio número do setor. Você cria a sua logo depois.</p>
  </form>`;
  $("#fLogin").onsubmit = async (e) => {
    e.preventDefault();
    const setor = dig($("#lSetor").value), senha = $("#lSenha").value;
    if (!setor || !senha) { $("#lErr").hidden = false; $("#lErr").textContent = "Informe o setor e a senha."; return; }
    $("#lBtn").disabled = true;
    const { data, error } = await S.sb.auth.signInWithPassword({ email: `${setor}@${CONFIG.DOMINIO_LOGIN}`, password: senha });
    $("#lBtn").disabled = false;
    if (error) { $("#lErr").hidden = false; $("#lErr").textContent = "Setor ou senha incorretos. Se esqueceu a senha, peça ao Gabriel para reiniciar."; return; }
    await entrou(data.user);
  };
}

async function entrou(user) {
  S.user = user;
  const { data: rep } = await S.sb.from("reps").select("*").eq("user_id", user.id).maybeSingle();
  if (!rep) { await S.sb.auth.signOut(); telaLogin("Este setor não está cadastrado no app."); return; }
  S.rep = rep;
  if (rep.trocar_senha) telaSenha(); else telaPrincipal();
}

function telaSenha() {
  $("#app").innerHTML = `
  <form class="login" id="fSenha" novalidate>
    <div><div class="logo">${IC.caixa}</div><h1>Crie sua senha</h1><p>Setor ${esc(S.rep.setor)}. Use pelo menos 6 caracteres.</p></div>
    <label>Nova senha <input id="s1" type="password" autocomplete="new-password" minlength="6"></label>
    <label>Repita a senha <input id="s2" type="password" autocomplete="new-password" minlength="6"></label>
    <div class="notice bad" id="sErr" hidden></div>
    <button class="btn primary" type="submit" id="sBtn">Salvar e entrar</button>
  </form>`;
  $("#fSenha").onsubmit = async (e) => {
    e.preventDefault();
    const a = $("#s1").value, b = $("#s2").value, err = $("#sErr");
    if (a.length < 6) { err.hidden = false; err.textContent = "A senha precisa ter pelo menos 6 caracteres."; return; }
    if (a !== b) { err.hidden = false; err.textContent = "As duas senhas não são iguais."; return; }
    if (a === S.rep.setor) { err.hidden = false; err.textContent = "Escolha uma senha diferente do número do setor."; return; }
    $("#sBtn").disabled = true;
    const { error } = await S.sb.auth.updateUser({ password: a });
    if (error) { $("#sBtn").disabled = false; err.hidden = false; err.textContent = "Não foi possível salvar a senha. Tente outra."; return; }
    await S.sb.rpc("senha_trocada");
    S.rep.trocar_senha = false;
    toast("Senha criada.");
    telaPrincipal();
  };
}

/* ===================== tela principal ===================== */
function telaPrincipal() {
  $("#app").innerHTML = `
  <header class="appbar">
    <button class="iconbtn" id="btnVoltar" type="button" aria-label="Voltar" hidden>${IC.voltar}</button>
    <div class="ttl"><h1 id="ttl">Estoque F&amp;F</h1><div class="scan" id="scan"><span class="dot old"></span><span>Carregando…</span></div></div>
    <button class="iconbtn" id="btnMenu" type="button" aria-label="Conta"><span class="avatar">${esc(S.rep.nome ? S.rep.nome.trim().split(/\s+/)[0] : String(S.rep.setor))}</span></button>
  </header>
  <div class="menu" id="menu" hidden><div class="who">Setor <b>${esc(S.rep.setor)}</b>${S.rep.nome ? " · " + esc(S.rep.nome) : ""}<br>F&amp;F – Taboão da Serra</div><button type="button" id="btnAtualizar">Atualizar agora</button><button type="button" class="danger" id="btnSair">Sair</button></div>

  <main>
  <section id="view-estoque">
    <div id="faixaPush"></div>
    <div class="banner ok tap" id="alert" hidden><div class="ic">${IC.ok}</div><div class="tx"><strong id="alertTitle"></strong><p id="alertText"></p></div></div>
    <div class="search">${IC.busca}<input id="busca" type="search" placeholder="Buscar produto ou EAN" autocomplete="off"></div>
    <div id="boxVolta" hidden>
      <div class="cap">Voltaram ao estoque <span id="voltaQuando" style="text-transform:none;font-weight:500"></span></div>
      <div class="list" id="listVolta" style="margin-top:10px"></div>
    </div>
    <div class="chips" id="alfabeto" role="group" aria-label="Ir para a letra"></div>
    <div id="listGeral"></div>
  </section>

  <section id="view-historico" hidden>
    <div class="selbar"><span>O que entrou e o que zerou nas últimas varreduras</span></div>
    <div class="hist"><div class="events" id="events"></div></div>
  </section>

  <section id="view-ruptura" class="has-dock" hidden>
    <div class="selbar"><span id="rupSelInfo"></span><span class="actions"><button class="btn text" type="button" id="rupTodos">Marcar todos</button><button class="btn text" type="button" id="rupNenhum">Desmarcar</button></span></div>
    <div class="list" id="listRup"></div>
    <div class="dock" data-dock="ruptura"><div><button class="btn wa" id="btnCopiarRup" type="button">Copiar para WhatsApp</button><button class="btn" id="btnShareRup" type="button" hidden>Enviar</button></div></div>
  </section>

  <section id="view-baixo" class="has-dock" hidden>
    <div class="selbar"><span>Menos de 100 unidades, do menor para o maior</span></div>
    <div class="list" id="listBaixo"></div>
    <div class="dock" data-dock="baixo"><div><button class="btn wa" id="btnCopiarBaixo" type="button">Copiar para WhatsApp</button></div></div>
  </section>

  <section id="view-pedidos" class="has-dock" hidden>
    <div class="selbar"><span>Só você vê os seus. Marque os prontos para gerar a planilha.</span></div>
    <div class="notice warn" id="exportHint" hidden></div>
    <div class="items" id="listPed"></div>
    <div class="dock" data-dock="pedidos" id="dockExport" hidden><div><button class="btn primary" id="btnExport" type="button" disabled>Gerar planilha</button></div></div>
  </section>

  <section id="view-novo" hidden>
    <form id="form" novalidate style="display:flex;flex-direction:column;gap:14px">
      <div class="cap">Cliente</div>
      <div class="card">
        <label>CNPJ do cliente <input id="fCnpj" inputmode="numeric" placeholder="14 dígitos"></label>
        <label><span>Nome do cliente <span class="hint">(opcional)</span></span><input id="fNome" placeholder="Nome do cliente"></label>
      </div>
      <div class="cap">Condição</div>
      <div class="card">
        <div class="grid2">
          <label>Prazo <select id="fPrazo"><option value="">Selecione</option>${PRAZOS.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>
          <label>ID da condição <input id="fCond" inputmode="numeric"></label>
        </div>
        <label><span>Nº OS <span class="hint">(opcional)</span></span><input id="fOs" inputmode="numeric"></label>
      </div>
      <div class="cap">Produtos</div>
      <div class="items" id="fItens"></div>
      <div class="search">${IC.busca}<input id="fBusca" type="search" placeholder="Adicionar produto: nome ou EAN" autocomplete="off"></div>
      <div class="results" id="fResults" hidden></div>
      <div class="notice warn" id="minWarn" hidden></div>
      <div class="notice bad" id="formErr" hidden></div>
      <button class="btn text" type="button" id="btnLimpar" style="align-self:center;color:var(--bad)">Limpar tudo</button>
      <div class="dock"><div><div class="sum"><small>Total estimado (PF − desc.)</small><b id="fTotal">R$ 0,00</b></div><button class="btn primary" type="submit" id="btnSalvar" style="flex:none;padding:12px 22px">Salvar</button></div></div>
    </form>
  </section>
  </main>

  <button class="fab" id="btnNovoTop" type="button" hidden>${IC.mais}Novo</button>

  <nav class="tabbar" role="tablist">
    <button type="button" role="tab" data-view="estoque" aria-selected="true">${IC.caixa}<span>Estoque</span><span class="badge" id="nSku" hidden></span></button>
    <button type="button" role="tab" data-view="ruptura" aria-selected="false">${IC.falta}<span>Em falta</span><span class="badge" id="nRup" hidden></span></button>
    <button type="button" role="tab" data-view="baixo" aria-selected="false">${IC.baixo}<span>Baixo</span><span class="badge warn" id="nBaixo" hidden></span></button>
    <button type="button" role="tab" data-view="pedidos" aria-selected="false" id="btnMeus">${IC.pedido}<span>Pré-pedidos</span><span class="badge ok" id="cntPed" hidden></span></button>
    <button type="button" role="tab" data-view="historico" aria-selected="false">${IC.hist}<span>Histórico</span></button>
  </nav>`;

  document.querySelectorAll(".tabbar [data-view]").forEach((b) => (b.onclick = () => mostrar(b.dataset.view)));
  $("#btnNovoTop").onclick = () => { limparForm(); mostrar("novo"); };
  $("#btnVoltar").onclick = () => mostrar("pedidos");
  $("#alert").onclick = () => mostrar("pedidos");
  $("#btnMenu").onclick = (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
  document.addEventListener("click", (e) => { if (!e.target.closest("#menu")) $("#menu").hidden = true; });
  $("#btnAtualizar").onclick = () => { $("#menu").hidden = true; carregar().then(() => toast("Atualizado.")); };
  $("#btnSair").onclick = async () => { await S.sb.auth.signOut(); location.reload(); };
  $("#busca").oninput = renderBusca;
  $("#alfabeto").addEventListener("click", (e) => {
    const b = e.target.closest("[data-letra]"); if (!b) return;
    const alvo = document.getElementById("L-" + b.dataset.letra); if (!alvo) return;
    const top = alvo.getBoundingClientRect().top + window.scrollY - parseFloat(getComputedStyle($(".appbar")).height) + 1;
    window.scrollTo({ top, behavior: "smooth" });
  });
  $("#btnExport").onclick = exportar;
  $("#btnCopiarRup").onclick = () => { if (!rupturas().some((p) => !fora().has(p.ean))) { toast("Marque pelo menos um produto para a mensagem."); return; } copiarLista("rup"); };
  $("#listRup").addEventListener("change", (e) => { const c = e.target.closest("[data-rup]"); if (c) marcarRup([c.dataset.rup], c.checked); });
  $("#rupTodos").onclick = () => marcarRup(rupturas().map((p) => p.ean), true);
  $("#rupNenhum").onclick = () => marcarRup(rupturas().map((p) => p.ean), false);
  $("#btnCopiarBaixo").onclick = () => copiarLista("baixo");
  if (navigator.share && /iphone|ipad|android/i.test(navigator.userAgent)) { $("#btnShareRup").hidden = false; $("#btnShareRup").onclick = () => compartilhar(textoLista("rup")); }
  $("#listPed").addEventListener("click", cliquePedido);
  ligarForm();
  limparForm();
  renderPush();
  mostrar("estoque");
  carregar();
  clearInterval(S.timer); S.timer = setInterval(() => document.visibilityState === "visible" && carregar(), 120000);
}
function mostrar(v) {
  S.view = v;
  const aba = v === "novo" ? "pedidos" : v;
  document.querySelectorAll(".tabbar [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === aba)));
  ["estoque", "ruptura", "baixo", "pedidos", "historico", "novo"].forEach((x) => ($("#view-" + x).hidden = x !== v));
  document.body.classList.toggle("full", v === "novo");
  $("#btnVoltar").hidden = v !== "novo";
  $("#btnNovoTop").hidden = v !== "pedidos";
  $("#ttl").textContent = v === "novo" ? (S.editId ? "Editar pré-pedido" : "Novo pré-pedido") : TITULOS[v];
  $("#menu").hidden = true;
  window.scrollTo({ top: 0 });
}

/* ===================== dados ===================== */
async function carregar() {
  const [p, l, ev, ped] = await Promise.all([
    S.sb.from("produtos").select("ean,nome,pf,desc_max,estoque,cx_embarque").order("nome"),
    S.sb.from("leituras").select("*").order("id", { ascending: false }).limit(1).maybeSingle(),
    S.sb.from("eventos").select("*").order("id", { ascending: false }).limit(80),
    S.sb.from("prepedidos").select("*").order("criado_em", { ascending: false }),
  ]);
  if (p.error || ped.error) {
    if ((p.error || ped.error)?.code === "PGRST301" || /JWT/i.test((p.error || ped.error)?.message || "")) { await S.sb.auth.signOut(); telaLogin("Sua sessão expirou. Entre de novo."); return; }
    $("#scan").innerHTML = `<span class="dot old"></span><span>Sem conexão. Mostrando os últimos dados.</span>`;
    return;
  }
  S.produtos = p.data || []; S.pm = {}; S.produtos.forEach((x) => (S.pm[x.ean] = x));
  S.leitura = l.data || null; S.eventos = ev.data || []; S.pedidos = ped.data || [];
  S.voltaram = S.leitura ? S.eventos.filter((e) => e.leitura_id === S.leitura.id && e.tipo === "ENTROU") : [];
  renderEstoque(); renderPedidos(); renderFormItens();
}

/* ===================== estoque ===================== */
const pillEst = (p) => !p ? `<span class="pill muted">fora do portfólio</span>` : p.estoque ? `<span class="pill ok">${p.estoque.toLocaleString("pt-BR")} un.</span>` : `<span class="pill bad">sem estoque</span>`;
const qEst = (p) => !p ? `<div class="q muted">fora do<br>portfólio</div>` : !p.estoque ? `<div class="q bad">Sem<br>estoque</div>` : `<div class="q ${p.estoque < 100 ? "warn" : "ok"}">${p.estoque.toLocaleString("pt-BR")}<small>unidades</small></div>`;
const dt = (iso, o = { dateStyle: "short", timeStyle: "short" }) => new Date(iso).toLocaleString("pt-BR", o);
const rupturas = () => S.produtos.filter((p) => !p.estoque);
// Produtos de ruptura que o representante tirou da mensagem (ex.: lançamentos). Fica salvo no aparelho.
const fora = () => new Set(ler("rup_fora", []));
function renderRup() {
  const rup = rupturas(), f = fora(), box = $("#listRup"); if (!box) return;
  box.innerHTML = rup.length ? rup.map((p) => `<label class="row sel"><input type="checkbox" data-rup="${esc(p.ean)}" ${f.has(p.ean) ? "" : "checked"}><div class="main"><div class="name">${esc(p.nome)}</div><div class="sub">EAN ${esc(p.ean)}</div></div></label>`).join("")
    : `<div class="empty">${S.produtos.length ? "Nenhum produto em falta. 🎉" : "O estoque aparece aqui depois da primeira varredura."}</div>`;
  const n = rup.filter((p) => !f.has(p.ean)).length;
  $("#rupSelInfo").textContent = rup.length ? `${n} de ${rup.length} na mensagem` : "";
  $("#btnCopiarRup").textContent = n ? `Copiar ${n} para o WhatsApp` : "Copiar para o WhatsApp";
}
function marcarRup(eans, incluir) { const f = fora(); eans.forEach((e) => (incluir ? f.delete(e) : f.add(e))); gravar("rup_fora", [...f]); renderRup(); }
const baixos = () => S.produtos.filter((p) => p.estoque > 0 && p.estoque < 100).sort((a, b) => a.estoque - b.estoque);
const linhaProd = (p) => `<div class="row"><div class="main"><div class="name">${esc(p.nome)}</div><div class="sub"><span>${esc(p.ean)}</span>${p.pf ? `<span>PF ${brl(p.pf)}</span>` : ""}${p.desc_max ? `<span>até ${p.desc_max}%</span>` : ""}${cxTxt(p)}</div></div>${qEst(p)}</div>`;
const cxTxt = (p) => (p?.cx_embarque ? `<span>Cx emb. ${p.cx_embarque} un.</span>` : "");
const badge = (el, n) => { el.hidden = !n; el.textContent = n > 99 ? "99+" : String(n || ""); };
function renderEstoque() {
  const rup = rupturas(), bx = baixos(), tem = S.produtos.length;
  badge($("#nRup"), tem ? rup.length : 0);
  badge($("#nBaixo"), tem ? bx.length : 0);
  $("#boxVolta").hidden = !S.voltaram.length;
  $("#listBaixo").innerHTML = bx.length ? bx.map((p) => `<div class="row"><div class="main"><div class="name">${esc(p.nome)}</div><div class="sub"><span>EAN ${esc(p.ean)}</span>${cxTxt(p)}</div></div>${qEst(p)}</div>`).join("") : `<div class="empty">${tem ? "Nenhum produto abaixo de 100 unidades." : "O estoque aparece aqui depois da primeira varredura."}</div>`;
  if (S.leitura) {
    const h = (Date.now() - new Date(S.leitura.lido_em)) / 36e5;
    const hoje = new Date(S.leitura.lido_em).toDateString() === new Date().toDateString();
    const quando = hoje ? "hoje às " + dt(S.leitura.lido_em, { hour: "2-digit", minute: "2-digit" }) : dt(S.leitura.lido_em, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    $("#scan").innerHTML = `<span class="dot${h > 8 ? " old" : ""}"></span><span>Atualizado ${quando}</span>`;
    $("#voltaQuando").textContent = "· " + quando;
  } else $("#scan").innerHTML = `<span class="dot old"></span><span>Aguardando a primeira leitura</span>`;
  $("#listVolta").innerHTML = S.voltaram.map((e) => `<div class="row"><div class="main"><div class="name">${esc(e.nome)}</div><div class="sub">EAN ${esc(e.ean)}</div></div><div class="q ok">+${(e.qtd || 0).toLocaleString("pt-BR")}<small>unidades</small></div></div>`).join("");
  renderRup();
  renderBusca();
  $("#events").innerHTML = S.eventos.length ? S.eventos.slice(0, 60).map((x) => `<div><time>${dt(x.criado_em, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span style="flex:1;min-width:0">${esc(x.nome)}</span><span class="pill ${x.tipo === "ENTROU" ? "ok" : "bad"}">${x.tipo === "ENTROU" ? "entrou" + (x.qtd ? " " + x.qtd.toLocaleString("pt-BR") : "") : "zerou"}</span></div>`).join("") : `<div class="empty">Sem registros ainda.</div>`;
}
function buscar(q, lim = 60) { q = norm(q).trim(); if (!q) return []; const ws = q.split(/\s+/); return S.produtos.filter((p) => { const h = norm(p.nome) + " " + p.ean; return ws.every((w) => h.includes(w)); }).slice(0, lim); }
const letraDe = (n) => { const c = norm(n).trim()[0] || "#"; return /[A-Z]/.test(c) ? c : "#"; };
function renderBusca() {
  const q = $("#busca")?.value || "", box = $("#listGeral"), alf = $("#alfabeto"); if (!box) return;
  if (!S.produtos.length) { alf.innerHTML = ""; box.innerHTML = `<div class="list"><div class="empty">O estoque aparece aqui depois da primeira varredura.</div></div>`; return; }
  if (q.trim()) {
    alf.hidden = true; $("#boxVolta").hidden = true;
    const r = buscar(q, 500);
    box.innerHTML = `<div class="list">${r.length ? r.map(linhaProd).join("") : `<div class="empty">Nenhum produto encontrado.</div>`}</div>`;
    return;
  }
  alf.hidden = false; $("#boxVolta").hidden = !S.voltaram.length;
  const grupos = {};
  S.produtos.forEach((p) => (grupos[letraDe(p.nome)] ||= []).push(p));
  const letras = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ#"].filter((l) => grupos[l]);
  alf.innerHTML = letras.map((l) => `<button type="button" data-letra="${l}">${l}</button>`).join("");
  box.innerHTML = letras.map((l) => `<div class="sec" id="L-${l}">${l}</div><div class="list">${grupos[l].map(linhaProd).join("")}</div>`).join("");
}

/* ===================== copiar / enviar no WhatsApp ===================== */
function textoLista(tipo) {
  const pos = S.leitura?.posicao ? S.leitura.posicao.slice(0, 16) : (S.leitura ? dt(S.leitura.lido_em) : "");
  if (tipo === "rup") {
    const f = fora(); const l = rupturas().filter((p) => !f.has(p.ean));
    return `*Produtos Genom em falta na F&F*${pos ? ` (posição ${pos})` : ""}\n\n${l.map((p) => `• ${p.nome}\n   EAN ${p.ean}`).join("\n")}`;
  }
  const l = baixos();
  return `*Produtos Genom com estoque baixo na F&F*${pos ? ` (posição ${pos})` : ""}\n\n${l.map((p) => `• ${p.nome} — ${p.estoque} un.\n   EAN ${p.ean}`).join("\n")}`;
}
async function copiarLista(tipo) {
  const txt = textoLista(tipo);
  try { await navigator.clipboard.writeText(txt); toast("Lista copiada. É só colar na conversa do WhatsApp."); }
  catch {
    const ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove();
    toast(ok ? "Lista copiada. É só colar na conversa do WhatsApp." : "Não foi possível copiar neste aparelho.");
  }
}
async function compartilhar(txt) { try { await navigator.share({ text: txt }); } catch {} }

/* ===================== notificações ===================== */
const b64ToU8 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const s = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...s].map((c) => c.charCodeAt(0))); };
function renderPush() {
  const el = $("#faixaPush"); if (!el) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    el.innerHTML = ios && !standalone ? `<div class="banner info"><div class="ic">${IC.sino}</div><div class="tx"><strong>Instale o app para receber avisos</strong><p>No Safari, toque em Compartilhar e depois em <b>Adicionar à Tela de Início</b>. Abra pelo ícone novo.</p></div></div>` : "";
    return;
  }
  if (Notification.permission === "denied") { el.innerHTML = `<div class="banner info"><div class="ic">${IC.sino}</div><div class="tx"><strong>Avisos bloqueados</strong><p>Libere as notificações do Estoque FFSP nos Ajustes do celular.</p></div></div>`; return; }
  if (Notification.permission === "granted" && ler("push_ok", false)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="banner info"><div class="ic">${IC.sino}</div><div class="tx"><strong>Ative os avisos</strong><p>Saiba na hora quando um produto entrar ou zerar.</p></div><button class="btn primary small" id="btnPush" type="button">Ativar</button></div>`;
  $("#btnPush").onclick = ativarPush;
}
async function ativarPush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { renderPush(); return; }
    const { data: chave } = await S.sb.rpc("vapid_publica");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(chave) });
    const j = sub.toJSON();
    const { error } = await S.sb.from("push_subs").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: S.user.id }, { onConflict: "endpoint" });
    if (error) throw error;
    gravar("push_ok", true);
    await S.sb.functions.invoke("avisos", { body: { teste: true } }).catch(() => {});
    toast("Avisos ativados. Uma notificação de teste está a caminho.");
    renderPush();
  } catch (e) { console.error(e); toast("Não foi possível ativar os avisos neste aparelho."); }
}

/* ===================== pré-pedidos ===================== */
const linhaTot = (it) => (S.pm[it.ean]?.pf || 0) * (1 - (+it.desc || 0) / 100) * (+it.qtde || 0);
const totPed = (po) => (po.itens || []).reduce((s, it) => s + linhaTot(it), 0);
function status(po) {
  if (po.exportado_em) return { k: "exp", label: "Exportado " + dt(po.exportado_em, { day: "2-digit", month: "2-digit" }), cls: "muted" };
  let falta = 0, parcial = 0;
  (po.itens || []).forEach((it) => { const q = S.pm[it.ean]?.estoque || 0; if (!q) falta++; else if (q < it.qtde) parcial++; });
  if (falta) return { k: "wait", label: falta === po.itens.length ? "Aguardando estoque" : `Aguardando ${falta} item(ns)`, cls: "bad" };
  if (parcial) return { k: "ready", label: "Pronto · estoque parcial", cls: "warn" };
  return { k: "ready", label: "Pronto para importar", cls: "ok" };
}
function renderPedidos() {
  const ord = { ready: 0, wait: 1, exp: 2 };
  const lista = S.pedidos.map((po) => ({ po, st: status(po), tot: totPed(po) })).sort((a, b) => ord[a.st.k] - ord[b.st.k]);
  const prontos = lista.filter((x) => x.st.k === "ready");
  badge($("#cntPed"), prontos.length);
  if (prontos.length) {
    $("#alert").hidden = false;
    $("#alertTitle").textContent = prontos.length === 1 ? "1 pré-pedido pronto para importar" : `${prontos.length} pré-pedidos prontos para importar`;
    $("#alertText").textContent = "Todos os itens têm estoque. Toque para gerar a planilha.";
  } else $("#alert").hidden = true;
  for (const id of [...S.sel]) if (!prontos.some((x) => x.po.id === id)) S.sel.delete(id);
  if (!lista.length) { $("#listPed").innerHTML = `<div class="list"><div class="empty">Você ainda não tem pré-pedidos.<br>Toque em <b>Novo</b> para cadastrar o primeiro.</div></div>`; updExport(); return; }
  $("#listPed").innerHTML = lista.map(({ po, st, tot }) => `
  <article class="po">
    <div class="po-head">${st.k === "ready" ? `<input type="checkbox" data-sel="${po.id}" ${S.sel.has(po.id) ? "checked" : ""} aria-label="Incluir na planilha">` : ""}
      <div class="who"><div class="cli">${esc(po.cliente || "Cliente")}</div><div class="cnpj">${fmtCnpj(po.cnpj)}</div></div>
      <span class="pill ${st.cls}">${esc(st.label)}</span></div>
    <div class="po-lines">${(po.itens || []).map((it) => { const p = S.pm[it.ean]; return `<div><span>${esc(p?.nome || it.nome)} · <span class="qty">${it.qtde}</span> un. · ${it.desc}%</span>${pillEst(p)}</div>`; }).join("")}</div>
    <div class="po-foot"><span><b>${brl(tot)}</b> · ${esc(po.prazo)}${tot < MIN ? ` · <span style="color:var(--warn);font-weight:600">abaixo do mínimo</span>` : ""}</span>
      <span class="actions">${po.exportado_em ? `<button class="btn small" data-reabrir="${po.id}" type="button">Reabrir</button>` : `<button class="btn small" data-edit="${po.id}" type="button">Editar</button>`}<button class="btn small danger" data-del="${po.id}" type="button">Excluir</button></span></div>
    <div class="notice bad" data-confirm="${po.id}" hidden><span>Excluir este pré-pedido? Isso não pode ser desfeito.</span><span class="actions"><button class="btn small primary" style="background:var(--bad)" data-delok="${po.id}" type="button">Excluir</button><button class="btn small" data-delno="${po.id}" type="button">Cancelar</button></span></div>
  </article>`).join("");
  updExport();
}
function updExport() {
  const n = S.sel.size, b = $("#btnExport"); b.disabled = !n; b.textContent = n ? `Gerar planilha (${n})` : "Gerar planilha"; $("#dockExport").hidden = !n;
  const baixos = S.pedidos.filter((p) => S.sel.has(p.id) && totPed(p) < MIN).length, h = $("#exportHint");
  h.hidden = !baixos; if (baixos) h.textContent = `${baixos} pedido(s) selecionado(s) estão abaixo de R$ 250,00 e podem ser recusados no Sales Farma.`;
}
async function cliquePedido(e) {
  const t = e.target.closest("[data-sel],[data-edit],[data-del],[data-delok],[data-delno],[data-reabrir]"); if (!t) return;
  const d = t.dataset;
  if (d.sel) { t.checked ? S.sel.add(d.sel) : S.sel.delete(d.sel); updExport(); return; }
  if (d.edit) return abrirEdicao(d.edit);
  if (d.del) { document.querySelector(`[data-confirm="${d.del}"]`).hidden = false; return; }
  if (d.delno) { document.querySelector(`[data-confirm="${d.delno}"]`).hidden = true; return; }
  if (d.delok) { const { error } = await S.sb.from("prepedidos").delete().eq("id", d.delok); toast(error ? "Não foi possível excluir." : "Pré-pedido excluído."); carregar(); return; }
  if (d.reabrir) { const { error } = await S.sb.from("prepedidos").update({ exportado_em: null, pronto_avisado: false }).eq("id", d.reabrir); toast(error ? "Não foi possível reabrir." : "Pré-pedido reaberto."); carregar(); }
}

/* ===================== planilha ===================== */
const prazoTxt = (p) => (p === "ANTECIPADO" ? p : p.replace(/\s*dias$/i, " dias"));
async function exportar() {
  if (!window.XLSX) { toast("A planilha ainda está carregando. Tente em instantes."); return; }
  const peds = S.pedidos.filter((p) => S.sel.has(p.id));
  const rows = [COLS];
  peds.forEach((po) => po.itens.forEach((it) => {
    const r = new Array(24).fill("");
    r[0] = dig(S.rep.setor); r[1] = dig(po.cnpj).padStart(14, "0"); r[2] = CONFIG.CNPJ_FF; r[3] = dig(po.cond); r[4] = prazoTxt(po.prazo);
    r[17] = it.ean; r[18] = S.pm[it.ean]?.nome || it.nome || ""; r[19] = String(+it.qtde); r[20] = String(+it.desc); r[22] = dig(po.os);
    rows.push(r);
  }));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  Object.keys(ws).forEach((k) => { if (k[0] !== "!") { ws[k].t = "s"; ws[k].v = String(ws[k].v); ws[k].z = "@"; } });
  ws["!cols"] = COLS.map((c, i) => ({ wch: i === 18 ? 44 : Math.max(10, c.length + 2) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Dados_pedidos");
  const d = new Date(), nome = `PREPEDIDOS_${S.rep.setor}_${String(d.getDate()).padStart(2, "0")}${String(d.getMonth() + 1).padStart(2, "0")}_IMPORT.xlsx`;
  const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const file = new File([blob], nome, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iphone|ipad|android/i.test(navigator.userAgent)) await navigator.share({ files: [file], title: nome });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  } catch (e) { if (e?.name === "AbortError") { toast("Envio cancelado."); return; } }
  await S.sb.from("prepedidos").update({ exportado_em: new Date().toISOString() }).in("id", peds.map((p) => p.id));
  S.sel.clear(); toast("Planilha gerada. Importe em Importação de pedidos no Sales Farma."); carregar();
}

/* ===================== formulário ===================== */
function ligarForm() {
  $("#fCnpj").onblur = () => { const d = dig($("#fCnpj").value); if (d.length >= 13) $("#fCnpj").value = fmtCnpj(d); };
  $("#fItens").addEventListener("input", (e) => {
    const q = e.target.dataset.q, d = e.target.dataset.d;
    if (q != null) S.fItens[q].qtde = Math.max(0, parseInt(e.target.value) || 0);
    if (d != null) S.fItens[d].desc = Math.min(99, Math.max(0, parseInt(e.target.value) || 0));
    updTotal();
  });
  $("#fItens").addEventListener("click", (e) => {
    const r = e.target.closest("[data-rm]"); if (r) { S.fItens.splice(+r.dataset.rm, 1); renderFormItens(); return; }
    const st = e.target.closest("[data-step]"); if (!st) return;
    const inp = $("#" + st.dataset.step), min = +inp.min || 0, max = inp.max ? +inp.max : 1e9;
    inp.value = Math.min(max, Math.max(min, (parseInt(inp.value) || 0) + +st.dataset.by));
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });
  $("#fBusca").oninput = () => resultados(false);
  $("#fResults").addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const ean = b.dataset.add; if (S.fItens.some((x) => x.ean === ean)) { toast("Este produto já está no pré-pedido."); return; }
    const p = S.pm[ean]; S.fItens.push({ ean, nome: p?.nome || ean, qtde: 1, desc: Math.min(20, p?.desc_max || 0) });
    $("#fBusca").value = ""; $("#fResults").hidden = true; renderFormItens(); $("#q" + (S.fItens.length - 1))?.focus();
  });
  $("#btnLimpar").onclick = limparForm;
  $("#form").onsubmit = salvar;
}
function renderFormItens() {
  const box = $("#fItens"); if (!box) return;
  box.innerHTML = S.fItens.length ? S.fItens.map((it, i) => { const p = S.pm[it.ean]; return `
    <div class="item"><div class="top"><div style="flex:1;min-width:0"><div class="pname">${esc(p?.nome || it.nome)}</div><div class="pmeta"><span>${esc(it.ean)}</span>${p?.pf ? `<span>PF ${brl(p.pf)}</span>` : ""}${p?.desc_max ? `<span>até ${p.desc_max}%</span>` : ""}${cxTxt(p)}${pillEst(p)}</div></div><button class="rm" type="button" data-rm="${i}" aria-label="Remover">×</button></div>
      <div class="nums"><label>Quantidade<div class="stepper"><button type="button" data-step="q${i}" data-by="-1">−</button><input id="q${i}" type="number" min="1" step="1" inputmode="numeric" value="${esc(it.qtde)}" data-q="${i}"><button type="button" data-step="q${i}" data-by="1">+</button></div></label>
      <label>Desconto %<div class="stepper"><button type="button" data-step="d${i}" data-by="-1">−</button><input id="d${i}" type="number" min="0" max="99" step="1" inputmode="numeric" value="${esc(it.desc)}" data-d="${i}"><button type="button" data-step="d${i}" data-by="1">+</button></div></label></div></div>`; }).join("")
    : `<div class="list"><div class="empty">Nenhum produto ainda. Busque abaixo para adicionar.</div></div>`;
  updTotal();
}
function updTotal() {
  const tot = S.fItens.reduce((s, it) => s + linhaTot(it), 0); $("#fTotal").textContent = brl(tot);
  const w = $("#minWarn");
  if (S.fItens.length && tot < MIN) {
    w.hidden = false;
    w.innerHTML = `<span>Este pedido soma <b>${brl(tot)}</b>. O pedido mínimo na F&amp;F é <b>R$ 250,00</b>; faltam <b>${brl(MIN - tot)}</b>.</span><span>Quer completar com outro item do portfólio?</span><span class="actions"><button class="btn small" type="button" id="btnCompletar">Ver portfólio</button></span>`;
    $("#btnCompletar").onclick = () => { $("#fBusca").focus(); resultados(true); };
  } else w.hidden = true;
  return tot;
}
function resultados(todos) {
  const q = $("#fBusca").value, box = $("#fResults");
  const r = q.trim() ? buscar(q) : todos ? S.produtos.filter((p) => p.estoque) : [];
  if (!q.trim() && !todos) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = r.length ? r.map((p) => `<button type="button" data-add="${esc(p.ean)}"><span class="main"><b>${esc(p.nome)}</b><br><span style="font-size:12.5px;color:var(--muted)">${pillEst(p)} ${p.pf ? " PF " + brl(p.pf) : ""}</span></span><span class="add">+</span></button>`).join("") : `<div class="empty">Nenhum produto encontrado.</div>`;
}
function limparForm() {
  S.editId = null; S.fItens = []; S.forcar = false;
  $("#form").reset(); $("#fCond").value = CONFIG.COND_PADRAO; $("#fPrazo").value = "";
  $("#btnSalvar").textContent = "Salvar"; $("#formErr").hidden = true; $("#fResults").hidden = true;
  renderFormItens();
}
function abrirEdicao(id) {
  const po = S.pedidos.find((p) => p.id === id); if (!po) return;
  S.editId = id; S.fItens = (po.itens || []).map((x) => ({ ...x })); S.forcar = false;
  $("#fCnpj").value = fmtCnpj(po.cnpj); $("#fNome").value = po.cliente || ""; $("#fCond").value = po.cond; $("#fPrazo").value = po.prazo; $("#fOs").value = po.os || "";
  $("#btnSalvar").textContent = "Salvar"; renderFormItens(); mostrar("novo");
}
async function salvar(e) {
  e.preventDefault();
  const err = $("#formErr"); err.hidden = true;
  const cnpj = dig($("#fCnpj").value), cond = dig($("#fCond").value), probs = [];
  if (cnpj.length < 13 || cnpj.length > 14) probs.push("Informe o CNPJ do cliente com 14 dígitos.");
  if (!cond) probs.push("Informe o ID da condição."); if (!$("#fPrazo").value) probs.push("Escolha o prazo.");
  if (!S.fItens.length) probs.push("Adicione pelo menos um produto.");
  if (S.fItens.some((i) => !i.qtde)) probs.push("Toda linha precisa de quantidade maior que zero.");
  if (probs.length) { err.hidden = false; err.innerHTML = probs.map(esc).join("<br>"); return; }
  const tot = updTotal();
  if (tot < MIN && !S.forcar) {
    err.hidden = false;
    err.innerHTML = `<span>O pedido está abaixo de R$ 250,00. Complete com outro item do portfólio ou salve assim mesmo.</span><span class="actions"><button class="btn small" type="button" id="btnForcar">Salvar assim mesmo</button></span>`;
    $("#btnForcar").onclick = () => { S.forcar = true; $("#form").requestSubmit(); };
    return;
  }
  S.forcar = false;
  const body = { cnpj: cnpj.padStart(14, "0"), cliente: $("#fNome").value.trim() || null, cond, prazo: $("#fPrazo").value, os: dig($("#fOs").value) || null,
    itens: S.fItens.map((i) => ({ ean: i.ean, nome: i.nome, qtde: +i.qtde, desc: +i.desc })) };
  $("#btnSalvar").disabled = true;
  const { error } = S.editId ? await S.sb.from("prepedidos").update(body).eq("id", S.editId) : await S.sb.from("prepedidos").insert(body);
  $("#btnSalvar").disabled = false;
  if (error) { err.hidden = false; err.textContent = "Não foi possível salvar agora. Verifique a internet e tente de novo."; return; }
  toast(S.editId ? "Pré-pedido atualizado." : "Pré-pedido salvo. Você será avisado quando tiver estoque.");
  limparForm(); await carregar(); mostrar("pedidos");
}
