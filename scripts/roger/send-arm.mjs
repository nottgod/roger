#!/usr/bin/env node
// send-arm.mjs — o braço de envio: pega a fila APROVADA e manda, com as travas.
//
// A ordem dos passos não é estética, é o que evita dano:
//
//   1. teto do dia primeiro, ANTES de abrir navegador — teto estourado não gasta
//      nem um request, e conta queimada não se repõe;
//   2. reconciliar o journal e TIRAR da fila quem tem envio declarado e não
//      confirmado (pode ter saído);
//   3. passada sem navegador, resolvendo o que dá para resolver sem ele (navegador
//      aberto e parado é lido como travado por quem está olhando);
//   4. só então abre, e confere a sessão antes do primeiro envio;
//   5. por lead: olhar a tela → PORTÕES → declarar a intenção → digitar → confirmar
//      → fechar a intenção → pausar.
//
// Quem decide é lib/send-gates.mjs (puro). Quem dirige é lib/linkedin-page.mjs (fino).
// Este arquivo é a orquestração, e é testável: os `deps` entram por parâmetro, então a
// suite roda o fluxo inteiro com um navegador falso.
//
// uso:
//   node send-arm.mjs --queue http://127.0.0.1:4242/approved --identity sam
//   node send-arm.mjs --queue fila.json --identity sam --dry
//   node send-arm.mjs --queue fila.json --identity sam --cap 40

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createJournal, UNCERTAIN } from './lib/journal.mjs';
import { decide, pauseMs, createBreaker } from './lib/send-gates.mjs';
import * as pageLayer from './lib/linkedin-page.mjs';

export const DEFAULT_CAP = 40;          // conservador de propósito; só se abaixa por flag
export const DEFAULT_PAUSE = { minMs: 30_000, maxMs: 120_000 };

