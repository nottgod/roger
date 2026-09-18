// gen.test.mjs — tests for the generation engine.
// RULE: zero network. It only reads the committed .md files of the context pack (deterministic).
// Rodar: node --test scripts/roger/gen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cultureLookup, segmentVocab, approachStructure, touchAngle, voiceSnippets,
  buildGenerationBrief, renderBrief,
} from './gen.mjs';

// ── helpers: cultureLookup ──
test('cultureLookup: Germany -> a factual register + the germanic note', () => {
  const c = cultureLookup('Germany');
  assert.equal(c.region, 'Germanic (DE/CH)');
  assert.match(c.registro, /factual/i);
  assert.ok(c.transversal.some((t) => /empty praise|compliment/i.test(t)));
});

test('cultureLookup: Japan -> East Asia + the patience note', () => {
  const c = cultureLookup('Japan');
  assert.equal(c.region, 'East Asia (JP/KR)');
  assert.ok(c.transversal.some((t) => /patient|patience/i.test(t)));
});

test('cultureLookup: an unknown geo does not crash, it marks it unmapped', () => {
  const c = cultureLookup('Atlantis');
  assert.match(c.region, /not mapped/i);
  assert.ok(typeof c.registro === 'string' && c.registro.length > 0);
});

// ── helpers: segmentVocab ──
test('segmentVocab: payments -> settlement vocabulary', () => {
  const v = segmentVocab('payments');
  assert.match(v.vocab, /settlement|chargeback/i);
});

test('segmentVocab: marketplaces -> split and payout vocabulary', () => {
  const v = segmentVocab('marketplaces');
  assert.match(v.vocab, /split|payout/i);
});

test('segmentVocab: empty/null/undefined -> null (it does not leak the table header)', () => {
  assert.equal(segmentVocab(null).narrativa, null);
  assert.equal(segmentVocab('').vocab, null);
  assert.equal(segmentVocab(undefined).narrativa, null);
  // a null intel in outbound degrades to null in the brief, it does not inject the table header
  const b = buildGenerationBrief({ contact: { geo: 'USA' }, company: 'Co', stage: 'FUP_1', mode: 'outbound', intel: null });
  assert.equal(b.diagnostic.narrativa, null);
});

// ── helpers: approachStructure ──
test('approachStructure: the when comes from the .md, and the structure has 3 elements', () => {
  const a = approachStructure('Institucional');
  assert.match(a.quando, /finance leader|regulated/i);
  assert.equal(a.estrutura.elementos.length, 3);
});

// ── helpers: touchAngle ──
test('touchAngle: FUP_2 changes the angle; FUP_MAIS is the last try', () => {
  assert.match(touchAngle('FUP_2').angle, /angle/i);
  assert.match(touchAngle('FUP_MAIS').angle, /last try/i);
});

// ── helpers: voiceSnippets ──
test('voiceSnippets: loads the operator persona and their voice rules', () => {
  const vs = voiceSnippets('example');
  assert.equal(vs.operator, 'example');
  assert.equal(vs.loaded, true, 'persona.md do operador tem que existir');
  assert.equal(vs.voiceSource, 'file', 'voice.json tem que ser lido');
  assert.ok(vs.rules.length > 0);
  assert.equal(vs.voice.banEmDash, true, 'esta voz bane travessao');
});

// ── report factory (the intel.mjs shape) ──
function intelReport(over = {}) {
  return {
    lead: { name: over.name || 'Jane', company: over.company || 'NorthPay' },
    tier: over.tier || 'QUENTE',
    segment: over.segment || 'payments',
    angle: over.angle || 'Payment processors',
    approach: over.approach || 'Case',
    timing: { detected: over.timingDetected || ['fundingAte12m'], count: over.timingCount ?? 1 },
    gap: { detected: over.gapDetected || ['semConteudoSubstancia'], needsJudgment: over.needsJudgment || ['brandingAmador'], count: over.gapCount ?? 1 },
    sources: over.sources || { fundable: 'ok', firecrawl: 'ok', exa: 'ok' },
    reason: over.reason || 'ICP OK · gap 1/8 · timing 1/6',
    raw: over.raw || { website: 'https://acme.xyz', fundable: { dealDate: '2026-03-01', numEmployees: 18, country: 'USA' }, scraped: {}, painPoint: 'low awareness' },
  };
}

// ── outbound: gating ──
test('outbound: a DISCARD tier -> go=false, with a SKIP reason', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'NopeCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'DESCARTE', reason: 'not our market (3.6): neobank' }) });
  assert.equal(b.go, false);
  assert.match(b.skipReason, /SKIP/);
});

