// Tests for score.mjs against the EXAMPLE pack (rapport/contexts/example), which is
// fictional: reconciliation software for finance teams. Swap the context for your own and
// swap these numbers and slugs with it.
//
// Nota sobre `web2Firm: true`: o gate de estágio é herança do primeiro contexto que a Roger
// atendeu. Para um contexto qualquer ele não faz sentido, e está anotado como dívida.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, icpGate, gapSignature, timingSignals, loadIcp, NO_CASE, DEFAULT_APPROACH } from './score.mjs';

const base = {
  b2b2: true, web2Firm: true, decisorAcessivel: true,
  headcount: 80, geo: 'Germany', budgetProvavel: 3000, segment: 'payments',
};

test('classify: a lead that comes out hot (material gap + timing)', () => {
  const r = classify({ ...base, company: 'NorthPay', noRecentActivity: true, genericMessaging: true, recentFunding: true });
  assert.equal(r.tier, 'QUENTE');
  assert.equal(r.abordagem, 'Case');
  assert.match(r.casoParecido, /Payment/);
});

test('classify: DISCARD for being out of market', () => {
  const r = classify({ ...base, company: 'BigBank', nonIcpFlags: ['enterprise-bank'] });
  assert.equal(r.tier, 'DESCARTE');
  assert.match(r.reason, /not our market/);
});

test('classify: DISCARD for a company too big', () => {
  const r = classify({ ...base, company: 'HugeCo', headcount: 4000 });
  assert.equal(r.tier, 'DESCARTE');
  assert.match(r.reason, /headcount/);
});

test('classify: DISCARD for a company too small', () => {
  const r = classify({ ...base, company: 'TinyCo', headcount: 4 });
  assert.equal(r.tier, 'DESCARTE');
  assert.match(r.reason, /headcount/);
});

test('classify: one timing signal is already strong in this ICP', () => {
  const r = classify({ ...base, company: 'MidMarket', segment: 'marketplaces', recentFunding: true });
  assert.equal(r.tier, 'QUENTE');
  assert.equal(r.abordagem, 'Contextual');
});

test('classify: COLD when there is no signal at all', () => {
  assert.equal(classify({ ...base, company: 'QuietCo' }).tier, 'FRIO');
});

test('icpGate: a budget below the floor discards', () => {
  const r = icpGate({ ...base, budgetProvavel: 500 });
  assert.equal(r.pass, false);
  assert.match(r.reason, /budget/);
});

test('icpGate: a geography outside the table discards', () => {
  const r = icpGate({ ...base, geo: 'Antarctica' });
  assert.equal(r.pass, false);
  assert.match(r.reason, /geography/);
});

test('gapSignature: 2 signals = material in this ICP', () => {
  const r = gapSignature({ noRecentActivity: true, genericMessaging: true });
  assert.equal(r.count, 2);
  assert.equal(r.material, true);
});

test('timingSignals: 1 signal = strong in this ICP', () => {
  const r = timingSignals({ hiringForTheProblem: true });
  assert.equal(r.forte, true);
});

test('a signal that is not in the pack table does not count', () => {
  assert.deepEqual(gapSignature({ inventedSignal: true, noRecentActivity: true }).signals, ['noRecentActivity']);
});

const OUTRO_ICP = `
## 3.2.M. Números

| key | value |
| --- | --- |
| headcount_min | 1 |
| headcount_max | 10 |
| budget_floor_usd_month | 100 |
| gap_material_min | 1 |
| timing_forte_min | 1 |

## 3.3.M. Segmento, cluster e abordagem

| slug | cluster | approach |
| --- | --- | --- |
| bakery | Neighborhood bakeries | Visita |

## 3.4.M. Geografia

| slug | decision | aliases |
| --- | --- | --- |
| brazil | accept | brazil, brasil, br |
| germany | discard | germany, alemanha |

## 3.6.M. Não-ICP

| slug | label |
| --- | --- |
| franchise | Franquia |

## 3.7.M. Sinais de timing

| key | label |
| --- | --- |
| abriuFilial | Abriu filial |

## 3.11.M. Sinais de gap

| key | label |
| --- | --- |
| semVitrine | Sem vitrine |
`;

