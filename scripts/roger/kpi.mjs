#!/usr/bin/env node
// KPIs for Roger — two axes:
//
//  (1) outbound reply rate (top of funnel, the proof that the voice is the moat): it reads
//      logs/painel-events.jsonl and prints, week by week, sent/replies/skipped + reply rate.
//      Market benchmark: LinkedIn averages 10.4%, SaaS/tech 4.8-8.8%.
//      The bar worth aiming at: >12-15% is a sellable proof.
//
//  (2) conversion funnel (CRM, bottom of funnel): it reads the leads of the declared owner
//      and the status change events over the REST API (GET, read-only — it NEVER writes),
//      and reports per pipeline: a funnel snapshot, meetings this month against the target
//      (goals.md block 2) and the 3 critical conversions (goals.md 2.3).
//      Agendada, Reunião Realizada->Negociação.
//
// It measures BOTH pipelines side by side during a migration between them.
//
// Usage:
//   node kpi.mjs                          → weekly reply rate (default)
//   node kpi.mjs reply                    → the same
//   node kpi.mjs mark-reply <leadId> [date]  → records a late reply in the panel log
//   node kpi.mjs funnel [YYYY-MM]         → the CRM conversion funnel (this month, or the one given)
//
// The aggregation logic is pure and testable (kpi.test.mjs, zero network). Only the CLI touches the API.

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadConfig as loadRogerConfig } from './lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const LOGDIR = join(HERE, 'logs');
const EVENTS_FILE = join(LOGDIR, 'painel-events.jsonl');
const CONFIG_FILE = join(ROOT, 'config.js');

// ── pipelines + stages: THE IDS ARE FROM YOUR OWN ACCOUNT ─────────────────────
// Every CRM account has its own. Fill these in before using the funnel mode; the reply
// rate (the default mode) does not depend on them, because it reads the panel log.
//
// How to find yours:
//   node -e "import('./kommo-config.mjs').then(k=>k.kget('/leads/pipelines').then(r=>console.log(JSON.stringify(r,null,1))))"
export const PIPELINES = {
  main: {
    id: null,
    label: 'Seu pipeline',
    // display order = funnel order
    stages: {
      entrada: null, prospeccao: null, desenvolvimento: null, qualificado: null,
      reuniaoAgendada: null, reuniaoRealizada: null, negociacao: null,
      fechamento: null, won: 142, lost: 143, // 142/143 são padrão do Kommo
    },
  },
};

// Who owns the leads this report counts. It comes from .env, not from here.
export const OWNER_USER_ID = loadRogerConfig().kommo.ownerId;
export const MEETING_GOAL_PER_MONTH = 10; // sua meta de reuniões por mês

// ── pure functions (testable, no network) ──

// Snapshot: counts the leads of a pipeline per stage. A status outside the map lands in _other.
export function funnelSnapshot(leads, pipeline) {
  const byId = {};
  for (const [k, v] of Object.entries(pipeline.stages)) byId[v] = k;
  const counts = {};
  for (const k of Object.keys(pipeline.stages)) counts[k] = 0;
  let _other = 0;
  for (const l of leads || []) {
    if (!l || l.pipeline_id !== pipeline.id) continue;
    const key = byId[l.status_id];
    if (key) counts[key] += 1; else _other += 1;
  }
  return { ...counts, _other };
}

// Counts ENTRIES into each stage (value_after) from the lead_status_changed events.
// Filters by pipeline and, if leadIdSet is given, only events for leads in that set.
export function countEntries(events, pipeline, leadIdSet) {
  const byId = {};
  for (const [k, v] of Object.entries(pipeline.stages)) byId[v] = k;
  const counts = {};
  for (const k of Object.keys(pipeline.stages)) counts[k] = 0;
  for (const e of events || []) {
    if (!e || e.type !== 'lead_status_changed') continue;
    if (leadIdSet && !leadIdSet.has(e.entity_id)) continue;
    const after = e.value_after && e.value_after[0] && e.value_after[0].lead_status;
    if (!after || after.pipeline_id !== pipeline.id) continue;
    const key = byId[after.id];
    if (key) counts[key] += 1;
  }
  return counts;
}

// Meetings = entries into the "meeting scheduled" stage within the period.
export function meetingsCount(entries) {
  return (entries && entries.reuniaoAgendada) || 0;
}

