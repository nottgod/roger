// gen.test.mjs — testes do motor de geração (Roger v5, F3).
// REGRA: zero rede. Lê só os .md committados do context pack (determinístico).
// Rodar: node --test scripts/roger/gen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cultureLookup, segmentVocab, approachStructure, touchAngle, voiceSnippets,
  buildGenerationBrief, renderBrief,
} from './gen.mjs';

// ── helpers: cultureLookup ──
test('cultureLookup: Germany -> registro factual + transversal germânico', () => {
  const c = cultureLookup('Germany');
  assert.equal(c.region, 'Germânico (DE/CH)');
  assert.match(c.registro, /factual/i);
  assert.ok(c.transversal.some((t) => /elogio vazio/i.test(t)));
});

test('cultureLookup: Japan -> East Asia + transversal paciência', () => {
  const c = cultureLookup('Japan');
  assert.equal(c.region, 'East Asia (JP/KR)');
  assert.ok(c.transversal.some((t) => /paciência/i.test(t)));
});

test('cultureLookup: geo desconhecido não crasha, marca não mapeado', () => {
  const c = cultureLookup('Atlantis');
  assert.match(c.region, /não mapeado/i);
  assert.ok(typeof c.registro === 'string' && c.registro.length > 0);
});

// ── helpers: segmentVocab ──
test('segmentVocab: payments -> vocabulário de settlement', () => {
  const v = segmentVocab('payments');
  assert.match(v.vocab, /settlement|chargeback/i);
});

test('segmentVocab: marketplaces -> vocabulário de split/payout', () => {
  const v = segmentVocab('marketplaces');
  assert.match(v.vocab, /split|payout/i);
});

test('segmentVocab: vazio/null/undefined -> null (não vaza o cabeçalho da tabela)', () => {
  assert.equal(segmentVocab(null).narrativa, null);
  assert.equal(segmentVocab('').vocab, null);
  assert.equal(segmentVocab(undefined).narrativa, null);
  // intel null no modo outbound degrada pra null no brief, não injeta 'Narrativa-chave (1 linha)'
  const b = buildGenerationBrief({ contact: { geo: 'USA' }, company: 'Co', stage: 'FUP_1', mode: 'outbound', intel: null });
  assert.equal(b.diagnostic.narrativa, null);
});

// ── helpers: approachStructure ──
test('approachStructure: Institucional -> quando vem do .md + estrutura 7.7 tem 3 elementos', () => {
  const a = approachStructure('Institucional');
  assert.match(a.quando, /finance leader|regulated/i);
  assert.equal(a.estrutura.elementos.length, 3);
});

// ── helpers: touchAngle ──
test('touchAngle: FUP_2 troca de ângulo; FUP_MAIS última tentativa', () => {
  assert.match(touchAngle('FUP_2').angle, /ângulo/i);
  assert.match(touchAngle('FUP_MAIS').angle, /última tentativa/i);
});

// ── helpers: voiceSnippets ──
test('voiceSnippets: carrega a persona do operador e as regras da voz dele', () => {
  const vs = voiceSnippets('example');
  assert.equal(vs.operator, 'example');
  assert.equal(vs.loaded, true, 'persona.md do operador tem que existir');
  assert.equal(vs.voiceSource, 'file', 'voice.json tem que ser lido');
  assert.ok(vs.rules.length > 0);
  assert.equal(vs.voice.banEmDash, true, 'esta voz bane travessao');
});

// ── fábrica de report (shape do intel.mjs) ──
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
test('outbound: tier DESCARTE -> go=false, skipReason DESCARTE', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'NopeCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'DESCARTE', reason: 'não-ICP (3.6): neobank' }) });
  assert.equal(b.go, false);
  assert.match(b.skipReason, /DESCARTE/);
});

test('outbound: FRIO + gap 0 + fontes pobres -> go=false, sem matéria', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'UK' }, company: 'GhostCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'FRIO', gapDetected: [], gapCount: 0, timingDetected: [], timingCount: 0, sources: { fundable: 'fail', firecrawl: 'skip', exa: 'fail' }, raw: { website: null, fundable: null, scraped: {}, painPoint: null } }) });
  assert.equal(b.go, false);
  assert.match(b.skipReason, /sem matéria/i);
});

