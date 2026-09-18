// Testes do onboarding — o contrato entre a ENTREVISTA e o resto do motor.
//
// The risk these tests cover: the interview writing pretty files that no loader understands.
// If the icp.md coming out of screen 4 does not parse in score.mjs, or the voice.json from
// screen 3 does not change the lint verdict, then the screens are decorative.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toVoiceConfig, renderPersona, renderIcp } from './onboarding.mjs';
import { loadIcp, classify } from './score.mjs';
import { resolveVoice } from './lib/voice.mjs';
import { lintMessage } from './lint-voz.mjs';
import { readLeads, TEMPLATE_CSV } from './lib/leads-file.mjs';

// Just some person: sells reconciliation software to fintechs, writes loosely, no em
// dashes, short messages.
const ANSWERS = {
  grammar: 'human',
  register: 'oral',
  length: 'short',
  emDash: 'never',
  emoji: 'never',
  exclamation: 'never',
  cta: 'question',
  greeting: 'Hey Ana,',
  signoff: 'Best, Sam',
  banned: 'synergy, leverage, circle back',
  language: 'English',
  samples: ['saw you shipped the audit last week. how are you handling the reruns?'],
  story: 'Grew up in Naples, sold restaurant equipment before software. I talk fast.',
  slug: 'sam',
  contextName: 'ledgerline',
  whatYouSell: 'reconciliation software for fintech finance teams',
  geoAccept: 'United States, United Kingdom, Germany, Singapore',
  geoDiscard: 'Russia',
  sizeMin: '20',
  sizeMax: '400',
  budgetFloor: '1500',
  segments: 'payments, neobanks, marketplaces',
  nonIcp: 'crypto exchanges, consumer apps, agencies',
  leadSource: 'spreadsheet',
};

// ─── screen 4: the generated icp.md is read by score.mjs ─────────────────────
test('the icp.md the interview writes parses whole, with no table missing', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.deepEqual(icp.missing, [], `faltando: ${icp.missing.join(', ')}`);
  assert.equal(icp.source, 'inline');
});

test('the numbers from the interview reach the gates', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.equal(icp.numbers.headcount_min, 20);
  assert.equal(icp.numbers.headcount_max, 400);
  assert.equal(icp.numbers.budget_floor_usd_month, 1500);
});

test('accepted and rejected geographies come out of the answer, with aliases', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.ok(icp.geoAccept.has('united states'));
  assert.ok(icp.geoAccept.has('united-states'), 'o slug também casa');
  assert.ok(icp.geoAccept.has('germany'));
  assert.ok(icp.geoDiscard.has('russia'));
});

test('segments and automatic passes become tables', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.equal(icp.segments.get('payments').cluster, 'payments');
  assert.equal(icp.segments.get('neobanks').approach, 'Contextual');
  assert.ok(icp.nonIcp.has('crypto-exchanges'));
  assert.ok(icp.nonIcp.has('consumer-apps'));
});

test('the interview ICP really decides: it passes, and discards by size and by country', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  const base = { b2b2: true, web2Firm: true, decisorAcessivel: true, segment: 'payments', budgetProvavel: 3000 };

  const cabe = classify({ ...base, headcount: 80, geo: 'Germany' }, icp);
  assert.notEqual(cabe.tier, 'DESCARTE');
  assert.equal(cabe.casoParecido, 'payments');

  const pequena = classify({ ...base, headcount: 4, geo: 'Germany' }, icp);
  assert.equal(pequena.tier, 'DESCARTE');
  assert.match(pequena.reason, /headcount/);

  const paisFora = classify({ ...base, headcount: 80, geo: 'Russia' }, icp);
  assert.equal(paisFora.tier, 'DESCARTE');
  assert.match(paisFora.reason, /geografia/);

  const semBudget = classify({ ...base, headcount: 80, geo: 'Germany', budgetProvavel: 200 }, icp);
  assert.equal(semBudget.tier, 'DESCARTE');
  assert.match(semBudget.reason, /budget/);
});

