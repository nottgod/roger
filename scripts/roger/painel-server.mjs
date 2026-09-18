#!/usr/bin/env node
// The roger panel — read, fix, APPROVE, and only then send.
//
// What this file does differently from the old panel:
//   - the text is EDITABLE and the approval is a state, not a gesture. Nothing is
//     sendable before a human approves, and editing after approving reopens the approval.
//   - "✓ Sent" closes the task in the CRM, saves a [SENT] note and creates the next
//     follow-up in the cadence — but it only accepts an APPROVED lead.
//   - "💬 Replied" closes the task WITHOUT creating a follow-up (the conversation is the human's).
//   - GET /approved returns the approved queue: that is what the sending arm consumes.
//
// The state machine lives in lib/panel-core.mjs, pure and tested. What stays here is only
// what needs network, disk and HTTP.
//
// Usage:
//   node painel-server.mjs batch-2026-06-10.json            # production
//   DRY=1 node painel-server.mjs batch-2026-06-10.json      # rehearsal (writes nothing to the CRM)
//
// The batch JSON format:
// { "date": "2026-06-10", "title": "...", "leads": [ {
//     "n": 1, "co": "Company", "who": "Name · Role",
//     "url": "https://linkedin.com/in/...", "msg": "the generated text",
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
import { TOKENS, BRAND_BAR } from './lib/theme.mjs';

const DRY = process.env.DRY === '1';
const PORT = parseInt(process.env.PORT || '4242', 10);
const HOST = '127.0.0.1'; // NEVER 0.0.0.0: this serves leads and drafts, with no authentication
const MAX_BODY = 256 * 1024;

const batchFile = process.argv[2];
if (!batchFile) { console.error('uso: node painel-server.mjs <batch.json>'); process.exit(1); }