test('outbound: QUENTE payments USA FUP_2 -> go=true, ângulo de troca, vocab do segmento, cultura USA', () => {
  const b = buildGenerationBrief({ contact: { name: 'Jane', role: 'CEO', geo: 'USA' }, company: 'NorthPay', stage: 'FUP_2', mode: 'outbound', intel: intelReport({}) });
  assert.equal(b.go, true);
  assert.equal(b.mode, 'outbound');
  assert.match(b.redacao.touchAngle.angle, /ângulo/i);
  assert.match(b.diagnostic.vocab, /settlement|chargeback/i);
  assert.equal(b.culture.region, 'USA NY');
  assert.equal(b.redacao.charTarget.cap, 600);
});

test('outbound: connection germany institucional -> transversal germânico, cap 300', () => {
  const b = buildGenerationBrief({ contact: { name: 'Klaus', role: 'Head of Finance', geo: 'Germany' }, company: 'KapitalFO', stage: 'connection', mode: 'outbound', intel: intelReport({ segment: 'payments', approach: 'Institucional' }) });
  assert.ok(b.culture.transversal.some((t) => /elogio vazio/i.test(t)));
  assert.equal(b.redacao.charTarget.cap, 300);
  assert.match(b.redacao.quando, /finance leader|regulated/i);
});

test('outbound: rawFacts nunca inventa funding (raw.fundable null -> funding null)', () => {
  const b = buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'AcmeRWA', stage: 'FUP_1', mode: 'outbound', intel: intelReport({ raw: { website: null, fundable: null, scraped: {}, painPoint: null } }) });
  assert.equal(b.rawFacts.funding, null);
  assert.match(b.rawFacts.aviso, /NUNCA inventar/i);
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

test('conversation: objeção do contexto -> reframe do contexto, go=true', () => {
  const b = buildGenerationBrief(convInput('we already have a tool for that'));
  assert.equal(b.objection.key, 'has-tool');
  assert.match(b.objection.reframe, /por mão|by hand|mão/i);
  assert.equal(b.go, true);
  assert.equal(b.voiceRule.rule, 'conceder-reframe');
});

test('conversation: objeção de construir em casa -> reframe de manutenção', () => {
  const b = buildGenerationBrief(convInput('we would rather build it in house'));
  assert.equal(b.objection.key, 'build-it');
  assert.match(b.objection.reframe, /maint|mantém|manuten/i);
  assert.equal(b.voiceRule.rule, 'conceder-reframe');
});

test('conversation: 1ª tese substantiva (sem objeção/next-step) -> socratic', () => {
  const b = buildGenerationBrief(convInput('builders is the bottleneck, western desks will default settlement once they feel the vastness'));
  assert.equal(b.objection, null);
  assert.equal(b.voiceRule.rule, 'socratic');
});

test('conversation: lead pediu próximo passo -> chefe-modo', () => {
  const b = buildGenerationBrief(convInput("happy to chat, send me more info on what you did"));
  assert.equal(b.voiceRule.rule, 'chefe-modo');
});

test('conversation: hostil/"i said no" -> descarte, go=false', () => {
  const b = buildGenerationBrief(convInput("i said no, please respect that and stop messaging me"));
  assert.equal(b.signal, 'discard');
  assert.equal(b.go, false);
  assert.equal(b.voiceRule.rule, 'descarte-honesto');
});

test('conversation: "i dont understand" -> recovery', () => {
  const b = buildGenerationBrief(convInput("hi, i dont quite understand your question"));
  assert.equal(b.voiceRule.rule, 'recovery');
});

test('conversation: traz catálogo (contextFile) e nota de não-criar-task', () => {
  const b = buildGenerationBrief(convInput('interesting, tell me more'));
  assert.match(b.contextFile, /conversation\.md$/);
  assert.match(b.note, /NÃO cria task/i);
  assert.ok(Array.isArray(b.bant.probe) && b.bant.probe.length === 4);
});

// ── conversation: referral (lead te passa pro decisor) ──
test('conversation: lead passa pro decisor -> signal referral, voiceRule referral-handoff, go=true', () => {
  const b = buildGenerationBrief(convInput('best person to take this further is Nabil on our side, drop him a message'));
  assert.equal(b.signal, 'referral');
  assert.equal(b.voiceRule.rule, 'referral-handoff');
  assert.equal(b.go, true);
});