test('outbound: COLD + gap 0 + thin sources -> go=false, not enough material', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'UK' }, company: 'GhostCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'FRIO', gapDetected: [], gapCount: 0, timingDetected: [], timingCount: 0, sources: { fundable: 'fail', firecrawl: 'skip', exa: 'fail' }, raw: { website: null, fundable: null, scraped: {}, painPoint: null } }) });
  assert.equal(b.go, false);
  assert.match(b.skipReason, /not enough material/i);
});

test('outbound: HOT payments US FUP_2 -> go=true, a changed angle, segment vocab, US culture', () => {
  const b = buildGenerationBrief({ contact: { name: 'Jane', role: 'CEO', geo: 'USA' }, company: 'NorthPay', stage: 'FUP_2', mode: 'outbound', intel: intelReport({}) });
  assert.equal(b.go, true);
  assert.equal(b.mode, 'outbound');
  assert.match(b.redacao.touchAngle.angle, /angle/i);
  assert.match(b.diagnostic.vocab, /settlement|chargeback/i);
  assert.equal(b.culture.region, 'USA NY');
  assert.equal(b.redacao.charTarget.cap, 600);
});

test('outbound: a german institutional connection -> the germanic note, cap 300', () => {
  const b = buildGenerationBrief({ contact: { name: 'Klaus', role: 'Head of Finance', geo: 'Germany' }, company: 'KapitalFO', stage: 'connection', mode: 'outbound', intel: intelReport({ segment: 'payments', approach: 'Institucional' }) });
  assert.ok(b.culture.transversal.some((t) => /empty praise|compliment/i.test(t)));
  assert.equal(b.redacao.charTarget.cap, 300);
  assert.match(b.redacao.quando, /finance leader|regulated/i);
});

test('outbound: rawFacts never invents funding (raw.fundable null -> funding null)', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'AcmeRWA', stage: 'FUP_1', mode: 'outbound', intel: intelReport({ raw: { website: null, fundable: null, scraped: {}, painPoint: null } }) });
  assert.equal(b.rawFacts.funding, null);
  assert.match(b.rawFacts.aviso, /NEVER invent/i);
});

// ── conversation ──
function convInput(lastLeadMsg, over = {}) {
  return {
    contact: { name: 'Dara', role: 'Ecosystem Head', geo: 'Singapore' },
    company: 'NorthPay', mode: 'conversation',
    intel: intelReport({ segment: 'infra', company: 'NorthPay' }),
    thread: { lastLeadMsg, ...over },
  };
}

test('conversation: an objection from the context -> a reframe from the context, go=true', () => {
  const b = buildGenerationBrief(convInput('we already have a tool for that'));
  assert.equal(b.objection.key, 'has-tool');
  assert.match(b.objection.reframe, /by hand/i);
  assert.equal(b.go, true);
  assert.equal(b.voiceRule.rule, 'conceder-reframe');
});

test('conversation: the build-it-in-house objection -> the maintenance reframe', () => {
  const b = buildGenerationBrief(convInput('we would rather build it in house'));
  assert.equal(b.objection.key, 'build-it');
  assert.match(b.objection.reframe, /maint/i);
  assert.equal(b.voiceRule.rule, 'conceder-reframe');
});

test('conversation: a first substantive point (no objection, no next step) -> socratic', () => {
  const b = buildGenerationBrief(convInput('builders is the bottleneck, western desks will default settlement once they feel the vastness'));
  assert.equal(b.objection, null);
  assert.equal(b.voiceRule.rule, 'socratic');
});

test('conversation: the lead asked for a next step -> take charge', () => {
  const b = buildGenerationBrief(convInput("happy to chat, send me more info on what you did"));
  assert.equal(b.voiceRule.rule, 'chefe-modo');
});

test('conversation: hostile or i-said-no -> discard, go=false', () => {
  const b = buildGenerationBrief(convInput("i said no, please respect that and stop messaging me"));
  assert.equal(b.signal, 'discard');
  assert.equal(b.go, false);
  assert.equal(b.voiceRule.rule, 'descarte-honesto');
});

test('conversation: i-dont-understand -> recovery', () => {
  const b = buildGenerationBrief(convInput("hi, i dont quite understand your question"));
  assert.equal(b.voiceRule.rule, 'recovery');
});

