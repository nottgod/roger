// kpi.test.mjs — tests for the pure funnel functions. Zero network.
// Rodar: node --test scripts/roger/kpi.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  funnelSnapshot, countEntries, meetingsCount, criticalConversions, monthRange,
} from './kpi.mjs';

// A fictional pipeline, defined here: the real IDs belong to each account and ship empty
// in the repo. What these tests prove is the aggregation, not anyone's configuration.
const MAIN = {
  id: 111,
  label: 'Pipeline de teste',
  stages: {
    entrada: 1101, prospeccao: 1102, desenvolvimento: 1103, qualificado: 1104,
    reuniaoAgendada: 1105, reuniaoRealizada: 1106, negociacao: 1107,
    fechamento: 1108, won: 142, lost: 143,
  },
};
const OUTRO = { id: 777, stages: { entrada: 7771 } };
const S = MAIN.stages;

// ── funnelSnapshot ──
test('funnelSnapshot: counts per stage, ignores other pipelines, an unmapped status -> _other', () => {
  const leads = [
    { id: 1, pipeline_id: MAIN.id, status_id: S.entrada },
    { id: 2, pipeline_id: MAIN.id, status_id: S.entrada },
    { id: 3, pipeline_id: MAIN.id, status_id: S.prospeccao },
    { id: 4, pipeline_id: MAIN.id, status_id: S.qualificado },
    { id: 5, pipeline_id: MAIN.id, status_id: 999999 },       // desconhecido -> _other
    { id: 6, pipeline_id: OUTRO.id, status_id: OUTRO.stages.entrada }, // outro pipeline
  ];
  const snap = funnelSnapshot(leads, MAIN);
  assert.equal(snap.entrada, 2);
  assert.equal(snap.prospeccao, 1);
  assert.equal(snap.qualificado, 1);
  assert.equal(snap.desenvolvimento, 0);
  assert.equal(snap._other, 1);
});

test('funnelSnapshot: an empty or null list does not crash', () => {
  assert.equal(funnelSnapshot([], MAIN).entrada, 0);
  assert.equal(funnelSnapshot(null, MAIN)._other, 0);
});

// ── countEntries ──
function ev(entityId, statusId, pipelineId = MAIN.id) {
  return { type: 'lead_status_changed', entity_id: entityId, value_after: [{ lead_status: { id: statusId, pipeline_id: pipelineId } }] };
}

test('countEntries: counts entries (value_after) per stage, filtered by leadIdSet and pipeline', () => {
  const set = new Set([10, 11, 12]);
  const events = [
    ev(10, S.desenvolvimento),
    ev(11, S.desenvolvimento),
    ev(10, S.qualificado),
    ev(12, S.reuniaoAgendada),
    ev(99, S.reuniaoAgendada),                 // lead fora do set -> ignorado
    ev(11, OUTRO.stages.entrada, OUTRO.id),    // outro pipeline -> ignorado p/ MAIN
    { type: 'lead_created', entity_id: 10 },    // tipo errado -> ignorado
  ];
  const c = countEntries(events, MAIN, set);
  assert.equal(c.desenvolvimento, 2);
  assert.equal(c.qualificado, 1);
  assert.equal(c.reuniaoAgendada, 1); // o do lead 99 não conta
});

test('countEntries: with no leadIdSet it counts every lead in that pipeline', () => {
  const events = [ev(1, S.negociacao), ev(2, S.negociacao)];
  assert.equal(countEntries(events, MAIN).negociacao, 2);
});

// ── meetingsCount ──
test('meetingsCount: reads entries into the meeting scheduled stage', () => {
  assert.equal(meetingsCount({ reuniaoAgendada: 4 }), 4);
  assert.equal(meetingsCount({}), 0);
  assert.equal(meetingsCount(null), 0);
});

// ── criticalConversions ──
test('criticalConversions: 3 flow rates; a denominator of 0 -> rate null', () => {
  const conv = criticalConversions({ desenvolvimento: 4, qualificado: 2, reuniaoAgendada: 2, reuniaoRealizada: 1, negociacao: 1 });
  assert.equal(conv.devToQualificado.rate, 0.5);
  assert.equal(conv.qualificadoToReuniao.rate, 1); // 2/2
  assert.equal(conv.reuniaoToNegociacao.rate, 1);  // 1/1
  const zero = criticalConversions({ desenvolvimento: 0, qualificado: 3 });
  assert.equal(zero.devToQualificado.rate, null);  // den 0
});

// ── monthRange ──
test('monthRange: the unix range of the month in BRT (UTC-3)', () => {
  const { from, to, label } = monthRange('2026-06');
  assert.equal(label, '2026-06');
  // 2026-06-01 00:00 BRT = 2026-06-01 03:00 UTC
  assert.equal(from, Math.floor(Date.UTC(2026, 5, 1, 3, 0, 0) / 1000));
  assert.equal(to, Math.floor(Date.UTC(2026, 6, 1, 3, 0, 0) / 1000));
  assert.ok(to > from);
});
