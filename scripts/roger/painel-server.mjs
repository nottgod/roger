#!/usr/bin/env node
// Painel do roger — ler, corrigir, APROVAR, e só então mandar.
//
// O que este arquivo faz de diferente do painel antigo:
//   - o texto é EDITÁVEL e a aprovação é um estado, não um gesto. Nada é enviável
//     antes de um humano aprovar, e editar depois de aprovar reabre a aprovação.
//   - "✓ Enviada" fecha a task no Kommo, grava nota [SENT] e cria a próxima FUP na
//     cadência — mas só aceita lead APROVADO.
//   - "💬 Respondeu" fecha a task SEM criar FUP (a conversa é do humano).
//   - GET /approved devolve a fila aprovada: é o que o braço de envio consome.
//
// A máquina de estados vive em lib/panel-core.mjs, pura e testada. Aqui fica só o
// que precisa de rede, disco e HTTP.
//
// Uso:
//   node painel-server.mjs batch-2026-06-10.json            # produção
//   DRY=1 node painel-server.mjs batch-2026-06-10.json      # ensaio (não escreve no Kommo)
//
// Formato do batch JSON:
// { "date": "2026-06-10", "title": "...", "leads": [ {
//     "n": 1, "co": "Empresa", "who": "Nome · Cargo",
//     "url": "https://linkedin.com/in/...", "msg": "texto gerado",
//     "stage": "FUP_2",          // MENSAGEM_INICIAL | FUP_1..FUP_5 | FUP_MAIS
//     "taskId": 123, "leadId": 456,
//     "hot": true, "fraco": false, "sign": false, "score": "4/5", "note": "..."
// } ] }

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { kget, kpost, kpatch, USER_ID, TASK_TYPE } from './kommo-config.mjs';
import { readLeadsFile } from './lib/leads-file.mjs';
import { loadCadencia, nextValidDate, endOfDayBRT } from './cadencia.mjs';
import {
  createState, applyAction, sendable, counters, entryFor, finalText,
  assertOwned, nextStepFor, escapeHtml,
} from './lib/panel-core.mjs';

const DRY = process.env.DRY === '1';
const PORT = parseInt(process.env.PORT || '4242', 10);
const HOST = '127.0.0.1'; // NUNCA 0.0.0.0: isto serve leads e textos, sem autenticação
const MAX_BODY = 256 * 1024;

const batchFile = process.argv[2];
if (!batchFile) { console.error('uso: node painel-server.mjs <batch.json>'); process.exit(1); }

// O painel aceita DOIS formatos: um batch pronto (JSON) ou a sua PLANILHA de leads.
// A planilha existe porque nada no projeto gerava o batch: quem tinha a mensagem escrita
// pelo modelo não tinha como colocá-la aqui sem escrever JSON à mão.
const batch = carregarBatch(resolve(batchFile));

function carregarBatch(caminho) {
  if (/\.csv$/i.test(caminho)) return batchDaPlanilha(caminho);
  const cru = JSON.parse(readFileSync(caminho, 'utf8'));
  if (Array.isArray(cru?.leads)) return cru;
  return batchDaPlanilha(caminho); // JSON de leads, no formato da planilha
}

function batchDaPlanilha(caminho) {
  const { leads, errors, warnings } = readLeadsFile(caminho);
  for (const e of errors) console.error(`  ✗ ${e}`);
  for (const w of warnings) console.error(`  ⚠ ${w}`);
  if (!leads.length) { console.error('nenhum lead legível nesse arquivo'); process.exit(1); }
  return {
    date: new Date().toISOString().slice(0, 10),
    title: `${leads.length} leads de ${caminho.split('/').pop()}`,
    // msg vazia de propósito: você cola a mensagem que o seu modelo escreveu, aqui na tela.
    leads: leads.map((l, i) => ({
      n: i + 1,
      co: l.company || l.name || '(sem nome)',
      who: [l.name, l.role].filter(Boolean).join(' · '),
      url: l.linkedin || l.website || '',
      msg: '',
      stage: l.stage || 'MENSAGEM_INICIAL',
      taskId: l.taskId ?? null,
      leadId: l.leadId ?? null,
      note: l.notes || '',
    })),
  };
}
const LOGDIR = join(dirname(fileURLToPath(import.meta.url)), 'logs');
mkdirSync(LOGDIR, { recursive: true });
const STATE_FILE = join(LOGDIR, `painel-state-${batch.date}.json`);
const EVENTS_FILE = join(LOGDIR, 'painel-events.jsonl');