test('conversation: it carries the catalogue (contextFile) and the do-not-create-a-task note', () => {
  const b = buildGenerationBrief(convInput('interesting, tell me more'));
  assert.match(b.contextFile, /conversation\.md$/);
  assert.match(b.note, /does NOT create a task|no task/i);
  assert.ok(Array.isArray(b.bant.probe) && b.bant.probe.length === 4);
});

// ── conversation: referral (lead te passa pro decisor) ──
test('conversation: the lead hands you to the decision maker -> referral signal, referral-handoff rule, go=true', () => {
  const b = buildGenerationBrief(convInput('best person to take this further is Nabil on our side, drop him a message'));
  assert.equal(b.signal, 'referral');
  assert.equal(b.voiceRule.rule, 'referral-handoff');
  assert.equal(b.go, true);
});

test('conversation: happy-to-connect-you-with -> a referral signal', () => {
  const b = buildGenerationBrief(convInput('happy to connect you with our head of growth'));
  assert.equal(b.signal, 'referral');
  assert.equal(b.voiceRule.rule, 'referral-handoff');
});

// regression: referral must NOT steal the existing paths
test('conversation regression: take-charge, concede-reframe and socratic do not become referral', () => {
  assert.equal(buildGenerationBrief(convInput('happy to chat, send me more info')).voiceRule.rule, 'chefe-modo');
  assert.equal(buildGenerationBrief(convInput('we already have a tool for that')).voiceRule.rule, 'conceder-reframe');
  assert.equal(buildGenerationBrief(convInput('interesting, tell me more')).voiceRule.rule, 'socratic');
});

// regression: a self-referential invite from the LEAD is NOT a referral (this was a High bug)
test('conversation regression: talk-to-you, reach-out-to-me and speak-with-you do not become referral', () => {
  assert.notEqual(buildGenerationBrief(convInput('happy to talk to you next week')).signal, 'referral');
  assert.notEqual(buildGenerationBrief(convInput('feel free to reach out to me anytime')).signal, 'referral');
  assert.notEqual(buildGenerationBrief(convInput('would love to speak with you about this')).signal, 'referral');
  // and a lead inviting a direct call still goes to take-charge, not to the referral handoff
  assert.equal(buildGenerationBrief(convInput('happy to talk to you next week')).voiceRule.rule, 'chefe-modo');
});

// regression: a polite refusal does NOT become positive (the bare substring 'interested' was a Medium bug)
test('conversation regression: not-interested and uninterested do not become positive', () => {
  assert.notEqual(buildGenerationBrief(convInput('thanks but not interested')).signal, 'positive');
  assert.notEqual(buildGenerationBrief(convInput('no longer interested, please remove me')).signal, 'positive');
  assert.notEqual(buildGenerationBrief(convInput('uninterested, sorry')).signal, 'positive');
});

// ── render ──
test('renderBrief: outbound becomes markdown with the 3 layers', () => {
  const b = buildGenerationBrief({ contact: { name: 'Jane', geo: 'USA' }, company: 'NorthPay', stage: 'FUP_2', mode: 'outbound', intel: intelReport({}) });
  const md = renderBrief(b);
  assert.match(md, /Diagnosis/);
  assert.match(md, /Culture/);
  assert.match(md, /Wording/);
  assert.equal(typeof md, 'string');
});

test('renderBrief: a brief with go=false shows SKIP and the reason', () => {
  const b = buildGenerationBrief({ contact: { geo: 'USA' }, company: 'NopeCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'DESCARTE', reason: 'not our market' }) });
  const md = renderBrief(b);
  assert.match(md, /SKIP|DO NOT WRITE/i);
});

test('renderBrief: conversation shows the signal, the objection and the voice rule', () => {
  const b = buildGenerationBrief(convInput('we already have a tool for that'));
  const md = renderBrief(b);
  assert.match(md, /signal/i);
  assert.match(md, /reframe/i);
  assert.match(md, /conceder-reframe/);
});

// ── never throws: the buildGenerationBrief contract (null intel/contact/input do not crash) ──
test('never throws: a null intel and a null contact crash in neither mode', () => {
  for (const mode of ['outbound', 'conversation']) {
    assert.doesNotThrow(() => buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'Co', stage: 'FUP_1', mode, intel: null }));
    assert.doesNotThrow(() => buildGenerationBrief({ contact: null, company: 'Co', stage: 'FUP_1', mode, intel: { tier: 'QUENTE', segment: 'rwa' } }));
  }
  assert.doesNotThrow(() => buildGenerationBrief(null));
  assert.doesNotThrow(() => buildGenerationBrief());
});