test('the SAME lead is in market in one pack and DISCARD in another', () => {
  const lead = { ...base, company: 'NorthPay' };
  assert.notEqual(classify(lead).tier, 'DESCARTE');
  const r = classify(lead, loadIcp({ text: OUTRO_ICP }));
  assert.equal(r.tier, 'DESCARTE');
  assert.match(r.reason, /headcount|geografia/);
});

test('a foreign pack uses its own segments, numbers and signals', () => {
  const icp = loadIcp({ text: OUTRO_ICP });
  const r = classify({
    b2b2: true, web2Firm: true, decisorAcessivel: true,
    headcount: 6, geo: 'Brasil', budgetProvavel: 300, segment: 'bakery', semVitrine: true,
  }, icp);
  assert.equal(r.tier, 'QUENTE');
  assert.equal(r.casoParecido, 'Neighborhood bakeries');
  assert.equal(r.abordagem, 'Visita');
  assert.match(r.reason, /gap 1\/1 · timing 0\/1/);
});

test('a geography alias matches in any declared language', () => {
  const icp = loadIcp({ text: OUTRO_ICP });
  const b = { b2b2: true, web2Firm: true, decisorAcessivel: true, headcount: 6, budgetProvavel: 300 };
  assert.equal(icpGate({ ...b, geo: 'brasil' }, icp).pass, true);
  assert.equal(icpGate({ ...b, geo: 'BR' }, icp).pass, true);
  assert.equal(icpGate({ ...b, geo: 'alemanha' }, icp).pass, false);
});

test('an icp.md with no tables falls back and SAYS what was missing', () => {
  const icp = loadIcp({ text: '# só prosa, nenhuma tabela de máquina' });
  assert.equal(icp.source, 'fallback');
  assert.equal(icp.missing.length, 6);
  assert.equal(icp.numbers.headcount_min, 1);
  assert.equal(icp.numbers.budget_floor_usd_month, 0);
  assert.equal(icp.geoAccept.size, 0);
  assert.equal(icp.nonIcp.size, 0);
});

test('with no geography table, nothing is refused on geography', () => {
  const icp = loadIcp({ text: '# nada' });
  const r = icpGate({ b2b2: true, web2Firm: true, decisorAcessivel: true, headcount: 10, geo: 'Qualquer Lugar' }, icp);
  assert.equal(r.pass, true, 'recusar em silêncio seria pior que aceitar');
});

test('a half-finished pack is marked partial, with the list of what is missing', () => {
  const icp = loadIcp({ text: OUTRO_ICP.replace(/## 3\.4\.M[\s\S]*?(?=## 3\.6\.M)/, '') });
  assert.match(icp.source, /parcial/);
  assert.deepEqual(icp.missing, ['3.4.M geografia']);
});

test('an invalid number in icp.md does not break it: it falls back to the default', () => {
  const icp = loadIcp({ text: '## 3.2.M.\n\n| key | value |\n| --- | --- |\n| headcount_min | muitos |\n' });
  assert.equal(icp.numbers.headcount_min, 1);
});

test('the icp.md of the active pack has all six machine tables', () => {
  const icp = loadIcp({ noCache: true });
  assert.deepEqual(icp.missing, [], `faltando: ${icp.missing.join(', ')}`);
  assert.equal(icp.source, 'icp.md');
});

test('the similar case can only be a cluster declared in icp.md', () => {
  // Em vez de listar nomes proibidos (que os colocaria neste arquivo), a garantia é a
  // inversa: a saída tem de estar na lista do pacote, ou ser o texto de "sem caso".
  const permitidos = ['Payment processors', 'Marketplaces', 'Neobanks', 'Lending platforms', NO_CASE];
  for (const slug of ['payments', 'marketplaces', 'neobanks', 'lending', 'inexistente']) {
    const r = classify({ ...base, segment: slug });
    assert.ok(permitidos.includes(r.casoParecido), `${slug} devolveu algo fora do pacote: ${r.casoParecido}`);
  }
});

test('an unknown segment degrades to the default', () => {
  const r = classify({ ...base, segment: 'coisa-que-nao-existe' });
  assert.equal(r.casoParecido, NO_CASE);
  assert.equal(r.abordagem, DEFAULT_APPROACH);
});
