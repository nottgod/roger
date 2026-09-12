// Primeiros testes da cadência. Ela não tinha nenhum — e foi exatamente aí que o bug
// da FUP infinita se escondeu: `FUP_MAIS → FUP_MAIS` fazia o painel criar follow-up
// para sempre, contra o encerramento D+28 que o próprio cadencia-funil.md declara.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCadencia, nextValidDate, endOfDayBRT } from './cadencia.mjs';

// ─── A REGRESSÃO QUE JUSTIFICA ESTE ARQUIVO ──────────────────────────────────
test('a sequência ENCERRA: FUP_MAIS não encadeia em si mesma', () => {
  const { map } = loadCadencia();
  assert.ok(map.FUP_MAIS, 'FUP_MAIS existe no mapa');
  assert.equal(map.FUP_MAIS.next, null, 'next null = fim de sequência');
  assert.notEqual(map.FUP_MAIS.next, 'FUP_MAIS', 'auto-encadeamento é o bug');
});

test('nenhum passo aponta para si mesmo', () => {
  const { map } = loadCadencia();
  for (const [from, step] of Object.entries(map)) {
    assert.notEqual(step.next, from, `${from} aponta para si mesmo`);
  }
});

test('seguir a cadência a partir da mensagem inicial termina, e em no máximo 8 passos', () => {
  const { map } = loadCadencia();
  let stage = 'MENSAGEM_INICIAL';
  let dias = 0;
  const visitados = [];
  for (let i = 0; i < 20; i += 1) {
    const step = map[stage];
    if (!step || step.next == null) break;
    dias += step.days;
    visitados.push(stage);
    assert.ok(!visitados.includes(step.next), `ciclo detectado em ${step.next}`);
    stage = step.next;
  }
  assert.equal(stage, 'FUP_MAIS', 'a caminhada tem que parar no último toque');
  assert.ok(visitados.length <= 8, `passos: ${visitados.length}`);
  // Bloco 6: 6 FUPs em 28 dias. O acumulado até o último toque não pode passar disso.
  assert.ok(dias <= 28, `acumulado ${dias} dias, o encerramento declarado é D+28`);
});

// ─── parse do markdown ────────────────────────────────────────────────────────
test('o mapa cobre a mensagem inicial e as cinco FUPs', () => {
  const { map, source } = loadCadencia();
  for (const k of ['MENSAGEM_INICIAL', 'FUP_1', 'FUP_2', 'FUP_3', 'FUP_4', 'FUP_5']) {
    assert.ok(map[k], `${k} faltando`);
    assert.equal(typeof map[k].days, 'number');
    assert.ok(map[k].days > 0, `${k} com prazo inválido`);
  }
  assert.ok(['cadencia-funil.md', 'fallback'].includes(source));
});

test('cada passo encadeia no seguinte, em ordem', () => {
  const { map } = loadCadencia();
  assert.equal(map.MENSAGEM_INICIAL.next, 'FUP_1');
  assert.equal(map.FUP_1.next, 'FUP_2');
  assert.equal(map.FUP_2.next, 'FUP_3');
  assert.equal(map.FUP_3.next, 'FUP_4');
  assert.equal(map.FUP_4.next, 'FUP_5');
  assert.equal(map.FUP_5.next, 'FUP_MAIS');
});

// ─── nextValidDate: sex, sáb e dom empurram para segunda ─────────────────────
// Referências (BRT): 2026-09-14 é segunda; 18 sexta; 19 sábado; 20 domingo.
const noon = (iso) => new Date(`${iso}T15:00:00Z`); // 12:00 BRT
const dayOf = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);

test('cai na sexta, vai para segunda', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 4)), '2026-09-21');
});

test('cai no sábado, vai para segunda', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 5)), '2026-09-21');
});

test('cai no domingo, vai para segunda', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 6)), '2026-09-21');
});

test('dia útil não é empurrado', () => {
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 1)), '2026-09-15');
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 2)), '2026-09-16');
  assert.equal(dayOf(nextValidDate(noon('2026-09-14'), 3)), '2026-09-17');
});

test('a data devolvida nunca cai em sexta, sábado ou domingo', () => {
  const base = noon('2026-09-14');
  for (let d = 1; d <= 30; d += 1) {
    const dow = new Date(nextValidDate(base, d).getTime() - 3 * 3600_000).getUTCDay();
    assert.ok(![0, 5, 6].includes(dow), `D+${d} caiu em dow ${dow}`);
  }
});

// ─── endOfDayBRT ──────────────────────────────────────────────────────────────
test('endOfDayBRT é 23:59:59 BRT do dia alvo', () => {
  const ts = endOfDayBRT(noon('2026-09-16'));
  const iso = new Date(ts * 1000).toISOString();
  assert.equal(iso, '2026-09-17T02:59:59.000Z', '02:59:59 UTC = 23:59:59 BRT do dia anterior');
});

test('endOfDayBRT devolve segundos, não milissegundos', () => {
  const ts = endOfDayBRT(noon('2026-09-16'));
  assert.ok(ts < 1e11, 'unix em segundos');
  assert.equal(Number.isInteger(ts), true);
});

test('endOfDayBRT de dias seguidos difere em exatamente 24 horas', () => {
  const a = endOfDayBRT(noon('2026-09-16'));
  const b = endOfDayBRT(noon('2026-09-17'));
  assert.equal(b - a, 86400);
});