let state = existsSync(STATE_FILE)
  ? { ...createState(batch), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
  : createState(batch);

const { map: CADENCIA, source: cadSource } = loadCadencia();

const STAGE_LABEL = {
  MENSAGEM_INICIAL: 'Mensagem Inicial', FUP_1: 'FUP 1', FUP_2: 'FUP 2',
  FUP_3: 'FUP 3', FUP_4: 'FUP 4', FUP_5: 'FUP 5', FUP_MAIS: 'FUP >5',
};
const STAGE_TO_TYPE = {
  MENSAGEM_INICIAL: TASK_TYPE.MENSAGEM_INICIAL,
  FUP_1: TASK_TYPE.FUP_1, FUP_2: TASK_TYPE.FUP_2, FUP_3: TASK_TYPE.FUP_3,
  FUP_4: TASK_TYPE.FUP_4, FUP_5: TASK_TYPE.FUP_5, FUP_MAIS: TASK_TYPE.FUP_MAIS,
};

function saveState() { writeFileSync(STATE_FILE, JSON.stringify(state, null, 1)); }
function logEvent(ev) {
  appendFileSync(EVENTS_FILE, JSON.stringify({ ts: new Date().toISOString(), batch: batch.date, dry: DRY, ...ev }) + '\n');
}

// ---------- operações Kommo ----------

// Dono conferido nas DUAS entidades. O painel antigo checava a task e depois gravava
// nota e follow-up no lead sem conferir de quem o lead é.
async function guardOwnership(item) {
  if (DRY) return;
  const task = await kget(`/tasks/${item.taskId}`);
  const t = assertOwned(task, USER_ID, `task ${item.taskId}`);
  if (!t.ok) throw new Error(t.error);

  const lead = await kget(`/leads/${item.leadId}`);
  const l = assertOwned(lead, USER_ID, `lead ${item.leadId}`);
  if (!l.ok) throw new Error(l.error);
}

async function hasOpenFup(leadId, excludeTaskId) {
  const d = await kget(`/tasks?filter[entity_id]=${leadId}&filter[entity_type]=leads&filter[is_completed]=0&limit=50`);
  const tasks = d?._embedded?.tasks || [];
  const fupTypes = new Set(Object.values(STAGE_TO_TYPE));
  return tasks.find((t) => t.id !== excludeTaskId && fupTypes.has(t.task_type_id)) || null;
}

async function markSent(item, text) {
  const result = { steps: [] };
  // Quem veio de planilha não tem CRM. Registrar local e seguir é o certo: tentar
  // escrever num CRM que não existe seria erro na cara de quem só queria mandar.
  if (!item.taskId && !item.leadId) {
    result.steps.push('sem CRM neste lead: registrado só aqui e no log local');
    return result;
  }
  // dia de envio = dia BRT (não UTC) — envio às 23h BRT ainda conta como hoje
  const nowBRT = new Date(Date.now() - 3 * 3600_000);
  const today = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate(), 12, 0, 0));
  const label = STAGE_LABEL[item.stage] || item.stage;

  await guardOwnership(item);

  // 1. fechar task atual
  if (!DRY) {
    await kpatch(`/tasks/${item.taskId}`, { is_completed: true, result: { text: `${label} enviada via painel roger` } });
  }
  result.steps.push(`task #${item.taskId} fechada (${label})`);

  // 2. nota [SENT] no lead, com o texto APROVADO (não o gerado)
  const noteText = `[SENT ${batch.date}] ${label} — "${text}"`;
  if (!DRY) {
    await kpost(`/leads/${item.leadId}/notes`, [{ note_type: 'common', params: { text: noteText } }]);
  }
  result.steps.push('nota [SENT] gravada');

  // 3. próxima FUP, se a cadência tiver próximo passo (fim de sequência não cria nada)
  const step = nextStepFor(item.stage, CADENCIA);
  if (step) {
    const dup = DRY ? null : await hasOpenFup(item.leadId, item.taskId);
    if (dup) {
      result.steps.push(`⚠ já existe task aberta #${dup.id} nesse lead — NÃO criei FUP nova (anti-duplicata)`);
    } else {
      const due = nextValidDate(today, step.days);
      const nextLabel = STAGE_LABEL[step.next];
      if (!DRY) {
        await kpost('/tasks', [{
          task_type_id: STAGE_TO_TYPE[step.next],
          text: nextLabel, // Kommo rejeita text vazio
          complete_till: endOfDayBRT(due),
          entity_id: item.leadId,
          entity_type: 'leads',
          responsible_user_id: USER_ID,
        }]);
      }
      result.steps.push(`próxima ${nextLabel} criada pra ${due.toISOString().slice(0, 10)} (D+${step.days}${cadSource === 'fallback' ? ', cadência fallback' : ''})`);
    }
  } else {
    result.steps.push('último toque da cadência — sequência encerrada, nada criado');
  }
  return result;
}