test('conversation: "happy to connect you with our head of growth" -> signal referral', () => {
  const b = buildGenerationBrief(convInput('happy to connect you with our head of growth'));
  assert.equal(b.signal, 'referral');
  assert.equal(b.voiceRule.rule, 'referral-handoff');
});

// regressão: referral NÃO pode roubar os caminhos existentes
test('conversation regressão: chefe-modo/conceder-reframe/socratic não viram referral', () => {
  assert.equal(buildGenerationBrief(convInput('happy to chat, send me more info')).voiceRule.rule, 'chefe-modo');
  assert.equal(buildGenerationBrief(convInput('we already have a tool for that')).voiceRule.rule, 'conceder-reframe');
  assert.equal(buildGenerationBrief(convInput('interesting, tell me more')).voiceRule.rule, 'socratic');
});

// regressão (review F3): convite self-referencial do PRÓPRIO lead NÃO é referral (era bug High)
test('conversation regressão: "talk to you"/"reach out to me"/"speak with you" não viram referral', () => {
  assert.notEqual(buildGenerationBrief(convInput('happy to talk to you next week')).signal, 'referral');
  assert.notEqual(buildGenerationBrief(convInput('feel free to reach out to me anytime')).signal, 'referral');
  assert.notEqual(buildGenerationBrief(convInput('would love to speak with you about this')).signal, 'referral');
  // e o lead que convida call direto continua indo pra chefe-modo, não pro handoff de indicação
  assert.equal(buildGenerationBrief(convInput('happy to talk to you next week')).voiceRule.rule, 'chefe-modo');
});

// regressão (review F3): recusa educada NÃO vira positive (substring 'interested' nu era bug Medium)
test('conversation regressão: "not interested"/"no longer interested"/"uninterested" não viram positive', () => {
  assert.notEqual(buildGenerationBrief(convInput('thanks but not interested')).signal, 'positive');
  assert.notEqual(buildGenerationBrief(convInput('no longer interested, please remove me')).signal, 'positive');
  assert.notEqual(buildGenerationBrief(convInput('uninterested, sorry')).signal, 'positive');
});

// ── render ──
test('renderBrief: outbound vira markdown com as 3 camadas', () => {
  const b = buildGenerationBrief({ contact: { name: 'Jane', geo: 'USA' }, company: 'NorthPay', stage: 'FUP_2', mode: 'outbound', intel: intelReport({}) });
  const md = renderBrief(b);
  assert.match(md, /Diagnóstico/);
  assert.match(md, /Cultura/);
  assert.match(md, /Redação/);
  assert.equal(typeof md, 'string');
});

test('renderBrief: brief com go=false mostra SKIP e a razão', () => {
  const b = buildGenerationBrief({ contact: { geo: 'USA' }, company: 'NopeCo', stage: 'MENSAGEM_INICIAL', mode: 'outbound', intel: intelReport({ tier: 'DESCARTE', reason: 'não-ICP' }) });
  const md = renderBrief(b);
  assert.match(md, /SKIP|NÃO GERAR/i);
});

test('renderBrief: conversation mostra sinal, objeção e regra de voz', () => {
  const b = buildGenerationBrief(convInput('we already have a tool for that'));
  const md = renderBrief(b);
  assert.match(md, /sinal/i);
  assert.match(md, /reframe/i);
  assert.match(md, /conceder-reframe/);
});

// ── no-throw: contrato de buildGenerationBrief (intel/contact/input null não crasham) ──
test('no-throw: intel null e contact null não crasham em nenhum modo', () => {
  for (const mode of ['outbound', 'conversation']) {
    assert.doesNotThrow(() => buildGenerationBrief({ contact: { name: 'X', geo: 'USA' }, company: 'Co', stage: 'FUP_1', mode, intel: null }));
    assert.doesNotThrow(() => buildGenerationBrief({ contact: null, company: 'Co', stage: 'FUP_1', mode, intel: { tier: 'QUENTE', segment: 'rwa' } }));
  }
  assert.doesNotThrow(() => buildGenerationBrief(null));
  assert.doesNotThrow(() => buildGenerationBrief());
});
