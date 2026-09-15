// Testes do onboarding — o contrato entre a ENTREVISTA e o resto do motor.
//
// O risco que estes testes cobrem: a entrevista gerar arquivos bonitos que nenhum
// carregador entende. Se o icp.md que sai da tela 4 não parseia no score.mjs, ou se o
// voice.json da tela 3 não muda o veredito do lint, as telas são decorativas.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toVoiceConfig, renderPersona, renderIcp } from './onboarding.mjs';
import { loadIcp, classify } from './score.mjs';
import { resolveVoice } from './lib/voice.mjs';
import { lintMessage } from './lint-voz.mjs';
import { readLeads, TEMPLATE_CSV } from './lib/leads-file.mjs';

// Uma pessoa qualquer: vende software de reconciliação para fintechs,
// escreve solto, sem travessão, mensagem curta.
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

// ─── tela 4: o icp.md gerado é lido pelo score.mjs ───────────────────────────
test('o icp.md que a entrevista gera parseia inteiro, sem tabela faltando', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.deepEqual(icp.missing, [], `faltando: ${icp.missing.join(', ')}`);
  assert.equal(icp.source, 'inline');
});

test('os números da entrevista chegam nos gates', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.equal(icp.numbers.headcount_min, 20);
  assert.equal(icp.numbers.headcount_max, 400);
  assert.equal(icp.numbers.budget_floor_usd_month, 1500);
});

test('geografia aceita e descartada saem da resposta, com apelido', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.ok(icp.geoAccept.has('united states'));
  assert.ok(icp.geoAccept.has('united-states'), 'o slug também casa');
  assert.ok(icp.geoAccept.has('germany'));
  assert.ok(icp.geoDiscard.has('russia'));
});

test('segmentos e passes automáticos viram tabela', () => {
  const icp = loadIcp({ text: renderIcp(ANSWERS) });
  assert.equal(icp.segments.get('payments').cluster, 'payments');
  assert.equal(icp.segments.get('neobanks').approach, 'Contextual');
  assert.ok(icp.nonIcp.has('crypto-exchanges'));
  assert.ok(icp.nonIcp.has('consumer-apps'));
});

test('o ICP da entrevista decide de verdade: passa, descarta por tamanho e por país', () => {
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

test('entrevista respondida no vazio ainda gera um icp.md válido', () => {
  // O caso "apertei enter em tudo". O arquivo tem que nascer parseável mesmo assim,
  // senão o primeiro contato da pessoa é um erro de parse.
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
test('a voz da entrevista reprova o que ela disse que não usa', () => {
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const comTravessao = lintMessage('saw the launch — how is the rollout going?', { stage: 'FUP_2', voice });
  assert.ok(comTravessao.errors.some((e) => /em-dash/.test(e)));

  const semTravessao = lintMessage('saw the launch. how is the rollout going?', { stage: 'FUP_2', voice });
  assert.deepEqual(semTravessao.errors, []);
});

test('o teto de tamanho depende do CANAL, não só do "curta/média/longa"', () => {
  // A mesma resposta "curta" significa coisas diferentes: uma DM curta é bem menor
  // que um e-mail curto. Antes os dois davam 420 e a Roger liberava DM gigante.
  const noLinkedin = resolveVoice(toVoiceConfig({ ...ANSWERS, channels: 'linkedin' }));
  const noEmail = resolveVoice(toVoiceConfig({ ...ANSWERS, channels: 'email' }));
  assert.equal(noLinkedin.caps.default, 300);
  assert.equal(noEmail.caps.default, 600);

  const mesmaMensagem = 'x'.repeat(500);
  const naDm = lintMessage(mesmaMensagem, { stage: 'FUP_1', voice: noLinkedin });
  const noMail = lintMessage(mesmaMensagem, { stage: 'FUP_1', voice: noEmail });
  assert.ok(naDm.errors.some((e) => /máx 300/.test(e)), 'na DM, 500 chars estoura');
  assert.deepEqual(noMail.errors, [], 'no e-mail, os mesmos 500 chars passam');
});

test('resposta negativa na assinatura não vira assinatura', () => {
  for (const resposta of ['no', 'não', 'nope', 'none', '-', '']) {
    const cfg = toVoiceConfig({ ...ANSWERS, signoff: resposta });
    assert.equal(cfg.signoff, null, `"${resposta}" deveria virar null`);
  }
  assert.equal(toVoiceConfig({ ...ANSWERS, signoff: 'Best, Sam' }).signoff, 'Best, Sam');
});

test('gramática impecável liga a regra que a gramática humana desliga', () => {
  const solta = toVoiceConfig({ ...ANSWERS, grammar: 'human' });
  const limpa = toVoiceConfig({ ...ANSWERS, grammar: 'impeccable' });
  assert.equal(solta.allowHumanSlip, true);
  assert.equal(solta.requireCleanGrammar, false);
  assert.equal(limpa.allowHumanSlip, false);
  assert.equal(limpa.requireCleanGrammar, true);
});

test('as palavras que a pessoa não diz chegam ao lint como banidas', () => {
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const r = lintMessage('quick thought on synergy here', { stage: 'FUP_1', voice });
  assert.ok(r.errors.some((e) => /synergy/.test(e)));
});

test('a voz da entrevista NÃO herda o gosto de nenhum outro operador', () => {
  // Regressão: "Hey" e a palavra "leads" já foram proibidas para todo mundo porque
  // eram a regra de uma pessoa só. Quem não pediu isso não deve levar.
  const voice = resolveVoice(toVoiceConfig(ANSWERS));
  const r = lintMessage('Hey Ana, quick question about your inbound leads', { stage: 'FUP_1', voice });
  assert.deepEqual(r.errors, []);
});

// ─── a persona ────────────────────────────────────────────────────────────────
test('a persona guarda a amostra real e a história, que é a parte que ninguém copia', () => {
  const md = renderPersona(ANSWERS, toVoiceConfig(ANSWERS));
  assert.match(md, /# Operator — sam/);
  assert.match(md, /saw you shipped the audit/);
  assert.match(md, /Naples/);
  assert.match(md, /- em dashes/);
  assert.match(md, /Opens with: Hey Ana,/);
});

// ─── tela 5 ───────────────────────────────────────────────────────────────────
test('o modelo de planilha que a tela 5 mostra é o mesmo que o leitor aceita', () => {
  const r = readLeads({ text: TEMPLATE_CSV });
  assert.deepEqual(r.errors, []);
  assert.ok(r.leads.length >= 2);
});
