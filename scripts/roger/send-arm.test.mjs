// Testes do braço de envio — a orquestração inteira, com um navegador FALSO.
//
// É isto que permite provar o fluxo perigoso (teto, journal, recusas, pausa,
// disjuntor, confirmação) sem abrir navegador e sem tocar em conta de LinkedIn.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSendArm, loadQueue, DEFAULT_CAP } from './send-arm.mjs';
import { createJournal, UNCERTAIN } from './lib/journal.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'roger-arm-'));
const journalIn = (d, iso = '2026-09-12T10:00:00Z') => createJournal({ dir: d, clock: () => new Date(iso) });

const QUEUE = {
  date: '2026-09-12',
  leads: [
    { n: 1, co: 'NorthPay', who: 'Ana Ribeiro', leadId: 101, stage: 'FUP_2', msg: 'saw the audit. how are the reruns?' },
    { n: 2, co: 'Truleaf', who: 'Sam Okafor', leadId: 102, stage: 'FUP_1', msg: 'your docs read like a team that ships.' },
  ],
};

// Navegador falso: devolve o retrato que o teste quiser e registra o que foi digitado.
function fakeBrowser(snapshots, sendResults = {}) {
  const typed = [];
  let i = 0;
  return {
    typed,
    deps: {
      openBrowser: async () => ({ page: {}, context: { close: async () => {} } }),
      sessionLooksLoggedOut: async () => false,
      snapshot: async () => (Array.isArray(snapshots) ? snapshots[i++] : snapshots),
      typeAndSend: async (_page, text) => {
        typed.push(text);
        return sendResults[typed.length] || { phase: 'post-click', confirmed: true };
      },
      sleep: async () => {},
      rand: () => 0.5,
      log: () => {},
    },
  };
}

const good = { url: 'https://linkedin.com/messaging/thread/1', bannerText: '', hasMessageChannel: true, isInMailComposer: false, recipientName: 'Ana Ribeiro', bubbles: [] };
const bomPara = (nome) => ({ ...good, recipientName: nome });

test('with no identity it does not run, and does not open a browser', async () => {
  const b = fakeBrowser(good);
  const r = await runSendArm(QUEUE, { journal: journalIn(dir()), deps: b.deps });
  assert.match(r.stopped, /no identity/);
  assert.equal(r.opened, false);
});

test('the daily cap prevents OPENING the browser', async () => {
  const d = dir();
  const j = journalIn(d);
  for (let i = 0; i < 3; i += 1) j.declare({ identity: 'sam', leadId: i, step: 'FUP_1', text: 'x' });
  const b = fakeBrowser(good);
  const r = await runSendArm(QUEUE, { identity: 'sam', cap: 3, journal: j, deps: b.deps });
  assert.match(r.stopped, /daily cap reached/);
  assert.equal(r.opened, false, 'teto estourado não gasta nem um request');
  assert.deepEqual(b.typed, []);
});

test('the happy path sends, confirms and closes the intent', async () => {
  const d = dir();
  const j = journalIn(d);
  const b = fakeBrowser([bomPara('Ana Ribeiro'), bomPara('Sam Okafor')]);
  const r = await runSendArm(QUEUE, { identity: 'sam', journal: j, deps: b.deps });
  assert.equal(r.sent, 2);
  assert.deepEqual(b.typed, [QUEUE.leads[0].msg, QUEUE.leads[1].msg]);
  assert.deepEqual(j.pending(), [], 'nada pendente quando tudo confirmou');
  assert.equal(j.countToday('sam'), 2);
});

test('the intent is declared BEFORE typing', async () => {
  const d = dir();
  const j = journalIn(d);
  const ordem = [];
  const deps = {
    openBrowser: async () => ({ page: {}, context: { close: async () => {} } }),
    sessionLooksLoggedOut: async () => false,
    snapshot: async () => good,
    typeAndSend: async () => { ordem.push('digitou'); return { phase: 'post-click', confirmed: true }; },
    sleep: async () => {}, rand: () => 0.5, log: () => {},
  };
  const espiao = { ...j, declare: (x) => { ordem.push('declarou'); return j.declare(x); } };
  await runSendArm({ leads: [QUEUE.leads[0]] }, { identity: 'sam', journal: espiao, deps });
  assert.deepEqual(ordem, ['declarou', 'digitou']);
});

test('clicked and unconfirmed: it stays PENDING and counts towards the cap', async () => {
  const d = dir();
  const j = journalIn(d);
  const b = fakeBrowser(good, { 1: { phase: 'post-click', confirmed: false, why: 'bolha não apareceu' } });
  const r = await runSendArm({ leads: [QUEUE.leads[0]] }, { identity: 'sam', journal: j, deps: b.deps });
  assert.equal(r.sent, 1, 'pode ter saído: conta');
  assert.equal(j.pending().length, 1, 'a dúvida sobrevive à rodada');
});

test('pre-click closes the intent with no doubt: nothing went out', async () => {
  const d = dir();
  const j = journalIn(d);
  const b = fakeBrowser(good, { 1: { phase: 'pre-click', confirmed: false, why: 'botão de envio indisponível' } });
  const r = await runSendArm({ leads: [QUEUE.leads[0]] }, { identity: 'sam', journal: j, deps: b.deps });
  assert.equal(r.sent, 0);
  assert.deepEqual(j.pending(), []);
  assert.equal(r.refused[0].code, 'not-sent');
});