// fileURLToPath, não URL.pathname: pathname vem percent-encoded e quebra em caminho com espaço.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── a rodada ──────────────────────────────────────────────────────────────────
export async function runSendArm(queue, opts = {}) {
  const identity = opts.identity;
  const cap = opts.cap ?? DEFAULT_CAP;
  const dry = !!opts.dry;
  const journal = opts.journal || createJournal({ dir: join(ROOT, '.roger', 'journal') });
  const deps = opts.deps || {};
  const open = deps.openBrowser || pageLayer.openBrowser;
  const snapshot = deps.snapshot || pageLayer.snapshot;
  const typeAndSend = deps.typeAndSend || pageLayer.typeAndSend;
  const loggedOut = deps.sessionLooksLoggedOut || pageLayer.sessionLooksLoggedOut;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const rand = deps.rand || Math.random;
  const log = deps.log || ((s) => process.stdout.write(s + '\n'));

  const out = { sent: 0, refused: [], stopped: null, opened: false, pendingSkipped: [] };
  const leads = [...(queue?.leads || [])];

  if (!identity) {
    out.stopped = 'sem identidade: recuso enviar sem saber qual conta vai falar';
    return out;
  }

  // 1. teto antes de tudo
  if (journal.capReached(identity, cap)) {
    out.stopped = `teto do dia atingido para ${identity} (${journal.countToday(identity)}/${cap})`;
    return out;
  }

  // 2. pendências do journal saem da fila
  const pending = journal.pending().filter((p) => !identity || p.identity === identity);
  const blocked = new Set(pending.map((p) => String(p.leadId)));
  if (blocked.size) {
    for (const p of pending) {
      log(`⚠ lead ${p.leadId} tem envio declarado e não confirmado (${p.id}) — fora da fila até alguém conferir`);
      out.pendingSkipped.push(p.leadId);
    }
  }

  // 3. passada sem navegador
  const fila = leads.filter((l) => {
    if (blocked.has(String(l.leadId))) return false;
    if (!String(l.msg || '').trim()) { out.refused.push({ n: l.n, code: 'empty', reason: 'sem texto' }); return false; }
    return true;
  });
  log(`fila: ${fila.length} de ${leads.length} leads · identidade ${identity} · teto ${journal.countToday(identity)}/${cap}${dry ? ' · ENSAIO' : ''}`);
  if (!fila.length) { out.stopped = 'nada a enviar'; return out; }

  // 4. abre e confere a sessão
  const browser = await open({ identity, baseDir: join(ROOT, '.roger') });
  out.opened = true;
  const breaker = createBreaker(3);
  try {
    if (await loggedOut(browser.page)) {
      out.stopped = `a sessão de ${identity} expirou — abra o navegador e entre à mão antes de rodar de novo`;
      return out;
    }

    // 5. lead a lead
    for (const lead of fila) {
      if (journal.capReached(identity, cap)) { out.stopped = 'teto atingido no meio da rodada'; break; }

      let snap;
      try {
        if (lead.composeUrl || lead.url) {
          await browser.page.goto(lead.composeUrl || lead.url, { waitUntil: 'domcontentloaded' });
        }
        snap = await snapshot(browser.page);
      } catch (e) {
        out.refused.push({ n: lead.n, code: 'page-error', reason: e.message });
        if (breaker.fail()) { out.stopped = 'três falhas seguidas — encerrando antes de gastar a fila'; break; }
        continue;
      }

      const verdict = decide(snap, { recipient: lead.who || lead.name, text: lead.msg, approved: true }, {
        capReached: false,
        alreadyTouchedToday: !!lead.touchedToday,
        outsideWindow: !!lead.outsideWindow,
      });

      if (!verdict.ok) {
        out.refused.push({ n: lead.n, code: verdict.code, reason: verdict.reason });
        log(`  #${lead.n} ${lead.co || ''}: ${verdict.code} — ${verdict.reason}`);
        // Sinal da plataforma encerra a rodada inteira. Ninguém tenta resolver isso.
        if (verdict.code === 'blocked') { out.stopped = verdict.reason; break; }
        breaker.ok();
        continue;
      }

      if (dry) {
        log(`  #${lead.n} ${lead.co || ''}: passaria em todos os portões (ensaio, nada enviado)`);
        out.refused.push({ n: lead.n, code: 'dry', reason: 'ensaio' });
        continue;
      }

      // a marca ANTES do ato irreversível
      const id = journal.declare({ identity, leadId: lead.leadId, step: lead.stage, text: lead.msg, meta: { n: lead.n, co: lead.co } });

      let result;
      try {
        result = await typeAndSend(browser.page, lead.msg, { rand });
      } catch (e) {
        journal.close(id, UNCERTAIN, { why: `exceção durante o envio: ${e.message}` });
        out.refused.push({ n: lead.n, code: 'send-error', reason: e.message });
        if (breaker.fail()) { out.stopped = 'três falhas seguidas — encerrando'; break; }
        continue;
      }

      if (result.phase === 'pre-click') {
        // Com certeza nada saiu: pode fechar a intenção sem dúvida.
        journal.close(id, 'resolved', { why: result.why || 'nada saiu' });
        out.refused.push({ n: lead.n, code: 'not-sent', reason: result.why || 'nada saiu' });
        if (breaker.fail()) { out.stopped = 'três falhas seguidas — encerrando'; break; }
        continue;
      }

      if (result.confirmed) {
        journal.close(id, 'registered', { confirmed: true });
        out.sent += 1;
        breaker.ok();
        log(`  #${lead.n} ${lead.co || ''}: enviada e confirmada`);
      } else {
        // Clicou e não confirmou: a dúvida FICA pendente para a rodada seguinte.
        journal.close(id, UNCERTAIN, { why: result.why || 'sem confirmação' });
        out.sent += 1; // pode ter saído: conta para o teto
        log(`  #${lead.n} ${lead.co || ''}: cliquei e não confirmei — fica pendente`);
      }

      await sleep(pauseMs(rand, opts.pause || DEFAULT_PAUSE));
    }
  } finally {
    if (browser?.context?.close) await browser.context.close().catch(() => {});
  }

  return out;
}

// ── fila: arquivo local ou o /approved do painel ──────────────────────────────
export async function loadQueue(source, fetchImpl = globalThis.fetch) {
  if (!source) throw new Error('informe --queue <arquivo.json | http://127.0.0.1:4242/approved>');
  if (/^https?:\/\//.test(source)) {
    const res = await fetchImpl(source);
    if (!res.ok) throw new Error(`fila HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(source, 'utf8'));
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const identity = flag('--identity', process.env.ROGER_IDENTITY);
  const capRaw = flag('--cap');
  const cap = capRaw ? Math.min(Number(capRaw), DEFAULT_CAP) : DEFAULT_CAP; // flag só ABAIXA

  const queue = await loadQueue(flag('--queue'));
  const r = await runSendArm(queue, { identity, cap, dry: args.includes('--dry') });

  process.stdout.write(`\nenviadas: ${r.sent} · recusadas: ${r.refused.length}${r.stopped ? ` · encerrou: ${r.stopped}` : ''}\n`);
  if (r.refused.length) {
    const porCodigo = {};
    for (const x of r.refused) porCodigo[x.code] = (porCodigo[x.code] || 0) + 1;
    process.stdout.write(`recusas por motivo: ${Object.entries(porCodigo).map(([k, v]) => `${k}=${v}`).join(' · ')}\n`);
  }
  process.exitCode = r.stopped && r.sent === 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
