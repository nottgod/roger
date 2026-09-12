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
test('nada é enviável antes de um humano aprovar', () => {
  const state = createState(BATCH);
  assert.deepEqual(sendable(BATCH, state), []);
});

test('marcar como enviada sem aprovação é RECUSADO', () => {
  const state = createState(BATCH);
  const r = act(state, 1, 'sent');
  assert.match(r.error, /não foi aprovada/);
  assert.equal(entryFor(r.state, 1).status, 'pending', 'o estado não muda');
});

test('aprovar libera só aquele lead, e o texto vai resolvido', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  const fila = sendable(BATCH, state);
  assert.equal(fila.length, 1);
  assert.equal(fila[0].n, 1);
  assert.equal(fila[0].msg, 'saw the audit. how are the reruns going?');
});

test('o texto editado é o que vai, não o gerado', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve', { text: 'minha versão, melhor' }));
  assert.equal(sendable(BATCH, state)[0].msg, 'minha versão, melhor');
});

test('editar depois de aprovar REABRE a aprovação', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  assert.equal(entryFor(state, 1).status, 'approved');
  ({ state } = act(state, 1, 'edit', { text: 'mudei de ideia' }));
  assert.equal(entryFor(state, 1).status, 'pending', 'o que o humano leu mudou, então tem que ler de novo');
  assert.deepEqual(sendable(BATCH, state), [], 'e nada é enviável nesse meio-tempo');
});

test('não se aprova mensagem vazia', () => {
  const state = createState(BATCH);
  const r = applyAction(state, { n: 9, msg: '' }, 'approve');
  assert.match(r.error, /sem texto/);
});

test('rejeitar tira da fila de envio', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'reject', { reason: 'gancho fraco' }));
  assert.deepEqual(sendable(BATCH, state), []);
  assert.equal(entryFor(state, 1).reason, 'gancho fraco');
});

// ─── ciclo completo e estados terminais ──────────────────────────────────────
test('o caminho feliz: pendente, aprovada, enviada', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  assert.equal(entryFor(state, 1).status, 'sent');
  assert.deepEqual(sendable(BATCH, state), [], 'enviada sai da fila');
});

test('mensagem enviada não aceita mais mudança', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  for (const acao of ['approve', 'edit', 'reject', 'skip', 'replied']) {
    const r = act(state, 1, acao, { text: 'x' });
    assert.match(r.error, /já foi enviada/, `${acao} deveria ser recusada`);
  }
});

test('desfazer envio exige force, e diz que não desfaz o envio de verdade', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  ({ state } = act(state, 1, 'sent'));
  const semForce = act(state, 1, 'undo');
  assert.match(semForce.error, /não desfaz o envio/);
  const comForce = act(state, 1, 'undo', { force: true });
  assert.equal(comForce.error, null);
  assert.equal(entryFor(comForce.state, 1).status, 'pending');
});

test('lead que respondeu não entra na fila de envio', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 2, 'replied'));
  assert.deepEqual(sendable(BATCH, state), []);
});

test('ação desconhecida não muda nada', () => {
  const state = createState(BATCH);
  const r = act(state, 1, 'apagar-tudo');
  assert.match(r.error, /ação desconhecida/);
  assert.deepEqual(r.state, state);
});

test('cada transição fica no histórico, com hora', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve', { now: new Date('2026-09-12T10:00:00Z') }));
  ({ state } = act(state, 1, 'sent', { now: new Date('2026-09-12T10:01:00Z') }));
  const h = entryFor(state, 1).history;
  assert.equal(h.length, 2);
  assert.deepEqual(h.map((x) => `${x.from}->${x.to}`), ['pending->approved', 'approved->sent']);
  assert.equal(h[0].at, '2026-09-12T10:00:00.000Z');
});

test('contadores somam o total', () => {
  let { state } = { state: createState(BATCH) };
  ({ state } = act(state, 1, 'approve'));
  const c = counters(BATCH, state);
  assert.equal(c.total, 2);
  assert.equal(c.approved, 1);
  assert.equal(c.pending, 1);
  assert.equal(c.sent, 0);
});

// ─── finalText ────────────────────────────────────────────────────────────────
test('finalText prefere o editado, mas ignora edição vazia', () => {
  assert.equal(finalText({ msg: 'gerado' }, { text: 'editado' }), 'editado');
  assert.equal(finalText({ msg: 'gerado' }, { text: '   ' }), 'gerado');
  assert.equal(finalText({ msg: 'gerado' }, {}), 'gerado');
  assert.equal(finalText({}, {}), '');
});

// ─── guarda de dono ───────────────────────────────────────────────────────────
test('sem dono declarado, recuso operar no CRM', () => {
  const r = assertOwned({ responsible_user_id: 1 }, null);
  assert.equal(r.ok, false);
  assert.match(r.error, /sem dono declarado/);
});

test('entidade de outro usuário é recusada', () => {
  const r = assertOwned({ responsible_user_id: 999 }, 123, 'task 7');
  assert.equal(r.ok, false);
  assert.match(r.error, /pertence a outro usuário \(999\)/);
});

test('entidade do dono passa, e entidade ausente falha', () => {
  assert.equal(assertOwned({ responsible_user_id: 123 }, 123).ok, true);
  assert.match(assertOwned(null, 123, 'lead 5').error, /lead 5 não encontrada/);
});

// ─── fim de sequência ─────────────────────────────────────────────────────────
test('nextStepFor respeita o fim da cadência', () => {
  const cad = { FUP_5: { next: 'FUP_MAIS', days: 6 }, FUP_MAIS: { next: null, days: null } };
  assert.deepEqual(nextStepFor('FUP_5', cad), { next: 'FUP_MAIS', days: 6 });
  assert.equal(nextStepFor('FUP_MAIS', cad), null, 'último toque não cria próximo');
  assert.equal(nextStepFor('INEXISTENTE', cad), null);
  assert.equal(nextStepFor('FUP_5', null), null);
});

// ─── escape ───────────────────────────────────────────────────────────────────
test('escapeHtml cobre os cinco caracteres, não só o menor-que', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\'</script>'),
    '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  assert.equal(escapeHtml(null), '');
});