test('a lead with an earlier pending intent leaves the queue', async () => {
  const d = dir();
  const j = journalIn(d);
  j.declare({ identity: 'sam', leadId: 101, step: 'FUP_2', text: 'toque anterior' });
  const b = fakeBrowser(bomPara('Sam Okafor'));
  const r = await runSendArm(QUEUE, { identity: 'sam', journal: j, deps: b.deps });
  assert.deepEqual(r.pendingSkipped, [101]);
  assert.equal(b.typed.length, 1, 'só o lead 102 é tocado');
});

test('the wrong recipient receives nothing', async () => {
  const d = dir();
  const b = fakeBrowser(bomPara('Outra Pessoa'));
  const r = await runSendArm({ leads: [QUEUE.leads[0]] }, { identity: 'sam', journal: journalIn(d), deps: b.deps });
  assert.equal(r.sent, 0);
  assert.equal(r.refused[0].code, 'recipient-mismatch');
  assert.deepEqual(b.typed, [], 'não digitou uma letra');
});

test('a block signal ends the whole run, without trying the next one', async () => {
  const d = dir();
  const b = fakeBrowser({ ...good, url: 'https://www.linkedin.com/checkpoint/challenge' });
  const r = await runSendArm(QUEUE, { identity: 'sam', journal: journalIn(d), deps: b.deps });
  assert.match(r.stopped, /block/);
  assert.equal(b.typed.length, 0);
  assert.equal(r.refused.length, 1, 'parou no primeiro, não varreu a fila');
});

test('a rehearsal types nothing, but says who would pass', async () => {
  const d = dir();
  const j = journalIn(d);
  const b = fakeBrowser(good);
  const r = await runSendArm({ leads: [QUEUE.leads[0]] }, { identity: 'sam', dry: true, journal: j, deps: b.deps });
  assert.equal(r.sent, 0);
  assert.deepEqual(b.typed, []);
  assert.equal(r.refused[0].code, 'dry');
  assert.deepEqual(j.pending(), [], 'ensaio não declara intenção');
});

test('an expired session stops with an instruction, without sending', async () => {
  const d = dir();
  const deps = { ...fakeBrowser(good).deps, sessionLooksLoggedOut: async () => true };
  const r = await runSendArm(QUEUE, { identity: 'sam', journal: journalIn(d), deps });
  assert.match(r.stopped, /session for sam expired/);
  assert.equal(r.sent, 0);
});

test('three page failures in a row end the run', async () => {
  const d = dir();
  const leads = [1, 2, 3, 4].map((n) => ({ n, co: `C${n}`, who: 'Ana Ribeiro', leadId: 100 + n, stage: 'FUP_1', msg: 'oi' }));
  const deps = {
    openBrowser: async () => ({ page: { goto: async () => {} }, context: { close: async () => {} } }),
    sessionLooksLoggedOut: async () => false,
    snapshot: async () => { throw new Error('DOM mudou'); },
    typeAndSend: async () => ({ phase: 'post-click', confirmed: true }),
    sleep: async () => {}, rand: () => 0.5, log: () => {},
  };
  const r = await runSendArm({ leads }, { identity: 'sam', journal: journalIn(d), deps });
  assert.match(r.stopped, /three failures in a row/);
  assert.equal(r.refused.length, 3, 'não gastou a fila inteira produzindo o mesmo erro');
});

test('a lead with no text is refused before any navigation', async () => {
  const d = dir();
  const b = fakeBrowser(good);
  const r = await runSendArm({ leads: [{ n: 9, leadId: 9, msg: '   ' }] }, { identity: 'sam', journal: journalIn(d), deps: b.deps });
  assert.equal(r.refused[0].code, 'empty');
  assert.equal(r.opened, false);
  assert.equal(r.stopped, 'nada a enviar');
});

test('a cap reached mid-run stops immediately', async () => {
  const d = dir();
  const j = journalIn(d);
  const leads = [1, 2, 3].map((n) => ({ n, co: `C${n}`, who: 'Ana Ribeiro', leadId: 100 + n, stage: 'FUP_1', msg: 'oi ' + n }));
  const b = fakeBrowser(good);
  const r = await runSendArm({ leads }, { identity: 'sam', cap: 2, journal: j, deps: b.deps });
  assert.equal(r.sent, 2);
  assert.match(r.stopped, /cap reached mid-run/);
});

// ── fila ──────────────────────────────────────────────────────────────────────
test('the queue can come from the panel /approved', async () => {
  const fetchFalso = async () => ({ ok: true, status: 200, json: async () => QUEUE });
  const q = await loadQueue('http://127.0.0.1:4242/approved', fetchFalso);
  assert.equal(q.leads.length, 2);
});

test('an HTTP queue error is explained', async () => {
  const fetchFalso = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(() => loadQueue('http://127.0.0.1:4242/approved', fetchFalso), /queue HTTP 503/);
});

test('with no --queue, an error that says what to do', async () => {
  await assert.rejects(() => loadQueue(null), /pass --queue/);
});

test('the default cap is conservative', () => {
  assert.ok(DEFAULT_CAP <= 50, `teto padrão ${DEFAULT_CAP} alto demais para conta de amigo`);
});