async function markReplied(item) {
  const result = { steps: [] };
  if (!item.taskId && !item.leadId) {
    result.steps.push('sem CRM neste lead: registrado só aqui');
    return result;
  }
  await guardOwnership(item);
  if (!DRY) {
    await kpatch(`/tasks/${item.taskId}`, { is_completed: true, result: { text: 'lead respondeu — o humano assume a conversa' } });
    await kpost(`/leads/${item.leadId}/notes`, [{
      note_type: 'common',
      params: { text: `[REPLIED ${batch.date}] lead respondeu antes/no lugar de ${STAGE_LABEL[item.stage] || item.stage}` },
    }]);
  }
  result.steps.push(`task #${item.taskId} fechada como "lead respondeu"`);
  result.steps.push('NENHUMA FUP criada — a conversa é sua agora');
  return result;
}

// ---------- HTML ----------

function html() {
  const payload = JSON.stringify(batch.leads).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(batch.title || 'Painel roger')} — ${escapeHtml(batch.date)}</title>
<style>
:root{--bg:#0f1115;--card:#1a1d24;--card2:#21252e;--line:#2c313c;--txt:#e6e8ec;--mut:#8b93a1;--acc:#4f9dff;--ok:#3ecf8e;--skip:#f0a92b;--fraco:#c678dd;--rep:#e06c75}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:10;background:rgba(15,17,21,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:14px 20px}
header h1{margin:0 0 8px;font-size:16px;font-weight:600}
.dry{display:inline-block;background:rgba(240,169,43,.18);color:var(--skip);font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-left:8px}
.stats{display:flex;gap:18px;align-items:center;flex-wrap:wrap;font-size:13px}
.stats b{font-size:18px;font-weight:700}
.s-app b{color:var(--acc)}.s-sent b{color:var(--ok)}.s-rej b{color:var(--rep)}.s-left b{color:var(--mut)}
.bar{flex:1;min-width:160px;height:8px;background:var(--line);border-radius:6px;overflow:hidden}
.bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--ok),var(--acc));transition:width .25s}
.note{max-width:860px;margin:14px auto 0;padding:0 20px;color:var(--mut);font-size:13px}
main{max-width:860px;margin:10px auto 60px;padding:0 20px}
.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
.card.approved{border-left-color:var(--acc)}.card.sent{border-left-color:var(--ok);opacity:.55}
.card.rejected{border-left-color:var(--rep);opacity:.6}.card.replied{border-left-color:var(--rep);opacity:.6}
.card.skipped{border-left-color:var(--skip);opacity:.6}.card.fraco{border-left-color:var(--fraco)}
.top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.num{font-weight:700;color:var(--mut)}.co{font-weight:600;font-size:16px}.who{color:var(--mut);font-size:13px}
.badge{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}
.b-fraco{background:rgba(198,120,221,.16);color:var(--fraco)}.b-hot{background:rgba(62,207,142,.16);color:var(--ok)}.b-stage{background:rgba(139,147,161,.16);color:var(--mut)}
.prof{display:inline-block;margin:10px 12px 8px 0;color:var(--acc);text-decoration:none;font-size:13px;font-weight:600}.prof:hover{text-decoration:underline}
textarea{width:100%;background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:11px 12px;font:14px/1.55 inherit;resize:vertical;min-height:96px}
textarea:focus{outline:none;border-color:var(--acc)}
.dirty{color:var(--skip);font-size:12px;margin-top:6px;display:none}
.actions{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap}
button.act{border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer}
.copy{background:var(--card2);color:var(--txt);border:1px solid var(--line)!important}.copy:hover{border-color:var(--acc)!important;color:var(--acc)}.copy.done{background:var(--acc);color:#04101f}
.app-btn{background:var(--acc);color:#04101f}.sent-btn{background:var(--ok);color:#042b1c}
.rej-btn{background:transparent;color:var(--rep);border:1px solid var(--rep)!important}
.rep-btn{background:transparent;color:var(--rep);border:1px solid var(--rep)!important}
.skip-btn{background:transparent;color:var(--skip);border:1px solid var(--skip)!important}
.undo{background:transparent;color:var(--mut);border:1px solid var(--line)!important;font-weight:500}
.reason{margin-top:8px;width:100%;background:var(--card2);color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:13px inherit}
.kommo{margin-top:8px;font-size:12px;color:var(--mut);white-space:pre-line}
.kommo.err{color:var(--rep)}
.state-tag{font-size:12px;font-weight:700;margin-left:auto}
.t-app{color:var(--acc)}.t-sent{color:var(--ok)}.t-rej{color:var(--rep)}.t-skip{color:var(--skip)}
.spin{opacity:.5;pointer-events:none}
</style></head><body>
<header>
  <h1>${escapeHtml(batch.title || 'Painel roger')} · ${escapeHtml(batch.date)} · ${batch.leads.length} contatos${DRY ? '<span class="dry">DRY-RUN — não escreve no Kommo</span>' : ''}</h1>
  <div class="stats">
    <span class="s-app">aprovadas <b id="cApp">0</b></span>
    <span class="s-sent">enviadas <b id="cSent">0</b></span>
    <span class="s-rej">recusadas <b id="cRej">0</b></span>
    <span class="s-left">por ler <b id="cLeft">0</b></span>
    <div class="bar"><i id="barFill"></i></div>
  </div>
</header>
<p class="note">Leia, <b>corrija o texto se precisar</b> e <b>Aprovar</b>. Nada é enviável antes disso, e mexer no texto depois de aprovar reabre a aprovação, porque o que você leu mudou. Depois de enviar (à mão ou pelo braço de envio), <b>✓ Enviada</b> fecha a task, grava a nota e cria a próxima FUP. Lead respondeu? <b>💬 Respondeu</b> fecha sem criar FUP.</p>
<main id="list"></main>
<script>
const DATA = ${payload};
let state = {};

async function api(path, body){
  const r = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
function copyText(txt, btn){
  const done = ()=>{btn.classList.add('done');btn.textContent='copiado';setTimeout(()=>{btn.classList.remove('done');btn.textContent='Copiar';},1400);};
  if(navigator.clipboard){navigator.clipboard.writeText(txt).then(done).catch(done);}else done();
}
async function act(n, action, card, extra){
  card.classList.add('spin');
  const res = await api('/action', Object.assign({n, action}, extra||{}));
  card.classList.remove('spin');
  if(res.state) state = res.state;
  if(res.error) alertInline(card, res.error);
  render();
}
function alertInline(card, msg){
  let el = card.querySelector('.kommo.err');
  if(!el){ el = document.createElement('div'); el.className='kommo err'; card.appendChild(el); }
  el.textContent = '✗ ' + msg;
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

function render(){
  const list = document.getElementById('list');
  list.innerHTML='';
  let app=0, sent=0, rej=0, left=0;
  for(const d of DATA){
    const e = state[d.n] || {status:'pending'};
    const st = e.status;
    if(st==='approved')app++; else if(st==='sent')sent++;
    else if(st==='rejected'||st==='skipped'||st==='replied')rej++; else left++;

    const card=document.createElement('div');
    card.className='card'+(d.fraco?' fraco':'')+(st&&st!=='pending'?(' '+st):'');
    const badges=(d.stage?'<span class="badge b-stage">'+esc(d.stage.replace('_',' '))+'</span>':'')
      +(d.score?'<span class="badge b-stage">'+esc(d.score)+'</span>':'')
      +(d.hot?'<span class="badge b-hot">quente</span>':'')
      +(d.fraco?'<span class="badge b-fraco">FRACO · pede decisor</span>':'');
    const tag = st==='approved'?'<span class="state-tag t-app">APROVADA</span>'
      : st==='sent'?'<span class="state-tag t-sent">ENVIADA</span>'
      : st==='rejected'?'<span class="state-tag t-rej">RECUSADA</span>'
      : st==='replied'?'<span class="state-tag t-rej">RESPONDEU</span>'
      : st==='skipped'?'<span class="state-tag t-skip">PULADA</span>':'';
    const kommoInfo = e.kommo ? '<div class="kommo'+(e.kommo.error?' err':'')+'">'+esc(e.kommo.error||e.kommo.steps.map(s=>'✓ '+s).join('\\n'))+'</div>' : '';
    const texto = (typeof e.text==='string' && e.text.trim()!=='') ? e.text : (d.msg||'');

    let botoes;
    if(st==='sent'){ botoes = '<button class="act undo">desfazer registro local</button>'; }
    else if(st==='approved'){ botoes = '<button class="act sent-btn">✓ Enviada</button><button class="act rej-btn">Recusar</button>'; }
    else if(st==='rejected'||st==='skipped'||st==='replied'){ botoes = '<button class="act undo">reabrir</button>'; }
    else { botoes = '<button class="act app-btn">Aprovar</button><button class="act rep-btn">💬 Respondeu</button><button class="act skip-btn">Pular</button>'; }

    card.innerHTML = '<div class="top"><span class="num">#'+d.n+'</span><span class="co">'+esc(d.co)+'</span><span class="who">'+esc(d.who||'')+'</span>'+badges+tag+'</div>'
      +(d.url?'<a class="prof" href="'+esc(d.url)+'" target="_blank" rel="noopener">Abrir perfil ↗</a>':'')
      +(d.note?'<div class="kommo">'+esc(d.note)+'</div>':'')
      +'<textarea rows="4" '+(st==='sent'?'readonly':'')+'>'+esc(texto)+'</textarea>'
      +'<div class="dirty">texto mudou — ao aprovar, é esta versão que vale</div>'
      +'<div class="actions"><button class="act copy">Copiar</button>'+botoes+'</div>'
      +'<input class="reason" placeholder="motivo (recusa, pulo)" value="'+esc(e.reason||'')+'">'
      +kommoInfo;

    const ta = card.querySelector('textarea');
    const dirty = card.querySelector('.dirty');
    ta.addEventListener('input', ()=>{ dirty.style.display = ta.value!==(d.msg||'') ? 'block' : 'none'; });
    const reason = () => card.querySelector('.reason').value;

    card.querySelector('.copy').onclick = ev => copyText(ta.value, ev.target);
    const ab=card.querySelector('.app-btn'); if(ab)ab.onclick=()=>act(d.n,'approve',card,{text:ta.value});
    const sb=card.querySelector('.sent-btn'); if(sb)sb.onclick=()=>act(d.n,'sent',card);
    const jb=card.querySelector('.rej-btn'); if(jb)jb.onclick=()=>act(d.n,'reject',card,{reason:reason()});
    const rb=card.querySelector('.rep-btn'); if(rb)rb.onclick=()=>act(d.n,'replied',card,{reason:reason()});
    const kb=card.querySelector('.skip-btn'); if(kb)kb.onclick=()=>act(d.n,'skip',card,{reason:reason()});
    const ub=card.querySelector('.undo'); if(ub)ub.onclick=()=>act(d.n,'undo',card,{force:true});
    list.appendChild(card);
  }
  document.getElementById('cApp').textContent=app;
  document.getElementById('cSent').textContent=sent;
  document.getElementById('cRej').textContent=rej;
  document.getElementById('cLeft').textContent=left;
  document.getElementById('barFill').style.width=((DATA.length-left)/DATA.length*100)+'%';
}
fetch('/state').then(r=>r.json()).then(s=>{state=s;render();});
</script></body></html>`;
}

// ---------- servidor ----------

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl e afins: sem Origin não há risco de página de terceiro
  return origin === `http://${HOST}:${PORT}` || origin === `http://localhost:${PORT}`;
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('corpo grande demais');
  }
  return JSON.parse(raw);
}

const server = createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/') return send(200, html(), 'text/html');
  if (req.method === 'GET' && req.url === '/state') return send(200, state);
  // A costura do braço de envio: só o que um humano aprovou.
  if (req.method === 'GET' && req.url === '/approved') {
    return send(200, { date: batch.date, leads: sendable(batch, state) });
  }

  if (req.method === 'POST' && req.url === '/action') {
    if (!originOk(req)) return send(403, { error: 'origem não permitida' });

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      // Antes um JSON malformado derrubava o processo no meio de um lote.
      return send(400, { error: `corpo inválido: ${e.message}` });
    }

    const { n, action, text, reason, force } = body || {};
    const item = batch.leads.find((l) => l.n === n);
    if (!item) return send(404, { error: 'item não encontrado' });

    // 1. a transição é decidida pelo núcleo puro (e é ele que barra envio sem aprovação)
    const t = applyAction(state, item, action, { text, reason, force });
    if (t.error) {
      logEvent({ n, co: item.co, action, refused: t.error });
      return send(200, { ok: false, error: t.error, state });
    }
    state = t.state;

    // 2. só depois, o efeito no CRM
    try {
      if (action === 'sent') {
        const r = await markSent(item, finalText(item, entryFor(state, n)));
        state[n] = { ...entryFor(state, n), kommo: r };
      } else if (action === 'replied') {
        const r = await markReplied(item);
        state[n] = { ...entryFor(state, n), kommo: r };
      }
      saveState();
      logEvent({ n, co: item.co, leadId: item.leadId, stage: item.stage, action, reason: reason || undefined });
      return send(200, { ok: true, state });
    } catch (e) {
      state[n] = { ...entryFor(state, n), kommo: { error: e.message } };
      saveState();
      logEvent({ n, co: item.co, action, error: e.message });
      return send(200, { ok: false, error: e.message, state });
    }
  }

  send(404, { error: 'rota desconhecida' });
});

server.listen(PORT, HOST, () => {
  const c = counters(batch, state);
  console.log(`\nPainel roger no ar: http://${HOST}:${PORT}`);
  console.log(`   batch: ${batchFile} (${c.total} contatos) · cadência: ${cadSource}${DRY ? ' · DRY-RUN' : ''}`);
  console.log(`   aprovadas: ${c.approved} · enviadas: ${c.sent} · por ler: ${c.pending}`);
  console.log(`   estado: ${STATE_FILE}\n   eventos: ${EVENTS_FILE}\n   Ctrl+C encerra.\n`);
});