test('an interview answered with blanks still writes a valid icp.md', () => {
  // The "I hit enter on everything" case. The file still has to come out parseable,
  // otherwise the person's first contact with Roger is a parse error.
  const icp = loadIcp({ text: renderIcp({}) });
  assert.deepEqual(icp.missing, []);
  assert.equal(icp.numbers.headcount_min, 1);
  assert.equal(icp.numbers.budget_floor_usd_month, 0);
  assert.ok(icp.geoAccept.has('anywhere'));
  assert.ok(icp.segments.has('default'));
  assert.equal(icp.gapKeys.length, 4);
  assert.equal(icp.timingKeys.length, 4);
});

// ─── tela 3: o voice.json gerado muda o veredito do lint ─────────────────────
test('the interview voice fails what the person said they never use', () => {
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const comTravessao = lintMessage('saw the launch — how is the rollout going?', { stage: 'FUP_2', voice });
  assert.ok(comTravessao.errors.some((e) => /em.dash/.test(e)));

  const semTravessao = lintMessage('saw the launch. how is the rollout going?', { stage: 'FUP_2', voice });
  assert.deepEqual(semTravessao.errors, []);
});

test('the length cap depends on the CHANNEL, not only on short/medium/long', () => {
  // The same answer "short" means different things: a short DM is much smaller than a
  // short email. Before, both gave 420 and Roger allowed a giant DM.
  const noLinkedin = resolveVoice(toVoiceConfig({ ...ANSWERS, channels: 'linkedin' }));
  const noEmail = resolveVoice(toVoiceConfig({ ...ANSWERS, channels: 'email' }));
  assert.equal(noLinkedin.caps.default, 300);
  assert.equal(noEmail.caps.default, 600);

  const mesmaMensagem = 'x'.repeat(500);
  const naDm = lintMessage(mesmaMensagem, { stage: 'FUP_1', voice: noLinkedin });
  const noMail = lintMessage(mesmaMensagem, { stage: 'FUP_1', voice: noEmail });
  assert.ok(naDm.errors.some((e) => /max 300/.test(e)), 'na DM, 500 chars estoura');
  assert.deepEqual(noMail.errors, [], 'no e-mail, os mesmos 500 chars passam');
});

test('a negative answer to the sign-off does not become a sign-off', () => {
  for (const resposta of ['no', 'não', 'nope', 'none', '-', '']) {
    const cfg = toVoiceConfig({ ...ANSWERS, signoff: resposta });
    assert.equal(cfg.signoff, null, `"${resposta}" deveria virar null`);
  }
  assert.equal(toVoiceConfig({ ...ANSWERS, signoff: 'Best, Sam' }).signoff, 'Best, Sam');
});

test('impeccable grammar turns on the rule that human grammar turns off', () => {
  const solta = toVoiceConfig({ ...ANSWERS, grammar: 'human' });
  const limpa = toVoiceConfig({ ...ANSWERS, grammar: 'impeccable' });
  assert.equal(solta.allowHumanSlip, true);
  assert.equal(solta.requireCleanGrammar, false);
  assert.equal(limpa.allowHumanSlip, false);
  assert.equal(limpa.requireCleanGrammar, true);
});

test('the words the person never says reach the lint as banned', () => {
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const r = lintMessage('quick thought on synergy here', { stage: 'FUP_1', voice });
  assert.ok(r.errors.some((e) => /synergy/.test(e)));
});

test('the interview voice does NOT inherit the taste of any other operator', () => {
  // Regression: "Hey" and the word "leads" were once banned for everybody because they
  // were one person's rule. Whoever did not ask for that should not inherit it.
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const r = lintMessage('Hey Ana, quick question about your inbound leads', { stage: 'FUP_1', voice });
  assert.deepEqual(r.errors, []);
});

// ─── a persona ────────────────────────────────────────────────────────────────
test('the persona keeps the real sample and the story, which is the part nobody copies', () => {
  const md = renderPersona(ANSWERS, toVoiceConfig(ANSWERS));
  assert.match(md, /# Operator — sam/);
  assert.match(md, /saw you shipped the audit/);
  assert.match(md, /Naples/);
  assert.match(md, /- em dashes/);
  assert.match(md, /Opens with: Hey Ana,/);
});

// ─── tela 5 ───────────────────────────────────────────────────────────────────
test('the spreadsheet template screen 5 shows is the same one the reader accepts', () => {
  const r = readLeads({ text: TEMPLATE_CSV });
  assert.deepEqual(r.errors, []);
  assert.ok(r.leads.length >= 2);
});
