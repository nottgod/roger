import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, applyAction, sendable, counters, finalText, entryFor,
  assertOwned, nextStepFor, escapeHtml,
} from './panel-core.mjs';

const BATCH = {
  date: '2026-09-12',
  leads: [
    { n: 1, co: 'NorthPay', msg: 'saw the audit. how are the reruns going?', stage: 'FUP_2', taskId: 11, leadId: 101 },
    { n: 2, co: 'Truleaf', msg: 'your docs read like a team that ships.', stage: 'MENSAGEM_INICIAL', taskId: 12, leadId: 102 },
  ],
};
const lead = (n) => BATCH.leads.find((l) => l.n === n);
const act = (state, n, action, opts) => applyAction(state, lead(n), action, opts);

// ─── A INVARIANTE DO REPO ────────────────────────────────────────────────────
test('nothing is sendable before a human approves', () => {
  const state = createState(BATCH);
  assert.deepEqual(sendable(BATCH, state), []);
});

test('marking as sent without approval is REFUSED', () => {
  const state = createState(BATCH);
  const r = act(state, 1, 'sent');
  assert.match(r.error, /não foi aprovada/);
  assert.equal(entryFor(r.state, 1).status, 'pending', 'o estado não muda');
});

test('approving releases only that lead, and the text goes resolved', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  const fila = sendable(BATCH, state);
  assert.equal(fila.length, 1);
  assert.equal(fila[0].n, 1);
  assert.equal(fila[0].msg, 'saw the audit. how are the reruns going?');
});

test('the edited text is what goes, not the generated one', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve', { text: 'minha versão, melhor' }));
  assert.equal(sendable(BATCH, state)[0].msg, 'minha versão, melhor');
});

test('editing after approving REOPENS the approval', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  assert.equal(entryFor(state, 1).status, 'approved');
  ({ state } = act(state, 1, 'edit', { text: 'mudei de ideia' }));
  assert.equal(entryFor(state, 1).status, 'pending', 'o que o humano leu mudou, então tem que ler de novo');
  assert.deepEqual(sendable(BATCH, state), [], 'e nada é enviável nesse meio-tempo');
});

test('an empty message cannot be approved', () => {
  const state = createState(BATCH);
  const r = applyAction(state, { n: 9, msg: '' }, 'approve');
  assert.match(r.error, /sem texto/);
});

test('rejecting removes it from the send queue', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'reject', { reason: 'gancho fraco' }));
  assert.deepEqual(sendable(BATCH, state), []);
  assert.equal(entryFor(state, 1).reason, 'gancho fraco');
});

// ─── ciclo completo e estados terminais ──────────────────────────────────────
test('the happy path: pending, approved, sent', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  assert.equal(entryFor(state, 1).status, 'sent');
  assert.deepEqual(sendable(BATCH, state), [], 'enviada sai da fila');
});

test('a sent message accepts no further change', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  for (const acao of ['approve', 'edit', 'reject', 'skip', 'replied']) {
    const r = act(state, 1, acao, { text: 'x' });
    assert.match(r.error, /já foi enviada/, `${acao} deveria ser recusada`);
  }
});

test('undoing a send requires force, and says it does not undo the real send', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  const semForce = act(state, 1, 'undo');
  assert.match(semForce.error, /não desfaz o envio/);
  const comForce = act(state, 1, 'undo', { force: true });
  assert.equal(comForce.error, null);
  assert.equal(entryFor(comForce.state, 1).status, 'pending');
});

test('a lead who replied does not enter the send queue', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 2, 'replied'));
  assert.deepEqual(sendable(BATCH, state), []);
});

test('an unknown action changes nothing', () => {
  const state = createState(BATCH);
  const r = act(state, 1, 'apagar-tudo');
  assert.match(r.error, /ação desconhecida/);
  assert.deepEqual(r.state, state);
});

test('every transition is kept in the history, with a timestamp', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve', { now: new Date('2026-09-12T10:00:00Z') }));
  ({ state } = act(state, 1, 'sent', { now: new Date('2026-09-12T10:01:00Z') }));
  const h = entryFor(state, 1).history;
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => `${x.from}->${x.to}`), ['pending->approved', 'approved->sent']);
  assert.equal(h[0].at, '2026-09-12T10:00:00.000Z');
});

test('the counters add up to the total', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  const c = counters(BATCH, state);
  assert.equal(c.total, 2);
  assert.equal(c.approved, 1);
  assert.equal(c.pending, 1);
  assert.equal(c.sent, 0);
});

// ─── finalText ────────────────────────────────────────────────────────────────
test('finalText prefers the edited one, but ignores an empty edit', () => {
  assert.equal(finalText({ msg: 'gerado' }, { text: 'editado' }), 'editado');
  assert.equal(finalText({ msg: 'gerado' }, { text: '   ' }), 'gerado');
  assert.equal(finalText({ msg: 'gerado' }, {}), 'gerado');
  assert.equal(finalText({}, {}), '');
});

// ─── guarda de dono ───────────────────────────────────────────────────────────
test('with no declared owner, it refuses to touch the CRM', () => {
  const r = assertOwned({ responsible_user_id: 1 }, null);
  assert.equal(r.ok, false);
  assert.match(r.error, /sem dono declarado/);
});

test('an entity owned by another user is refused', () => {
  const r = assertOwned({ responsible_user_id: 999 }, 123, 'task 7');
  assert.equal(r.ok, false);
  assert.match(r.error, /pertence a outro usuário \(999\)/);
});

test('an entity owned by you passes, and a missing one fails', () => {
  assert.equal(assertOwned({ responsible_user_id: 123 }, 123).ok, true);
  assert.match(assertOwned(null, 123, 'lead 5').error, /lead 5 não encontrada/);
});

// ─── end of sequence ──────────────────────────────────────────────────────────
test('nextStepFor respects the end of the cadence', () => {
  const cad = { FUP_5: { next: 'FUP_MAIS', days: 6 }, FUP_MAIS: { next: null, days: null } };
  assert.deepEqual(nextStepFor('FUP_5', cad), { next: 'FUP_MAIS', days: 6 });
  assert.equal(nextStepFor('FUP_MAIS', cad), null, 'último toque não cria próximo');
  assert.equal(nextStepFor('INEXISTENTE', cad), null);
  assert.equal(nextStepFor('FUP_5', null), null);
});

// ─── escape ───────────────────────────────────────────────────────────────────
test('escapeHtml covers all five characters, not just the less-than', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\'</script>'),
    '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
});
