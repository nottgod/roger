// intel.test.mjs — testes da camada Intelligence (Roger v5, F2).
// RULE: zero network. The 3 APIs are mocked by injecting `deps` into collectIntel/runIntel.
// Rodar: node --test scripts/roger/intel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIntel, detectSignals, collectIntel } from './intel.mjs';

const KEYS = { exaKey: 'fake', fundableKey: 'fake', firecrawlKey: 'fake' };
const recentISO = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(); // ~2 months ago

// a factory of mocked deps
function mockDeps(over = {}) {
  return {
    fundableLookup: async () => over.fundable ?? null,
    findWebsiteViaExa: async () => over.website ?? null,
    firecrawlScrape: async () => over.scraped ?? {},
    exaPainPoint: async () => over.painPoint ?? null,
    ...over.fns,
  };
}

test('(a) recent funding + a blog → strong timing, classify HOT', async () => {
  const lead = {
    name: 'Jane', company: 'NorthPay',
    b2b2: true, web2Firm: true, geo: 'USA', decisorAcessivel: true,
    budgetProvavel: 6000, segment: 'payments', headcount: 80,
  };
  const deps = mockDeps({
    fundable: { name: 'NorthPay', dealDate: recentISO, numEmployees: 80, country: 'USA', website: 'https://northpay.example' },
    scraped: { description: 'We just announced a new partnership and are hiring for marketing. Read our blog.', linkedinCompany: 'https://linkedin.com/company/acme' },
    painPoint: 'struggling with awareness',
  });
  const r = await runIntel(lead, KEYS, deps);
  assert.equal(r.tier, 'QUENTE');
  assert.ok(r.timing.detected.includes('recentFunding'));
  assert.ok(r.gap.needsJudgment.length >= 1);
  assert.equal(r.sources.fundable, 'ok');
});

test('(b) out of the ICP → DISCARD through the score.mjs gate', async () => {
  const lead = {
    name: 'Bob', company: 'BigBank',
    b2b2: false, web2Firm: true, geo: 'USA', decisorAcessivel: true,
    budgetProvavel: 8000, segment: 'payments', nonIcpFlags: ['enterprise-bank'], headcount: 200,
  };
  const deps = mockDeps({ fundable: { name: 'BigBank', numEmployees: 200 } });
  const r = await runIntel(lead, KEYS, deps);
  assert.equal(r.tier, 'DESCARTE');
  assert.match(r.reason, /not our market/);
});

test('(c) collection fails (the APIs return null) → the report degrades without crashing', async () => {
  const lead = {
    name: 'Carol', company: 'GhostCo',
    b2b2: true, web2Firm: true, geo: 'UK', decisorAcessivel: true,
    budgetProvavel: 5000, segment: 'marketplaces', headcount: 60,
  };
  const deps = mockDeps({ fundable: null, website: null, scraped: {}, painPoint: null });
  const r = await runIntel(lead, KEYS, deps);
  // it must not throw; the sources mark failure or skip
  assert.equal(r.sources.fundable, 'fail');
  assert.equal(r.sources.firecrawl, 'skip'); // with no website, it never reaches Firecrawl
  assert.equal(r.sources.exa, 'fail');
  assert.ok(['QUENTE', 'MORNO', 'FRIO'].includes(r.tier)); // ICP fine via the lead → not a DISCARD
});

test('detectSignals: with no data it invents no objective signals', () => {
  const r = detectSignals({ fundable: {}, scraped: {}, sources: { firecrawl: 'skip' }, painPoint: null });
  assert.equal(Object.keys(r.timing).length, 0);
  assert.equal(r.needsJudgment.length, 4);
});

test('collectIntel: a lead with no company returns an empty shape without calling collectors', async () => {
  let called = false;
  const deps = mockDeps({ fns: { fundableLookup: async () => { called = true; return null; } } });
  const out = await collectIntel({}, KEYS, deps);
  assert.equal(called, false);
  assert.equal(out.sources.fundable, 'skip');
});
