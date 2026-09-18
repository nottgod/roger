// The first tests for the cadence. It had none — and that is exactly where the bug was
// da FUP infinita se escondeu: `FUP_MAIS → FUP_MAIS` fazia o painel criar follow-up
// forever, against the D+28 ending that cadencia-funil.md itself declares.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCadencia, nextValidDate, endOfDayBRT } from './cadencia.mjs';

// ─── THE REGRESSION THAT JUSTIFIES THIS FILE ─────────────────────────────────
test('the sequence ENDS: FUP_MAIS does not chain into itself', () => {
  const { map } = loadCadencia();
  assert.ok(map.FUP_MAIS, 'FUP_MAIS existe no mapa');
  assert.equal(map.FUP_MAIS.next, null, 'next null = end of sequence');
  assert.notEqual(map.FUP_MAIS.next, 'FUP_MAIS', 'self-chaining is the bug');
});

test('no step points at itself', () => {
  const { map } = loadCadencia();
  for (const [from, step] of Object.entries(map)) {
    assert.notEqual(step.next, from, `${from} aponta para si mesmo`);
  }
});

test('walking the cadence from the first message terminates, in at most 8 steps', () => {
  const { map } = loadCadencia();
  let stage = 'MENSAGEM_INICIAL';
  let days = 0;
  const visitados = [];
  for (let i = 0; i < 20; i += 1) {
    const step = map[stage];
    if (!step || step.next == null) break;
    days += step.days;
    visitados.push(stage);
    assert.ok(!visitados.includes(step.next), `ciclo detectado em ${step.next}`);
    stage = step.next;
  }
  assert.equal(stage, 'FUP_MAIS', 'the walk has to stop at the last touch');
  assert.ok(visitados.length <= 8, `passos: ${visitados.length}`);
  // Six follow-ups over 28 days. The total up to the last touch cannot exceed that.
  assert.ok(days <= 28, `${days} days accumulated, the declared ending is D+28`);
});

// ─── parse do markdown ────────────────────────────────────────────────────────
test('the map covers the first message and the five follow-ups', () => {
  const { map, source } = loadCadencia();
  for (const k of ['MENSAGEM_INICIAL', 'FUP_1', 'FUP_2', 'FUP_3', 'FUP_4', 'FUP_5']) {
    assert.ok(map[k], `${k} faltando`);
    assert.equal(typeof map[k].days, 'number');
    assert.ok(map[k].days > 0, `${k} has an invalid due offset`);
  }
  assert.ok(['cadencia-funil.md', 'fallback'].includes(source));
});

test('each step chains into the next, in order', () => {
  const { map } = loadCadencia();
  assert.equal(map.MENSAGEM_INICIAL.next, 'FUP_1');
  assert.equal(map.FUP_1.next, 'FUP_2');
  assert.equal(map.FUP_2.next, 'FUP_3');
  assert.equal(map.FUP_3.next, 'FUP_4');
  assert.equal(map.FUP_4.next, 'FUP_5');
  assert.equal(map.FUP_5.next, 'FUP_MAIS');
});

// ─── nextValidDate: Fri, Sat and Sun push to Monday ──────────────────────────
// References (BRT): 2026-09-14 is a Monday; the 18th Friday; 19th Saturday; 20th Sunday.
const noon = (iso) => new Date(`${iso}T15:00:00Z`); // 12:00 BRT
const dayOf = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

test('lands on a Friday, moves to Monday', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 4)), '2026-09-21');
});

test('lands on a Saturday, moves to Monday', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 5)), '2026-09-21');
});

test('lands on a Sunday, moves to Monday', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 6)), '2026-09-21');
});

test('a weekday is not pushed', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 1)), '2026-09-15');
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 2)), '2026-09-16');
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 3)), '2026-09-17');
});

test('the returned date never lands on a Friday, Saturday or Sunday', () => {
  const base = noon('2026-09-14');
  for (let d = 1; d <= 30; d += 1) {
    const dow = new Date(nextValidDate(base, d).getTime() - 3 * 3600_000).getUTCDay();
    assert.ok(![0, 5, 6].includes(dow), `D+${d} caiu em dow ${dow}`);
  }
});

// ─── endOfDayBRT ──────────────────────────────────────────────────────────────
test('endOfDayBRT is 23:59:59 BRT of the target day', () => {
  const ts = endOfDayBRT(noon('2026-09-16'));
  const iso = new Date(ts * 1000).toISOString();
  assert.equal(iso, '2026-09-17T02:59:59.000Z', '02:59:59 UTC = 23:59:59 BRT do dia anterior');
});

test('endOfDayBRT returns seconds, not milliseconds', () => {
  const ts = endOfDayBRT(noon('2026-09-16'));
  assert.ok(ts < 1e11, 'unix em segundos');
  assert.equal(Number.isInteger(ts), true);
});

test('endOfDayBRT on consecutive days differs by exactly 24 hours', () => {
  const a = endOfDayBRT(noon('2026-09-16'));
  const b = endOfDayBRT(noon('2026-09-17'));
  assert.equal(b - a, 86400);
});
