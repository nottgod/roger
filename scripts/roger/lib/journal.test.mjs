import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJournal, dayKey, DECLARED, UNCERTAIN } from './journal.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'roger-journal-'));
const at = (iso) => () => new Date(iso);

test('dayKey usa o fuso declarado, não UTC', () => {
  // 02:00 UTC do dia 13 ainda é dia 12 em BRT (UTC-3)
  assert.equal(dayKey(new Date('2026-09-13T02:00:00Z'), -3), '2026-09-12');
  assert.equal(dayKey(new Date('2026-09-13T02:00:00Z'), 0), '2026-09-13');
});

// ─── a marca vem antes ────────────────────────────────────────────────────────
test('declare grava a intenção antes de qualquer envio, com prévia e tamanho', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 101, step: 'FUP_2', text: 'x'.repeat(300) });
  const ev = j.read()[0];
  assert.equal(ev.event, DECLARED);
  assert.equal(ev.id, id);
  assert.equal(ev.identity, 'sam');
  assert.equal(ev.leadId, 101);
  assert.equal(ev.length, 300, 'guarda o tamanho real');
  assert.equal(ev.preview.length, 120, 'mas só uma prévia do texto');
});

test('uma intenção sem desfecho fica pendente', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 101, step: 'FUP_1', text: 'oi' });
  assert.equal(j.pending().length, 1);
  assert.equal(j.pending()[0].id, id);
});

test('cada um dos quatro desfechos fecha a pendência', () => {
  for (const estado of ['registered', 'register_failed', 'resolved', 'reconciled']) {
    const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
    const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
    j.close(id, estado);
    assert.deepEqual(j.pending(), [], `${estado} deveria fechar`);
  }
});

test('uncertain NÃO fecha: clicou e não confirmou continua pendente', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  j.close(id, UNCERTAIN, { why: 'bolha não apareceu' });
  assert.equal(j.pending().length, 1, 'a dúvida tem que sobreviver à rodada');
});

test('estado de fechamento inválido é erro, não um rótulo novo em silêncio', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  assert.throws(() => j.close(id, 'deu tudo certo'), /estado de fechamento inválido/);
});

// ─── durabilidade ─────────────────────────────────────────────────────────────
test('cada evento é uma linha completa, terminada em newline', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  j.close(id, 'registered');
  const file = join(d, readdirSync(d)[0]);
  const raw = readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.equal(raw.trim().split('\n').length, 2);
  for (const line of raw.trim().split('\n')) JSON.parse(line); // não lança
});

test('linha truncada por queda é ignorada, e o resto continua legível', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  const file = join(d, readdirSync(d)[0]);
  appendFileSync(file, '{"at":"2026-09-12T10:05:00Z","event":"decl');
  const events = j.read();
  assert.equal(events.length, 1, 'a linha pela metade não entra nem derruba');
  assert.equal(j.pending().length, 1);
});

test('diretório vazio ou inexistente não lança', () => {
  const j = createJournal({ dir: join(dir(), 'nao', 'existe', 'ainda') });
  assert.deepEqual(j.read(), []);
  assert.deepEqual(j.pending(), []);
  assert.equal(j.countToday('sam'), 0);
});

// ─── o teto sai do journal ────────────────────────────────────────────────────
test('countToday conta por identidade, não por lead nem por dono do card', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  j.declare({ identity: 'sam', leadId: 2, step: 'FUP_1', text: 'b' });
  j.declare({ identity: 'ana', leadId: 3, step: 'FUP_1', text: 'c' });
  assert.equal(j.countToday('sam'), 2);
  assert.equal(j.countToday('ana'), 1);
});

test('o teto conta a INTENÇÃO, não o sucesso: registro falhado ainda conta', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  j.close(id, 'register_failed');
  assert.equal(j.countToday('sam'), 1, 'a mensagem saiu; para um teto, errar para mais é o lado seguro');
});

test('capReached compara com o teto e é falso quando não há teto', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  for (let i = 0; i < 3; i += 1) j.declare({ identity: 'sam', leadId: i, step: 'FUP_1', text: 'a' });
  assert.equal(j.capReached('sam', 5), false);
  assert.equal(j.capReached('sam', 3), true);
  assert.equal(j.capReached('sam', 0), false, 'sem teto declarado, não bloqueia');
});

test('o dia de ontem não conta para o teto de hoje', () => {
  const d = dir();
  const ontem = createJournal({ dir: d, clock: at('2026-09-11T14:00:00Z') });
  ontem.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  const hoje = createJournal({ dir: d, clock: at('2026-09-12T14:00:00Z') });
  assert.equal(hoje.countToday('sam'), 0);
  assert.equal(hoje.pending().length, 1, 'mas a pendência de ontem continua pendente');
});

test('um arquivo por dia', () => {
  const d = dir();
  createJournal({ dir: d, clock: at('2026-09-11T14:00:00Z') }).declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  createJournal({ dir: d, clock: at('2026-09-12T14:00:00Z') }).declare({ identity: 'sam', leadId: 2, step: 'FUP_1', text: 'b' });
  assert.deepEqual(readdirSync(d).sort(), ['send-2026-09-11.ndjson', 'send-2026-09-12.ndjson']);
});
