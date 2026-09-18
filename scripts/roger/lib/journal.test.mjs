import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJournal, dayKey, DECLARED, UNCERTAIN } from './journal.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'roger-journal-'));
const at = (iso) => () => new Date(iso);

test('dayKey uses the declared timezone, not UTC', () => {
  // 02:00 UTC on the 13th is still the 12th in BRT (UTC-3)
  assert.equal(dayKey(new Date('2026-09-13T02:00:00Z'), -3), '2026-09-12');
  assert.equal(dayKey(new Date('2026-09-13T02:00:00Z'), 0), '2026-09-13');
});

// ─── a marca vem antes ────────────────────────────────────────────────────────
test('declare records the intent before any send, with a preview and a length', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 101, step: 'FUP_2', text: 'x'.repeat(300) });
  const ev = j.read()[0];
  assert.equal(ev.event, DECLARED);
  assert.equal(ev.id, id);
  assert.equal(ev.identity, 'sam');
  assert.equal(ev.leadId, 101);
  assert.equal(ev.length, 300, 'guarda o tamanho real');
  assert.equal(ev.preview.length, 120, 'but only a preview of the text');
});

test('an intent with no outcome stays pending', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 101, step: 'FUP_1', text: 'oi' });
  assert.equal(j.pending().length, 1);
  assert.equal(j.pending()[0].id, id);
});

test('each of the four outcomes closes the pending intent', () => {
  for (const estado of ['registered', 'register_failed', 'resolved', 'reconciled']) {
    const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
    const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
    j.close(id, estado);
    assert.deepEqual(j.pending(), [], `${estado} deveria fechar`);
  }
});

test('uncertain does NOT close: clicked and unconfirmed stays pending', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  j.close(id, UNCERTAIN, { why: 'the bubble did not appear' });
  assert.equal(j.pending().length, 1, 'the doubt has to survive the run');
});

test('an invalid closing state is an error, not a new label in silence', () => {
  const j = createJournal({ dir: dir(), clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  assert.throws(() => j.close(id, 'all good'), /invalid closing state/);
});

// ─── durabilidade ─────────────────────────────────────────────────────────────
test('every event is one whole line, ending in a newline', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  j.close(id, 'registered');
  const file = join(d, readdirSync(d)[0]);
  const raw = readFileSync(file, 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.equal(raw.trim().split('\n').length, 2);
  for (const line of raw.trim().split('\n')) JSON.parse(line); // does not throw
});

test('a line truncated by a crash is skipped, and the rest stays readable', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'oi' });
  const file = join(d, readdirSync(d)[0]);
  appendFileSync(file, '{"at":"2026-09-12T10:05:00Z","event":"decl');
  const events = j.read();
  assert.equal(events.length, 1, 'the half line neither lands nor breaks the read');
  assert.equal(j.pending().length, 1);
});

test('an empty or missing directory does not throw', () => {
  const j = createJournal({ dir: join(dir(), 'nao', 'existe', 'ainda') });
  assert.deepEqual(j.read(), []);
  assert.deepEqual(j.pending(), []);
  assert.equal(j.countToday('sam'), 0);
});

// ─── o teto sai do journal ────────────────────────────────────────────────────
test('countToday counts per identity, not per lead or card owner', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  j.declare({ identity: 'sam', leadId: 2, step: 'FUP_1', text: 'b' });
  j.declare({ identity: 'ana', leadId: 3, step: 'FUP_1', text: 'c' });
  assert.equal(j.countToday('sam'), 2);
  assert.equal(j.countToday('ana'), 1);
});

test('the cap counts the INTENT, not the success: a failed record still counts', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  const id = j.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  j.close(id, 'register_failed');
  assert.equal(j.countToday('sam'), 1, 'the message went out; for a cap, erring high is the safe side');
});

test('capReached compares against the cap and is false when there is none', () => {
  const d = dir();
  const j = createJournal({ dir: d, clock: at('2026-09-12T10:00:00Z') });
  for (let i = 0; i < 3; i += 1) j.declare({ identity: 'sam', leadId: i, step: 'FUP_1', text: 'a' });
  assert.equal(j.capReached('sam', 5), false);
  assert.equal(j.capReached('sam', 3), true);
  assert.equal(j.capReached('sam', 0), false, 'with no declared cap, it does not block');
});

test('yesterday does not count towards the cap for today', () => {
  const d = dir();
  const yesterday = createJournal({ dir: d, clock: at('2026-09-11T14:00:00Z') });
  yesterday.declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  const today = createJournal({ dir: d, clock: at('2026-09-12T14:00:00Z') });
  assert.equal(today.countToday('sam'), 0);
  assert.equal(today.pending().length, 1, 'but yesterday pending intent is still pending');
});

test('one file per day', () => {
  const d = dir();
  createJournal({ dir: d, clock: at('2026-09-11T14:00:00Z') }).declare({ identity: 'sam', leadId: 1, step: 'FUP_1', text: 'a' });
  createJournal({ dir: d, clock: at('2026-09-12T14:00:00Z') }).declare({ identity: 'sam', leadId: 2, step: 'FUP_1', text: 'b' });
  assert.deepEqual(readdirSync(d).sort(), ['send-2026-09-11.ndjson', 'send-2026-09-12.ndjson']);
});