// The 3 critical conversions (goals.md 2.3) as a flow rate over the period. den=0 -> rate null.
export function criticalConversions(entries) {
  const e = entries || {};
  const rate = (num, den) => (den > 0 ? num / den : null);
  return {
    devToQualificado: { from: e.desenvolvimento || 0, to: e.qualificado || 0, rate: rate(e.qualificado || 0, e.desenvolvimento || 0) },
    qualificadoToReuniao: { from: e.qualificado || 0, to: e.reuniaoAgendada || 0, rate: rate(e.reuniaoAgendada || 0, e.qualificado || 0) },
    reuniaoToNegociacao: { from: e.reuniaoRealizada || 0, to: e.negociacao || 0, rate: rate(e.negociacao || 0, e.reuniaoRealizada || 0) },
  };
}

// The unix range [from,to) of the month YYYY-MM in BRT (UTC-3). A default monthStr needs `now`.
export function monthRange(monthStr) {
  const [y, m] = monthStr.split('-').map((x) => parseInt(x, 10));
  // 00:00 BRT on the 1st = 03:00 UTC; the following month likewise
  const from = Math.floor(Date.UTC(y, m - 1, 1, 3, 0, 0) / 1000);
  const to = Math.floor(Date.UTC(y, m, 1, 3, 0, 0) / 1000);
  return { from, to, label: monthStr };
}

// ── API layer (isolated, never throws, GET only) ──

// It keeps the old name and signature (someone may call it with a test file), but the
// reading is the single loader one: process.env > .env > legacy config.js.
export function loadConfig(file = CONFIG_FILE) {
  const cfg = loadRogerConfig(file === CONFIG_FILE ? {} : { legacyFile: file, envFile: null });
  return { token: cfg.kommo.token, subdomain: cfg.kommo.subdomain };
}

