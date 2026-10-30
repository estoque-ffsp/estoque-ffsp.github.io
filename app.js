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
  <form class="login card" id="fLogin" novalidate>
    <div><h1>Estoque FFSP</h1><p>Estoque da F&amp;F Taboão e seus pré-pedidos.</p></div>
    <label>Setor <input id="lSetor" inputmode="numeric" autocomplete="username" placeholder="Ex.: 612010" required></label>
    <label>Senha <input id="lSenha" type="password" autocomplete="current-password" required></label>
    <div class="notice bad" id="lErr" ${msg ? "" : "hidden"}>${esc(msg || "")}</div>
    <button class="btn primary" type="submit" id="lBtn">Entrar</button>
    <p style="font-size:12.5px;color:var(--muted);margin:0">No primeiro acesso, a senha é o próprio número do setor. Você cria a sua logo depois.</p>
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
  <form class="login card" id="fSenha" novalidate>
    <div><h1>Crie sua senha</h1><p>Setor ${esc(S.rep.setor)}. Use pelo menos 6 caracteres.</p></div>
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
  <header>
    <div><h1>Estoque FFSP</h1><p>F&amp;F – Taboão da Serra · setor <span class="mono">${esc(S.rep.setor)}</span></p></div>
    <button class="btn link" id="btnSair" type="button">Sair</button>
  </header>
  <div class="strip">
    <div><b id="nSku">—</b><span>SKUs</span></div>
    <div class="bad"><b id="nRup">—</b><span>Em ruptura</span></div>
    <div class="ok"><b id="nVolta">—</b><span>Voltaram</span></div>
  </div>
  <div class="scan" id="scan"><span class="dot old"></span><span>Carregando o estoque…</span></div>
  <div id="faixaPush"></div>
  <div class="alert" id="alert" hidden><div><strong id="alertTitle"></strong><p id="alertText"></p></div><button class="btn primary small" id="alertGo" type="button">Ver pré-pedidos</button></div>
  <nav class="tabs" role="tablist">
    <button role="tab" data-view="estoque" aria-selected="true">Estoque</button>
    <button role="tab" data-view="pedidos" aria-selected="false">Pré-pedidos<span class="count" id="cntPed"></span></button>
    <button role="tab" data-view="novo" aria-selected="false">Novo</button>
  </nav>

  <section id="view-estoque">
    <h2>Voltaram ao estoque <small id="voltaQuando"></small></h2>
    <div class="list" id="listVolta"></div>
    <h2>Em ruptura <small>sem estoque na F&amp;F</small></h2>
    <div class="list" id="listRup"></div>
    <h2>Consultar produto</h2>
    <input id="busca" type="search" placeholder="Nome ou EAN, ex.: Zolpaz" autocomplete="off">
    <div class="list" id="listBusca" hidden></div>
    <details class="card"><summary>Histórico de entradas e rupturas</summary><div class="events" id="events"></div></details>
  </section>

  <section id="view-pedidos" hidden>
    <div class="actions" style="justify-content:space-between"><h2>Meus pré-pedidos <small>só você vê os seus</small></h2>
      <button class="btn primary" id="btnExport" type="button" disabled>Gerar planilha</button></div>
    <div class="notice warn" id="exportHint" hidden></div>
    <div class="items" id="listPed"></div>
  </section>

  <section id="view-novo" hidden>
    <h2 id="formTitle">Novo pré-pedido</h2>
    <form class="card" id="form" novalidate>
      <div class="grid2">
        <label>CNPJ do cliente <input id="fCnpj" inputmode="numeric" placeholder="00.000.000/0000-00"></label>
        <label>Nome do cliente <span class="hint">(opcional)</span><input id="fNome" placeholder="Ex.: Farmavip Princesa"></label>
        <label>ID da condição <input id="fCond" class="mono" inputmode="numeric"></label>
        <label>Prazo <select id="fPrazo">${PRAZOS.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>
        <label>Nº OS <span class="hint">(opcional)</span><input id="fOs" class="mono" inputmode="numeric"></label>
      </div>
      <div class="items" id="fItens"></div>
      <label>Adicionar produto <input id="fBusca" type="search" placeholder="Busque pelo nome ou EAN" autocomplete="off"></label>
      <div class="results" id="fResults" hidden></div>
      <div class="total"><span>Total líquido estimado <span style="font-size:12px;color:var(--muted)">(preço fábrica − desconto, sem impostos)</span></span><b id="fTotal">R$ 0,00</b></div>
      <div class="notice warn" id="minWarn" hidden></div>
      <div class="notice bad" id="formErr" hidden></div>
      <div class="actions"><button class="btn primary" type="submit" id="btnSalvar">Salvar pré-pedido</button><button class="btn" type="button" id="btnLimpar">Limpar</button></div>
    </form>
  </section>`;

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => mostrar(b.dataset.view)));
  $("#alertGo").onclick = () => mostrar("pedidos");
  $("#btnSair").onclick = async () => { await S.sb.auth.signOut(); location.reload(); };
  $("#busca").oninput = renderBusca;
  $("#btnExport").onclick = exportar;
  $("#listPed").addEventListener("click", cliquePedido);
  ligarForm();
  limparForm();
  renderPush();
  carregar();
  clearInterval(S.timer); S.timer = setInterval(() => document.visibilityState === "visible" && carregar(), 120000);
}
function mostrar(v) {
  S.view = v;
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  ["estoque", "pedidos", "novo"].forEach((x) => ($("#view-" + x).hidden = x !== v));
  window.scrollTo({ top: 0 });
}

/* ===================== dados ===================== */
async function carregar() {
  const [p, l, ev, ped] = await Promise.all([
    S.sb.from("produtos").select("ean,nome,pf,desc_max,estoque").order("nome"),
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
const dt = (iso, o = { dateStyle: "short", timeStyle: "short" }) => new Date(iso).toLocaleString("pt-BR", o);
function renderEstoque() {
  const rup = S.produtos.filter((p) => !p.estoque);
  $("#nSku").textContent = S.produtos.length || "—";
  $("#nRup").textContent = S.produtos.length ? rup.length : "—";
  $("#nVolta").textContent = S.leitura ? S.voltaram.length : "—";
  if (S.leitura) {
    const h = (Date.now() - new Date(S.leitura.lido_em)) / 36e5;
    $("#scan").innerHTML = `<span class="dot${h > 8 ? " old" : ""}"></span><span>Última varredura: <b>${dt(S.leitura.lido_em)}</b> · posição Sales Farma ${esc(S.leitura.posicao || "—")}</span>`;
    $("#voltaQuando").textContent = "na varredura de " + dt(S.leitura.lido_em);
  } else $("#scan").innerHTML = `<span class="dot old"></span><span>Nenhuma varredura de estoque publicada ainda.</span>`;
  $("#listVolta").innerHTML = S.voltaram.length ? S.voltaram.map((e) => `<div class="row"><span class="name">${esc(e.nome)}</span><span class="pill ok">${(e.qtd || 0).toLocaleString("pt-BR")} un.</span><span class="sub mono">${esc(e.ean)}</span></div>`).join("") : `<div class="empty">Nenhum produto voltou na última varredura.</div>`;
  $("#listRup").innerHTML = rup.length ? rup.map((p) => `<div class="row"><span class="name">${esc(p.nome)}</span><span class="pill bad">sem estoque</span><span class="sub mono">${esc(p.ean)}</span></div>`).join("") : `<div class="empty">${S.produtos.length ? "Nenhum produto em ruptura." : "O estoque aparece aqui depois da primeira varredura."}</div>`;
  renderBusca();
  $("#events").innerHTML = S.eventos.length ? S.eventos.slice(0, 60).map((x) => `<div><time>${dt(x.criado_em, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span class="pill ${x.tipo === "ENTROU" ? "ok" : "bad"}">${x.tipo === "ENTROU" ? "entrou" : "zerou"}</span><span>${esc(x.nome)}${x.tipo === "ENTROU" && x.qtd ? ` · <span class="qty">${x.qtd.toLocaleString("pt-BR")} un.</span>` : ""}</span></div>`).join("") : `<span class="empty">Sem registros ainda.</span>`;
}
function buscar(q) { q = norm(q).trim(); if (!q) return []; const ws = q.split(/\s+/); return S.produtos.filter((p) => { const h = norm(p.nome) + " " + p.ean; return ws.every((w) => h.includes(w)); }).slice(0, 60); }
function renderBusca() {
  const q = $("#busca")?.value || "", box = $("#listBusca"); if (!box) return;
  if (!q.trim()) { box.hidden = true; return; }
  const r = buscar(q); box.hidden = false;
  box.innerHTML = r.length ? r.map((p) => `<div class="row"><span class="name">${esc(p.nome)}</span>${pillEst(p)}<span class="sub"><span class="mono">${esc(p.ean)}</span>${p.pf ? `<span>PF ${brl(p.pf)}</span>` : ""}${p.desc_max ? `<span>máx. Geral ${p.desc_max}%</span>` : ""}</span></div>`).join("") : `<div class="empty">Nenhum produto encontrado.</div>`;
}

/* ===================== notificações ===================== */
const b64ToU8 = (b) => { const p = "=".repeat((4 - (b.length % 4)) % 4); const s = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...s].map((c) => c.charCodeAt(0))); };
function renderPush() {
  const el = $("#faixaPush"); if (!el) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
    el.innerHTML = ios && !standalone ? `<div class="alert info"><div><strong>Instale o app para receber avisos</strong><p>No Safari, toque em Compartilhar e depois em <b>Adicionar à Tela de Início</b>. Abra pelo ícone novo.</p></div></div>` : "";
    return;
  }
  if (Notification.permission === "denied") { el.innerHTML = `<div class="alert info"><div><strong>Avisos bloqueados</strong><p>Libere as notificações do Estoque FFSP nos Ajustes do celular.</p></div></div>`; return; }
  if (Notification.permission === "granted" && ler("push_ok", false)) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="alert info"><div><strong>Ative os avisos</strong><p>O celular avisa quando um produto entrar ou zerar na F&amp;F, mesmo bloqueado.</p></div><button class="btn primary small" id="btnPush" type="button">Ativar</button></div>`;
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
  $("#cntPed").textContent = S.pedidos.length ? String(S.pedidos.length) : "";
  if (prontos.length) {
    $("#alert").hidden = false;
    $("#alertTitle").textContent = prontos.length === 1 ? "1 pré-pedido pronto para importar" : `${prontos.length} pré-pedidos prontos para importar`;
    $("#alertText").textContent = "Todos os itens têm estoque na F&F. Gere a planilha e importe no Sales Farma.";
  } else $("#alert").hidden = true;
  for (const id of [...S.sel]) if (!prontos.some((x) => x.po.id === id)) S.sel.delete(id);
  if (!lista.length) { $("#listPed").innerHTML = `<div class="list"><div class="empty">Você ainda não tem pré-pedidos. Use a aba <b>Novo</b> para cadastrar o primeiro.</div></div>`; updExport(); return; }
  $("#listPed").innerHTML = lista.map(({ po, st, tot }) => `
  <article class="po ${st.k === "ready" ? "ready" : ""}">
    <div class="po-head"><div class="who">${st.k === "ready" ? `<input type="checkbox" data-sel="${po.id}" ${S.sel.has(po.id) ? "checked" : ""} aria-label="Incluir na planilha">` : ""}
      <div><div style="font-weight:700">${esc(po.cliente || "Cliente")}</div><div class="mono" style="font-size:12.5px;color:var(--muted)">${fmtCnpj(po.cnpj)}</div></div></div>
      <span class="pill ${st.cls}">${esc(st.label)}</span></div>
    <div class="po-lines">${(po.itens || []).map((it) => { const p = S.pm[it.ean]; return `<div><span>${esc(p?.nome || it.nome)} · <span class="qty">${it.qtde}</span> un. · ${it.desc}%</span>${pillEst(p)}</div>`; }).join("")}</div>
    <div class="po-foot"><span>${brl(tot)} · ${esc(po.prazo)} · cond. <span class="mono">${esc(po.cond)}</span>${tot < MIN ? ` · <b style="color:var(--warn)">abaixo do mínimo</b>` : ""}</span>
      <span class="actions">${po.exportado_em ? `<button class="btn small" data-reabrir="${po.id}" type="button">Reabrir</button>` : `<button class="btn small" data-edit="${po.id}" type="button">Editar</button>`}<button class="btn small danger" data-del="${po.id}" type="button">Excluir</button></span></div>
    <div class="notice bad" data-confirm="${po.id}" hidden><span>Excluir este pré-pedido? Isso não pode ser desfeito.</span><span class="actions"><button class="btn small danger" data-delok="${po.id}" type="button">Excluir</button><button class="btn small" data-delno="${po.id}" type="button">Cancelar</button></span></div>
  </article>`).join("");
  updExport();
}
function updExport() {
  const n = S.sel.size, b = $("#btnExport"); b.disabled = !n; b.textContent = n ? `Gerar planilha (${n})` : "Gerar planilha";
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
  $("#fItens").addEventListener("click", (e) => { const r = e.target.closest("[data-rm]"); if (r) { S.fItens.splice(+r.dataset.rm, 1); renderFormItens(); } });
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
  box.innerHTML = S.fItens.map((it, i) => { const p = S.pm[it.ean]; return `
    <div class="item"><div><div class="pname">${esc(p?.nome || it.nome)}</div><div class="pmeta"><span class="mono">${esc(it.ean)}</span>${p?.pf ? `<span>PF ${brl(p.pf)}</span>` : ""}${p?.desc_max ? `<span>máx. Geral ${p.desc_max}%</span>` : ""}${pillEst(p)}</div></div>
      <label>Qtde<input id="q${i}" type="number" min="1" step="1" inputmode="numeric" value="${esc(it.qtde)}" data-q="${i}"></label>
      <label>Desc. %<input id="d${i}" type="number" min="0" max="99" step="1" inputmode="numeric" value="${esc(it.desc)}" data-d="${i}"></label>
      <button class="btn small danger" type="button" data-rm="${i}">Remover</button></div>`; }).join("");
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
  box.innerHTML = r.length ? r.map((p) => `<button type="button" data-add="${esc(p.ean)}"><span><b>${esc(p.nome)}</b><br><span class="mono" style="font-size:12px;color:var(--muted)">${esc(p.ean)}${p.pf ? " · PF " + brl(p.pf) : ""}</span></span>${pillEst(p)}</button>`).join("") : `<div class="empty">Nenhum produto encontrado.</div>`;
}
function limparForm() {
  S.editId = null; S.fItens = []; S.forcar = false;
  $("#form").reset(); $("#fCond").value = CONFIG.COND_PADRAO; $("#fPrazo").value = ler("prazo", "30/60/90 Dias");
  $("#formTitle").textContent = "Novo pré-pedido"; $("#btnSalvar").textContent = "Salvar pré-pedido"; $("#formErr").hidden = true; $("#fResults").hidden = true;
  renderFormItens();
}
function abrirEdicao(id) {
  const po = S.pedidos.find((p) => p.id === id); if (!po) return;
  S.editId = id; S.fItens = (po.itens || []).map((x) => ({ ...x })); S.forcar = false;
  $("#fCnpj").value = fmtCnpj(po.cnpj); $("#fNome").value = po.cliente || ""; $("#fCond").value = po.cond; $("#fPrazo").value = po.prazo; $("#fOs").value = po.os || "";
  $("#formTitle").textContent = "Editar pré-pedido"; $("#btnSalvar").textContent = "Salvar alterações"; renderFormItens(); mostrar("novo");
}
async function salvar(e) {
  e.preventDefault();
  const err = $("#formErr"); err.hidden = true;
  const cnpj = dig($("#fCnpj").value), cond = dig($("#fCond").value), probs = [];
  if (cnpj.length < 13 || cnpj.length > 14) probs.push("Informe o CNPJ do cliente com 14 dígitos.");
  if (!cond) probs.push("Informe o ID da condição.");
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
  gravar("prazo", body.prazo);
  $("#btnSalvar").disabled = true;
  const { error } = S.editId ? await S.sb.from("prepedidos").update(body).eq("id", S.editId) : await S.sb.from("prepedidos").insert(body);
  $("#btnSalvar").disabled = false;
  if (error) { err.hidden = false; err.textContent = "Não foi possível salvar agora. Verifique a internet e tente de novo."; return; }
  toast(S.editId ? "Pré-pedido atualizado." : "Pré-pedido salvo. Você será avisado quando tiver estoque.");
  limparForm(); await carregar(); mostrar("pedidos");
}
