/* Varredura automática do estoque F&F — roda na aba do Sales Farma (uq.salesfarma.com.br).
   Ativada pelo favorito "Varredura F&F". Lê o estoque nos horários abaixo e grava no Estoque FFSP,
   que atualiza o app, o HTML de importação e dispara os avisos para a equipe. Não usa o Claude. */
(function () {
  var HORARIOS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]; // de hora em hora (segunda a sexta). O Sales bloqueia o acesso das 22h às 8h
  var diaUtil = function (d) { var w = d.getDay(); return w >= 1 && w <= 5; };
  var MINUTO = 6;                               // a F&F atualiza em :04, :24 e :44
  var MANTER_SESSAO_MIN = 8;                    // consulta leve a cada 8 min (8h às 22h, seg a sex) para o Sales não derrubar o login por inatividade
  var RPC = 'https://hrqsohrhebynjsnmxjkb.supabase.co/rest/v1/rpc/ingest_estoque';
  var KEY = 'sb_publishable_e5wV4RzjmKp5la1xrc5dYw_RaEAKIG4';
  var DIST = '10854165000850';

  if (!/salesfarma\.com\.br$/.test(location.hostname)) { alert('Abra o Sales Farma (uq.salesfarma.com.br), faça o login e clique no favorito de novo.'); return; }
  var eu = document.currentScript;
  var AUTO = !!(eu && eu.dataset.auto);            // iniciada pela extensão do Edge
  var TOKEN = window.__FF_TOKEN || (eu && eu.dataset.token);
  if (!TOKEN) { if (!AUTO) alert('Favorito desatualizado. Peça um novo ao Claude.'); return; }
  if (window.__ffVarredura) { window.__ffVarredura.mostrar(); return; }

  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var hhmm = function (d) { return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
  var estado = { ultima: ls.get('ff_ultima') || '', erro: '', rodando: false, alertado: false, mini: AUTO };

  // ---- selo na página ----
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#14201D;color:#fff;font:13px/1.4 Segoe UI,Arial,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:290px';
  document.body.appendChild(box);
  function dia(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function proximo(agora) {
    for (var i = 0; i < 8; i++) {
      var d = new Date(agora); d.setDate(d.getDate() + i);
      if (!diaUtil(d)) continue; // sábado e domingo
      for (var j = 0; j < HORARIOS.length; j++) {
        var t = new Date(d); t.setHours(HORARIOS[j], MINUTO, 0, 0);
        if (t > agora) return t;
      }
    }
    return null;
  }
  function render() {
    var p = proximo(new Date());
    if (estado.mini && !estado.erro) {
      box.style.padding = '6px 10px'; box.style.borderRadius = '999px'; box.style.cursor = 'pointer'; box.style.opacity = '.85';
      box.title = 'Varredura F&F ativa — clique para ver detalhes';
      box.innerHTML = '<div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><span style="width:8px;height:8px;border-radius:50%;background:#5BD69A"></span>' + (estado.rodando ? 'Lendo…' : 'Varredura · ' + (p ? hhmm(p) : '—')) + '</div>';
      box.onclick = function () { estado.mini = false; render(); };
      return;
    }
    box.onclick = null; box.style.padding = '10px 12px'; box.style.borderRadius = '10px'; box.style.cursor = ''; box.style.opacity = '1'; box.title = '';
    var cor = estado.erro ? '#FF8A7E' : '#5BD69A';
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;font-weight:700"><span style="width:9px;height:9px;border-radius:50%;background:' + cor + '"></span>Varredura F&amp;F ' + (estado.erro ? 'com problema' : 'ativa') + '</div>' +
      (estado.erro ? '<div style="color:#FFCFC9;margin-top:4px">' + estado.erro + '</div>' : '') +
      '<div style="opacity:.8;margin-top:4px">Última: ' + (estado.ultima || '—') + '<br>Próxima: ' + (p ? p.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '—') + '</div>' +
      '<div style="margin-top:6px;display:flex;gap:6px"><button id="ffv-agora" style="all:unset;cursor:pointer;background:#2446C4;padding:4px 10px;border-radius:6px;font-weight:600">' + (estado.rodando ? 'Lendo…' : 'Varrer agora') + '</button><button id="ffv-min" style="all:unset;cursor:pointer;opacity:.7;padding:4px 6px">minimizar</button></div>' +
      '<div style="opacity:.6;font-size:11px;margin-top:6px">' + (AUTO ? 'Liga sozinha em qualquer aba do Sales. Deixe uma aberta.' : 'Deixe esta aba aberta e não navegue nela.') + '</div>';
    document.getElementById('ffv-agora').onclick = function () { varrer('manual'); };
    document.getElementById('ffv-min').onclick = function (e) { e.stopPropagation(); estado.mini = true; render(); };
  }

  // ---- leitura do estoque ----
  async function lerEstoque() {
    var r = await fetch('/Ecommerce/SaldoEstoque/GetListaSaldoEstoque', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdistribuidor: [DIST] }), credentials: 'include' });
    var t = await r.text();
    var d = document.createElement('div'); d.innerHTML = t;
    var itens = [];
    d.querySelectorAll('tr').forEach(function (tr) {
      var c = Array.prototype.map.call(tr.cells, function (x) { return x.textContent.trim(); });
      if (c.length >= 4 && /^\d{12,14}$/.test(c[0])) itens.push({ e: c[0], q: parseInt(c[3].replace(/\./g, ''), 10) || 0 });
    });
    var pos = (t.match(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/) || [''])[0];
    if (itens.length < 50) throw new Error('sessao');
    return { itens: itens, pos: pos };
  }
  async function enviar(body) {
    var r = await fetch(RPC, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('banco ' + r.status);
    return r.json();
  }
  async function avisarProblema(msg) {
    if (estado.alertado) return;
    estado.alertado = true;
    try { await enviar({ token: TOKEN, itens: [], posicao: '', erro: msg }); } catch (e) {}
  }
  async function varrer(motivo) {
    if (estado.rodando) return;
    estado.rodando = true; render();
    try {
      var l = await lerEstoque();
      var res = await enviar({ token: TOKEN, itens: l.itens, posicao: l.pos, erro: null });
      estado.ultima = hhmm(new Date()) + ' (posição ' + (l.pos ? l.pos.slice(11, 16) : '—') + ')' + (res && (res.entrou || res.zerou) ? ' · ' + (res.entrou || 0) + ' entrou, ' + (res.zerou || 0) + ' zerou' : ' · sem mudanças');
      ls.set('ff_ultima', estado.ultima);
      estado.erro = ''; estado.alertado = false;
    } catch (e) {
      if (String(e.message) === 'sessao') { estado.erro = 'O login do Sales caiu. Entre de novo e clique no favorito Varredura F&F.'; avisarProblema('O login do Sales Farma caiu e a varredura parou. Entre de novo no Sales e clique no favorito "Varredura F&F".'); }
      else estado.erro = 'Falha ao gravar (' + e.message + '). Tento de novo no próximo horário.';
    }
    estado.rodando = false; render();
  }

  // ---- relógio ----
  var ultimoKeep = 0;
  function tique() {
    var agora = new Date();
    if (diaUtil(agora)) {
      for (var j = 0; j < HORARIOS.length; j++) {
        var t = new Date(agora); t.setHours(HORARIOS[j], MINUTO, 0, 0);
        var fim = new Date(t); fim.setMinutes(fim.getMinutes() + 50);
        if (agora >= t && agora < fim && ls.get('ff_slot') !== dia(agora) + '@' + HORARIOS[j]) {
          ls.set('ff_slot', dia(agora) + '@' + HORARIOS[j]);
          varrer('agenda'); break;
        }
      }
    }
    var h = agora.getHours();
    if (diaUtil(agora) && h >= 8 && h < 22 && Date.now() - ultimoKeep > MANTER_SESSAO_MIN * 60000 && !estado.rodando) {
      ultimoKeep = Date.now();
      lerEstoque().catch(function (e) { if (String(e.message) === 'sessao') { estado.erro = 'O login do Sales caiu. Entre de novo e clique no favorito Varredura F&F.'; render(); avisarProblema('O login do Sales Farma caiu e a varredura parou. Entre de novo no Sales e clique no favorito "Varredura F&F".'); } });
    }
    render();
  }
  window.__ffVarredura = { mostrar: function () { estado.mini = false; render(); } };
  render();
  ultimoKeep = Date.now();
  tique();
  setInterval(tique, 60000);
})();