async function kommoGet(base, token, path) {
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Kommo GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchAllLeads(base, token, responsibleUserId) {
  const out = [];
  for (let page = 1; page <= 100; page += 1) {
    const d = await kommoGet(base, token, `/api/v4/leads?filter[responsible_user_id]=${responsibleUserId}&limit=250&page=${page}`);
    const leads = d && d._embedded && d._embedded.leads;
    if (!leads || !leads.length) break;
    out.push(...leads);
    if (!(d._links && d._links.next)) break;
  }
  return out;
}

async function fetchStatusEvents(base, token, from, to) {
  const out = [];
  for (let page = 1; page <= 200; page += 1) {
    const d = await kommoGet(base, token, `/api/v4/events?filter[type]=lead_status_changed&filter[created_at][from]=${from}&filter[created_at][to]=${to - 1}&limit=100&page=${page}`);
    const evs = d && d._embedded && d._embedded.events;
    if (!evs || !evs.length) break;
    out.push(...evs);
    if (!(d._links && d._links.next)) break;
  }
  return out;
}

// ── render ──
function pct(rate) { return rate == null ? '–' : `${(rate * 100).toFixed(0)}%`; }

function reportFunnel(leads, events, monthStr) {
  const leadIdSet = new Set(leads.map((l) => l.id));
  const { from, to, label } = monthRange(monthStr);
  const evInMonth = events.filter((e) => e.created_at >= from && e.created_at < to);

  console.log(`\nKPI roger — funil de conversão · mês ${label}`);
  console.log(`Leads do dono (responsible ${OWNER_USER_ID}): ${leads.length} | eventos de status no mês: ${evInMonth.length}\n`);

  let totalMeetings = 0;
  for (const key of ['main', 'testes']) {
    const p = PIPELINES[key];
    const snap = funnelSnapshot(leads, p);
    const entries = countEntries(evInMonth, p, leadIdSet);
    const conv = criticalConversions(entries);
    const meetings = meetingsCount(entries);
    totalMeetings += meetings;

    console.log(`── ${p.label} (${p.id}) ──`);
    const order = Object.keys(p.stages);
    console.log('  snapshot: ' + order.map((k) => `${k} ${snap[k]}`).join(' · ') + (snap._other ? ` · _other ${snap._other}` : ''));
    console.log(`  reuniões agendadas no mês: ${meetings}`);
    console.log('  conversões críticas no mês:');
    console.log(`    Desenvolvimento->Qualificado:      ${conv.devToQualificado.to}/${conv.devToQualificado.from} = ${pct(conv.devToQualificado.rate)}`);
    console.log(`    Qualificado->Reunião Agendada:     ${conv.qualificadoToReuniao.to}/${conv.qualificadoToReuniao.from} = ${pct(conv.qualificadoToReuniao.rate)}`);
    console.log(`    Reunião Realizada->Negociação:     ${conv.reuniaoToNegociacao.to}/${conv.reuniaoToNegociacao.from} = ${pct(conv.reuniaoToNegociacao.rate)}\n`);
  }

  const hit = totalMeetings >= MEETING_GOAL_PER_MONTH;
  console.log(`META: ${totalMeetings}/${MEETING_GOAL_PER_MONTH} reuniões agendadas no mês (MAIN+Testes) ${hit ? '✅' : '⚠️ abaixo'}`);
  console.log('Obs: conversões = taxa de fluxo no mês (entradas em Y / entradas em X), não coorte estrita.\n');
}

function reportReplyRate() {
  if (!existsSync(EVENTS_FILE)) {
    console.log('Nenhum evento de painel ainda — roda um batch no painel primeiro.');
    return;
  }
  const events = readFileSync(EVENTS_FILE, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).filter((e) => !e.dry);

  const isoWeek = (ts) => {
    const d = new Date(ts);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };

  const weeks = {};
  for (const e of events) {
    const w = isoWeek(e.ts);
    weeks[w] ||= { sent: 0, replied: 0, lateReplies: 0, skipped: 0 };
    if (e.action === 'sent') weeks[w].sent += 1;
    else if (e.action === 'replied') weeks[w].replied += 1;
    else if (e.action === 'late-reply') weeks[w].lateReplies += 1;
    else if (e.action === 'skipped') weeks[w].skipped += 1;
  }

  console.log('\nKPI roger — reply-rate por semana ISO\n');
  console.log('semana     | enviadas | respostas | puladas | reply rate');
  console.log('-----------|---------:|----------:|--------:|----------:');
  let totSent = 0; let totRep = 0;
  for (const [w, s] of Object.entries(weeks).sort()) {
    const replies = s.replied + s.lateReplies;
    totSent += s.sent; totRep += replies;
    const rate = s.sent ? `${(replies / s.sent * 100).toFixed(1)}%` : '–';
    console.log(`${w} | ${String(s.sent).padStart(8)} | ${String(replies).padStart(9)} | ${String(s.skipped).padStart(7)} | ${rate.padStart(9)}`);
  }
  const totRate = totSent ? (totRep / totSent * 100).toFixed(1) : '0';
  console.log(`\nTOTAL: ${totSent} enviadas · ${totRep} respostas · reply rate ${totRate}%`);
  console.log('Régua: LinkedIn 10.4% · tech 4.8-8.8% · meta roger >12-15%\n');
}

// ── CLI ──
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [cmd, arg1, arg2] = process.argv.slice(2);

  if (cmd === 'mark-reply') {
    if (!arg1) { console.error('uso: node kpi.mjs mark-reply <leadId> [YYYY-MM-DD]'); process.exit(1); }
    const ts = arg2 ? new Date(`${arg2}T12:00:00-03:00`).toISOString() : new Date().toISOString();
    appendFileSync(EVENTS_FILE, `${JSON.stringify({ ts, action: 'late-reply', leadId: parseInt(arg1, 10) })}\n`);
    console.log(`✓ resposta tardia registrada pro lead ${arg1}`);
  } else if (cmd === 'funnel') {
    const { token, subdomain } = loadConfig();
    if (!token || !subdomain) { console.error('config.js sem KOMMO_TOKEN/KOMMO_SUBDOMAIN'); process.exit(1); }
    const base = `https://${subdomain}.kommo.com`;
    // the current month in BRT when none is given
    const now = new Date();
    const brt = new Date(now.getTime() - 3 * 3600_000);
    const monthStr = arg1 || `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`;
    const { from, to } = monthRange(monthStr);
    try {
      const [leads, events] = await Promise.all([
        fetchAllLeads(base, token, OWNER_USER_ID),
        fetchStatusEvents(base, token, from, to),
      ]);
      reportFunnel(leads, events, monthStr);
    } catch (e) {
      console.error('Erro lendo Kommo:', e.message);
      process.exit(1);
    }
  } else {
    reportReplyRate();
  }
}