// The panel accepts TWO formats: a ready batch (JSON) or your own lead SPREADSHEET.
// The spreadsheet exists because nothing in the project produced the batch: whoever had a
// message written by their model had no way to get it in here without writing JSON by hand.
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
  if (!leads.length) { console.error('no readable lead in that file'); process.exit(1); }
  return {
    date: new Date().toISOString().slice(0, 10),
    title: `${leads.length} leads from ${caminho.split("/").pop()}`,
    // msg is deliberately empty: you paste the message your model wrote, right here on screen.
    leads: leads.map((l, i) => ({
      n: i + 1,
      co: l.company || l.name || '(no name)',
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

// ---------- CRM operations ----------

// The owner is checked on BOTH entities. The old panel checked the task and then wrote the
// note and the follow-up on the lead without checking who the lead belongs to.
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
  // Whoever came from a spreadsheet has no CRM. Recording locally and moving on is the
  // right call: failing at a CRM that does not exist would be an error in their face.
  if (!item.taskId && !item.leadId) {
    result.steps.push('no CRM on this lead: recorded here and in the local log only');
    return result;
  }
  // send day = the BRT day (not UTC) — sending at 23:00 BRT still counts as today
  const nowBRT = new Date(Date.now() - 3 * 3600_000);
  const today = new Date(Date.UTC(nowBRT.getUTCFullYear(), nowBRT.getUTCMonth(), nowBRT.getUTCDate(), 12, 0, 0));
  const label = STAGE_LABEL[item.stage] || item.stage;

  await guardOwnership(item);

  // 1. close the current task
  if (!DRY) {
    await kpatch(`/tasks/${item.taskId}`, { is_completed: true, result: { text: `${label} enviada via painel roger` } });
  }
  result.steps.push(`task #${item.taskId} fechada (${label})`);

  // 2. a [SENT] note on the lead, with the APPROVED text (not the generated one)
  const noteText = `[SENT ${batch.date}] ${label} — "${text}"`;
  if (!DRY) {
    await kpost(`/leads/${item.leadId}/notes`, [{ note_type: 'common', params: { text: noteText } }]);
  }
  result.steps.push('nota [SENT] gravada');

  // 3. the next follow-up, if the cadence has a next step (end of sequence creates nothing)
  const step = nextStepFor(item.stage, CADENCIA);
  if (step) {
    const dup = DRY ? null : await hasOpenFup(item.leadId, item.taskId);
    if (dup) {
      result.steps.push(`⚠ there is already an open task #${dup.id} on this lead — no new follow-up created (anti-duplicate)`);
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
      result.steps.push(`next ${nextLabel} created for ${due.toISOString().slice(0, 10)} (D+${step.days}${cadSource === 'fallback' ? ', fallback cadence' : ''})`);
    }
  } else {
    result.steps.push('last touch of the cadence — sequence closed, nothing created');
  }
  return result;
}

async function markReplied(item) {
  const result = { steps: [] };
  if (!item.taskId && !item.leadId) {
    result.steps.push('no CRM on this lead: recorded here only');
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
  result.steps.push('NO follow-up created — the conversation is yours now');
  return result;
}

// ---------- HTML ----------

function html() {
  const payload = JSON.stringify(batch.leads).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(batch.title || 'roger panel')} — ${escapeHtml(batch.date)}</title>
<style>
${TOKENS}
${BRAND_BAR}
*{box-sizing:border-box}
body{margin:0;background:var(--ink);color:var(--text);font:15px/1.6 var(--font-body)}
header{position:sticky;top:0;z-index:10;background:rgba(10,9,18,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);padding:16px 20px}
header h1{margin:0 0 10px;font-family:var(--font-mono);font-size:15px;font-weight:500;letter-spacing:-.01em}
header h1 .dot{color:var(--red)}
.dry{display:inline-block;background:rgba(242,88,42,.16);color:var(--warn);font-family:var(--font-mono);font-size:11px;letter-spacing:.04em;padding:3px 9px;border-radius:20px;margin-left:8px}
.stats{display:flex;gap:18px;align-items:center;flex-wrap:wrap;font-family:var(--font-mono);font-size:12px;letter-spacing:.04em;color:var(--muted)}
.stats b{font-size:17px;font-weight:500}
.s-app b{color:var(--pending)}.s-sent b{color:var(--ok)}.s-rej b{color:var(--stop)}.s-left b{color:var(--muted)}
.bar{flex:1;min-width:160px;height:6px;background:var(--line);border-radius:6px;overflow:hidden}
.bar>i{display:block;height:100%;width:0;background:var(--rainbow);transition:width .25s}
.note{max-width:860px;margin:16px auto 0;padding:0 20px;color:var(--muted);font-size:13.5px}
main{max-width:860px;margin:10px auto 60px;padding:0 20px}
.card{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:var(--radius-lg);padding:16px 18px;margin:14px 0}
.card.approved{border-left-color:var(--pending)}.card.sent{border-left-color:var(--ok);opacity:.55}
.card.rejected{border-left-color:var(--stop);opacity:.6}.card.replied{border-left-color:var(--stop);opacity:.6}
.card.skipped{border-left-color:var(--warn);opacity:.6}.card.fraco{border-left-color:var(--weak)}
.top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.num{font-family:var(--font-mono);font-size:13px;color:var(--muted)}
.co{font-weight:600;font-size:16px}.who{color:var(--muted);font-size:13px}
.badge{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.04em;padding:3px 9px;border-radius:20px}
.b-fraco{background:rgba(233,60,176,.16);color:var(--weak)}
.b-hot{background:rgba(40,200,64,.16);color:var(--ok)}
.b-stage{background:rgba(168,159,174,.14);color:var(--muted)}
.prof{display:inline-block;margin:10px 12px 8px 0;color:var(--text);text-decoration:none;font-family:var(--font-mono);font-size:12.5px;border-bottom:1px solid var(--line)}
.prof:hover{border-bottom-color:var(--red)}
textarea{width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:12px 13px;font:14px/1.6 var(--font-body);resize:vertical;min-height:96px}
textarea:focus{outline:none;border-color:var(--muted)}
.dirty{color:var(--warn);font-size:12px;margin-top:6px;display:none}
.actions{display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap}
button.act{height:var(--ctl);border:none;border-radius:var(--radius);padding:0 16px;font-family:var(--font-mono);font-size:12.5px;letter-spacing:.02em;cursor:pointer;transition:filter .15s ease,border-color .15s ease,color .15s ease}
button.act:hover{filter:brightness(1.08)}
button.act:focus-visible{outline:2px solid var(--text);outline-offset:2px}
.copy{background:transparent;color:var(--muted);border:1px solid var(--line)!important}
.copy:hover{color:var(--text);border-color:var(--muted)!important}
.copy.done{background:var(--ok);color:#04220b;border-color:var(--ok)!important}
.app-btn{background:var(--red);color:var(--text);box-shadow:0 0 20px rgba(255,36,66,.3)}
.sent-btn{background:var(--ok);color:#04220b}
.rej-btn,.rep-btn{background:transparent;color:var(--stop);border:1px solid var(--stop)!important}
.skip-btn{background:transparent;color:var(--warn);border:1px solid var(--warn)!important}
.undo{background:transparent;color:var(--muted);border:1px solid var(--line)!important}
.reason{margin-top:10px;width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);padding:9px 11px;font:13px var(--font-body)}
.reason:focus{outline:none;border-color:var(--muted)}
.kommo{margin-top:8px;font-family:var(--font-mono);font-size:12px;color:var(--muted);white-space:pre-line}
.kommo.err{color:var(--stop)}
.state-tag{font-family:var(--font-mono);font-size:11px;letter-spacing:.08em;margin-left:auto}
.t-app{color:var(--pending)}.t-sent{color:var(--ok)}.t-rej{color:var(--stop)}.t-skip{color:var(--warn)}
.spin{opacity:.5;pointer-events:none}
</style></head><body>
<header>
  <h1>${escapeHtml(batch.title || 'roger panel')} · ${escapeHtml(batch.date)} · ${batch.leads.length} contacts${DRY ? '<span class="dry">DRY RUN — nothing is written to the CRM</span>' : ''}</h1>
  <div class="stats">
    <span class="s-app">approved <b id="cApp">0</b></span>
    <span class="s-sent">sent <b id="cSent">0</b></span>
    <span class="s-rej">declined <b id="cRej">0</b></span>
    <span class="s-left">to read <b id="cLeft">0</b></span>
    <div class="bar"><i id="barFill"></i></div>
  </div>
</header>
<p class="note">Read it, <b>fix the text if you need to</b>, then <b>Approve</b>. Nothing is sendable before that, and editing the text after approving reopens the approval, because what you read changed. Once it has gone out (by hand or through the sending arm), <b>✓ Sent</b> closes the task, saves the note and creates the next follow-up. Did they reply? <b>💬 Replied</b> closes it without a follow-up.</p>
<main id="list"></main>
<script>
const DATA = ${payload};
let state = {};

async function api(path, body){
  const r = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return r.json();
}
function copyText(txt, btn){
  const done = ()=>{btn.classList.add('done');btn.textContent='copied';setTimeout(()=>{btn.classList.remove('done');btn.textContent='copy';},1400);};
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
      +(d.hot?'<span class="badge b-hot">hot</span>':'')
      +(d.fraco?'<span class="badge b-fraco">WEAK · no decision maker</span>':'');
    const tag = st==='approved'?'<span class="state-tag t-app">APPROVED</span>'
      : st==='sent'?'<span class="state-tag t-sent">SENT</span>'
      : st==='rejected'?'<span class="state-tag t-rej">DECLINED</span>'
      : st==='replied'?'<span class="state-tag t-rej">REPLIED</span>'
      : st==='skipped'?'<span class="state-tag t-skip">SKIPPED</span>':'';
    const kommoInfo = e.kommo ? '<div class="kommo'+(e.kommo.error?' err':'')+'">'+esc(e.kommo.error||e.kommo.steps.map(s=>'✓ '+s).join('\\n'))+'</div>' : '';
    const texto = (typeof e.text==='string' && e.text.trim()!=='') ? e.text : (d.msg||'');

    let botoes;
    if(st==='sent'){ botoes = '<button class="act undo">undo local record</button>'; }
    else if(st==='approved'){ botoes = '<button class="act sent-btn">✓ Sent</button><button class="act rej-btn">Decline</button>'; }
    else if(st==='rejected'||st==='skipped'||st==='replied'){ botoes = '<button class="act undo">reopen</button>'; }
    else { botoes = '<button class="act app-btn">Approve</button><button class="act rep-btn">💬 Replied</button><button class="act skip-btn">Skip</button>'; }

    card.innerHTML = '<div class="top"><span class="num">#'+d.n+'</span><span class="co">'+esc(d.co)+'</span><span class="who">'+esc(d.who||'')+'</span>'+badges+tag+'</div>'
      +(d.url?'<a class="prof" href="'+esc(d.url)+'" target="_blank" rel="noopener">Open profile ↗</a>':'')
      +(d.note?'<div class="kommo">'+esc(d.note)+'</div>':'')
      +'<textarea rows="4" '+(st==='sent'?'readonly':'')+'>'+esc(texto)+'</textarea>'
      +'<div class="dirty">text changed — approving takes this version</div>'
      +'<div class="actions"><button class="act copy">copy</button>'+botoes+'</div>'
      +'<input class="reason" placeholder="reason (declined, skipped)" value="'+esc(e.reason||'')+'">'
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

// ---------- server ----------

function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl and friends: with no Origin there is no third-party page risk
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
  // The seam with the sending arm: only what a human approved.
  if (req.method === 'GET' && req.url === '/approved') {
    return send(200, { date: batch.date, leads: sendable(batch, state) });
  }

  if (req.method === 'POST' && req.url === '/action') {
    if (!originOk(req)) return send(403, { error: 'origin not allowed' });

    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      // A malformed JSON used to take the process down in the middle of a batch.
      return send(400, { error: `invalid body: ${e.message}` });
    }

    const { n, action, text, reason, force } = body || {};
    const item = batch.leads.find((l) => l.n === n);
    if (!item) return send(404, { error: 'item not found' });

    // 1. the transition is decided by the pure core (which is what blocks a send with no approval)
    const t = applyAction(state, item, action, { text, reason, force });
    if (t.error) {
      logEvent({ n, co: item.co, action, refused: t.error });
      return send(200, { ok: false, error: t.error, state });
    }
    state = t.state;

    // 2. only then, the effect on the CRM
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

  send(404, { error: 'unknown route' });
});

server.listen(PORT, HOST, () => {
  const c = counters(batch, state);
  console.log(`\nroger panel is up: http://${HOST}:${PORT}`);
  console.log(`   batch: ${batchFile} (${c.total} contacts) · cadence: ${cadSource}${DRY ? ' · DRY RUN' : ''}`);
  console.log(`   approved: ${c.approved} · sent: ${c.sent} · to read: ${c.pending}`);
  console.log(`   state: ${STATE_FILE}\n   events: ${EVENTS_FILE}\n   Ctrl+C stops it.\n`);
});
