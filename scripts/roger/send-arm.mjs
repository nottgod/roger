#!/usr/bin/env node
// send-arm.mjs — the sending arm: it takes the APPROVED queue and sends, with the guards.
//
// The order of the steps is not aesthetic, it is what prevents damage:
//
//   1. the daily cap first, BEFORE opening a browser — a blown cap should not spend even
//      one request, and a burned account cannot be replaced;
//   2. reconcile the journal and REMOVE from the queue anyone with a declared send that
//      was never confirmed (it may have gone out);
//   3. a pass with no browser, resolving whatever can be resolved without it (a browser
//      open and idle reads as stuck to whoever is watching);
//   4. only then open it, and check the session before the first send;
//   5. per lead: look at the screen → GATES → declare the intent → type → confirm
//      → close the intent → pause.
//
// The deciding is lib/send-gates.mjs (pure). The driving is lib/linkedin-page.mjs (thin).
// This file is the orchestration, and it is testable: `deps` come in as a parameter, so
// the suite runs the whole flow against a fake browser.
//
// usage:
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

// fileURLToPath, not URL.pathname: pathname is percent-encoded and breaks on a path with a space.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ── the run ───────────────────────────────────────────────────────────────────
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
    out.stopped = 'no identity: I refuse to send without knowing which account speaks';
    return out;
  }

  // 1. the cap, before anything else
  if (journal.capReached(identity, cap)) {
    out.stopped = `daily cap reached for ${identity} (${journal.countToday(identity)}/${cap})`;
    return out;
  }

  // 2. journal pendings leave the queue
  const pending = journal.pending().filter((p) => !identity || p.identity === identity);
  const blocked = new Set(pending.map((p) => String(p.leadId)));
  if (blocked.size) {
    for (const p of pending) {
      log(`⚠ lead ${p.leadId} has a declared, unconfirmed send (${p.id}) — out of the queue until someone checks`);
      out.pendingSkipped.push(p.leadId);
    }
  }

  // 3. the pass with no browser
  const fila = leads.filter((l) => {
    if (blocked.has(String(l.leadId))) return false;
    if (!String(l.msg || '').trim()) { out.refused.push({ n: l.n, code: 'empty', reason: 'no text' }); return false; }
    return true;
  });
  log(`fila: ${fila.length} de ${leads.length} leads · identidade ${identity} · teto ${journal.countToday(identity)}/${cap}${dry ? ' · ENSAIO' : ''}`);
  if (!fila.length) { out.stopped = 'nada a enviar'; return out; }

  // 4. open it and check the session
  const browser = await open({ identity, baseDir: join(ROOT, '.roger') });
  out.opened = true;
  const breaker = createBreaker(3);
  try {
    if (await loggedOut(browser.page)) {
      out.stopped = `the session for ${identity} expired — open the browser and log in by hand before running again`;
      return out;
    }

    // 5. lead by lead
    for (const lead of fila) {
      if (journal.capReached(identity, cap)) { out.stopped = 'cap reached mid-run'; break; }

      let snap;
      try {
        if (lead.composeUrl || lead.url) {
          await browser.page.goto(lead.composeUrl || lead.url, { waitUntil: 'domcontentloaded' });
        }
        snap = await snapshot(browser.page);
      } catch (e) {
        out.refused.push({ n: lead.n, code: 'page-error', reason: e.message });
        if (breaker.fail()) { out.stopped = 'three failures in a row — stopping before burning the queue'; break; }
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
        // A platform signal ends the whole run. Nobody tries to work around that.
        if (verdict.code === 'blocked') { out.stopped = verdict.reason; break; }
        breaker.ok();
        continue;
      }

      if (dry) {
        log(`  #${lead.n} ${lead.co || ''}: would pass every gate (rehearsal, nothing sent)`);
        out.refused.push({ n: lead.n, code: 'dry', reason: 'ensaio' });
        continue;
      }

      // the mark BEFORE the irreversible act
      const id = journal.declare({ identity, leadId: lead.leadId, step: lead.stage, text: lead.msg, meta: { n: lead.n, co: lead.co } });

      let result;
      try {
        result = await typeAndSend(browser.page, lead.msg, { rand });
      } catch (e) {
        journal.close(id, UNCERTAIN, { why: `exception while sending: ${e.message}` });
        out.refused.push({ n: lead.n, code: 'send-error', reason: e.message });
        if (breaker.fail()) { out.stopped = 'three failures in a row — stopping'; break; }
        continue;
      }

      if (result.phase === 'pre-click') {
        // Nothing went out, for certain: the intent can be closed without doubt.
        journal.close(id, 'resolved', { why: result.why || 'nada saiu' });
        out.refused.push({ n: lead.n, code: 'not-sent', reason: result.why || 'nada saiu' });
        if (breaker.fail()) { out.stopped = 'three failures in a row — stopping'; break; }
        continue;
      }

      if (result.confirmed) {
        journal.close(id, 'registered', { confirmed: true });
        out.sent += 1;
        breaker.ok();
        log(`  #${lead.n} ${lead.co || ''}: enviada e confirmada`);
      } else {
        // Clicked and unconfirmed: the doubt STAYS pending for the next run.
        journal.close(id, UNCERTAIN, { why: result.why || 'no confirmation' });
        out.sent += 1; // pode ter saído: conta para o teto
        log(`  #${lead.n} ${lead.co || ''}: clicked and did not confirm — left pending`);
      }

      await sleep(pauseMs(rand, opts.pause || DEFAULT_PAUSE));
    }
  } finally {
    if (browser?.context?.close) await browser.context.close().catch(() => {});
  }

  return out;
}

// ── the queue: a local file, or the panel's /approved ─────────────────────────
export async function loadQueue(source, fetchImpl = globalThis.fetch) {
  if (!source) throw new Error('pass --queue <file.json | http://127.0.0.1:4242/approved>');
  if (/^https?:\/\//.test(source)) {
    const res = await fetchImpl(source);
    if (!res.ok) throw new Error(`queue HTTP ${res.status}`);
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
