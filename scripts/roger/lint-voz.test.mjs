import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  lintMessage, checkBatchDuplicates,
  checkPlaceholders, checkMarkdownLeak, checkDeadCorporate, checkQuestionCount, checkLength,
  checkDashes, checkGreeting, checkEmoji, checkExclamation, checkBannedList,
  checkVanityMetrics, checkSignoff, checkCallCta,
} from './lint-voz.mjs';
import { loadVoice, resolveVoice, NEUTRAL_VOICE } from './lib/voice.mjs';

const NEUTRAL = resolveVoice(null);
const FIXTURES = new URL('./fixtures-lint/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));

function voiceFile(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'roger-voice-'));
  const p = join(dir, 'voice.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

const codes = (findings) => findings.map((f) => f.code);

// ─── O TESTE QUE JUSTIFICA O BLOCO B ─────────────────────────────────────────
// Mesma mensagem, duas vozes opostas, vereditos opostos. Se isto passa, a voz
// deixou de ser constante de código e virou dado de quem assina.
test('a MESMA mensagem passa numa voz e falha na outra', () => {
  const msg = 'saw the audit you shipped — sharp move. how are you handling the reruns?';

  const semTravessao = resolveVoice({ banEmDash: true });
  const comTravessao = resolveVoice({ banEmDash: false });

  const a = lintMessage(msg, { stage: 'FUP_2', voice: semTravessao });
  const b = lintMessage(msg, { stage: 'FUP_2', voice: comTravessao });

  assert.ok(a.errors.length > 0, 'quem bane travessão tem que reprovar');
  assert.ok(codes(a.findings).includes('em-dash'));
  assert.equal(b.errors.length, 0, 'quem usa travessão tem que aprovar a mesma mensagem');
});

test('vozes opostas divergem também em saudação, emoji e exclamação', () => {
  const msg = 'Hey Ana! quick thought on the launch 🙂';
  const dura = resolveVoice({ banFormalGreeting: true, banEmoji: true, banExclamation: true });
  const solta = resolveVoice({});

  const a = lintMessage(msg, { stage: 'FUP_1', voice: dura });
  const b = lintMessage(msg, { stage: 'FUP_1', voice: solta });

  assert.deepEqual(codes(a.findings).sort(), ['emoji', 'exclamation', 'formal-greeting']);
  assert.equal(b.errors.length, 0);
});

// ─── universal: vale para qualquer voz, inclusive a neutra ───────────────────
test('placeholder não substituído reprova até na voz neutra', () => {
  const r = lintMessage('hi [firstname], quick one', { stage: 'FUP_1', voice: NEUTRAL });
  assert.ok(codes(r.findings).includes('placeholder'));
});

test('markdown, pipe, blockquote e bullet reprovam na voz neutra', () => {
  assert.ok(codes(checkMarkdownLeak('**bold** leaking')).includes('markdown'));
  assert.ok(codes(checkMarkdownLeak('a | b')).includes('pipe'));
  assert.ok(codes(checkMarkdownLeak('> quoted')).includes('blockquote'));
  assert.ok(codes(checkMarkdownLeak('- item')).includes('bullets'));
});

test('corporativês morto reprova na voz neutra', () => {
  const r = lintMessage('I hope this finds you well, just checking in', { stage: 'FUP_2', voice: NEUTRAL });
  assert.ok(r.errors.length >= 2);
  assert.ok(codes(r.findings).every((c) => c === 'dead-corporate' || c === 'short'));
});

test('mais de uma pergunta reprova, e o limite é configurável', () => {
  const msg = 'why now? and who owns it?';
  assert.equal(checkQuestionCount(msg, NEUTRAL).length, 1);
  assert.equal(checkQuestionCount(msg, resolveVoice({ maxQuestions: 2 })).length, 0);
  // `false` desliga; `null` significa "não declarei" e mantém o padrão de 1.
  assert.equal(checkQuestionCount(msg, resolveVoice({ maxQuestions: false })).length, 0);
  assert.equal(checkQuestionCount(msg, resolveVoice({ maxQuestions: null })).length, 1);
});

test('cap de tamanho usa o valor da voz e distingue connection', () => {
  const longa = 'x'.repeat(700);
  assert.ok(codes(checkLength(longa, NEUTRAL, { isConnection: false })).includes('too-long'));
  const curta = 'x'.repeat(350);
  assert.ok(codes(checkLength(curta, NEUTRAL, { isConnection: true })).includes('too-long'));
  assert.equal(checkLength(curta, NEUTRAL, { isConnection: false }).length, 0);
});

// ─── checks da pessoa, isolados ───────────────────────────────────────────────
test('cada check de gosto é no-op quando a voz não pede', () => {
  const msg = 'Hey! isto tem — travessão, emoji 🙂 e a palavra leads. 14M impressions. Best, Sam';
  const flags = { stage: 'FUP_1', isFirstTouch: false, isConnection: false, isConversation: false, isFup: true };
  assert.deepEqual(checkDashes(msg, NEUTRAL), []);
  assert.deepEqual(checkGreeting(msg, NEUTRAL), []);
  assert.deepEqual(checkEmoji(msg, NEUTRAL, flags), []);
  assert.deepEqual(checkExclamation(msg, NEUTRAL), []);
  assert.deepEqual(checkBannedList(msg, NEUTRAL), []);
  assert.deepEqual(checkVanityMetrics(msg, NEUTRAL), []);
  assert.deepEqual(checkSignoff(msg, NEUTRAL, flags), []);
  assert.deepEqual(checkCallCta(msg, NEUTRAL, flags), []);
});

test('palavra banida casa palavra inteira, não pedaço', () => {
  const voice = resolveVoice({ bannedWords: ['lift'] });
  assert.equal(checkBannedList('a big lift here', voice).length, 1);
  assert.equal(checkBannedList('we are lifting weights', voice).length, 0);
});

test('assinatura só é barrada nos stages fora da lista permitida', () => {
  const voice = resolveVoice({ signoff: 'Best, Sam', signoffAllowedStages: ['inicial'] });
  assert.equal(checkSignoff('tudo certo. Best, Sam', voice, { stage: 'FUP_3' }).length, 1);
  assert.equal(checkSignoff('tudo certo. Best, Sam', voice, { stage: 'MENSAGEM_INICIAL' }).length, 0);
  assert.equal(checkSignoff('sem assinatura aqui', voice, { stage: 'FUP_3' }).length, 0);
});

test('CTA de call: proibido onde a voz proíbe, avisado onde a voz espera', () => {
  const voice = resolveVoice({
    callCta: { bannedIn: ['connection'], warnIfMissingIn: ['inicial'], minCharsForWarn: 10 },
  });
  const pedindo = 'worth a quick call this week?';
  assert.ok(codes(checkCallCta(pedindo, voice, { stage: 'connection' })).includes('call-cta'));
  assert.equal(checkCallCta(pedindo, voice, { stage: 'MENSAGEM_INICIAL' }).length, 0);
  const semPedir = 'só queria deixar o contexto aqui, sem pressa nenhuma';
  assert.ok(codes(checkCallCta(semPedir, voice, { stage: 'MENSAGEM_INICIAL' })).includes('no-call-cta'));
});

// ─── a voz declarada do operador: a regressão do comportamento antigo ────────
test('a voz do operador reprova o que uma voz declarada tem que reprovar', () => {
  const { voice, source } = loadVoice('example');
  assert.equal(source, 'file', 'rapport/operators/example/voice.json tem que existir');

  const ruim = 'I hope this finds you well. We drove 14M impressions for a synergy play, at your earliest convenience.';
  const r = lintMessage(ruim, { stage: 'MENSAGEM_INICIAL', voice });
  const c = codes(r.findings);
  assert.ok(c.includes('dead-corporate'), 'corporativês morto é universal');
  assert.ok(c.includes('banned-word'), 'synergy está na lista desta voz');
  assert.ok(c.includes('banned-phrase'), 'a frase está na lista desta voz');
  assert.ok(c.includes('vanity'), 'esta voz bane métrica de vaidade');

  const assinaturaEmFup = lintMessage('just a thought here. Best, Sam', { stage: 'FUP_3', voice });
  assert.ok(codes(assinaturaEmFup.findings).includes('signoff'));
});

// ─── fixtures ─────────────────────────────────────────────────────────────────
test('fixture pass passa na voz do operador', () => {
  const { voice } = loadVoice('example');
  for (const lead of fixture('pass.json').leads) {
    const { errors } = lintMessage(lead.msg, { stage: lead.stage, voice });
    assert.deepEqual(errors, [], `#${lead.n} deveria passar: ${errors.join(' · ')}`);
  }
});

test('fixture fail falha na voz do operador', () => {
  const { voice } = loadVoice('example');
  for (const lead of fixture('fail.json').leads) {
    const { errors } = lintMessage(lead.msg, { stage: lead.stage, voice });
    assert.ok(errors.length > 0, `#${lead.n} deveria falhar`);
  }
});

test('fixtures de conversation seguem o mesmo veredito', () => {
  const { voice } = loadVoice('example');
  for (const lead of fixture('conversation-pass.json').leads) {
    const { errors } = lintMessage(lead.msg, { stage: lead.stage, voice });
    assert.deepEqual(errors, [], `#${lead.n} deveria passar: ${errors.join(' · ')}`);
  }
  for (const lead of fixture('conversation-fail.json').leads) {
    const { errors } = lintMessage(lead.msg, { stage: lead.stage, voice });
    assert.ok(errors.length > 0, `#${lead.n} deveria falhar`);
  }
});

test('as fixtures só usam empresas fictícias declaradas aqui', () => {
  // Garantia pela positiva: em vez de listar nomes reais proibidos (que os traria para
  // dentro deste arquivo), toda empresa citada nas fixtures tem de estar nesta lista.
  const ficticias = new Set(['AcmeRWA', 'MidInfra', 'BadCo', 'FupSign', 'NorthPay', 'KapitalFO', 'AgencyTrap']);
  for (const f of ['pass.json', 'fail.json', 'conversation-pass.json', 'conversation-fail.json']) {
    for (const lead of JSON.parse(readFileSync(new URL(f, FIXTURES), 'utf8')).leads) {
      assert.ok(ficticias.has(lead.co), `${f}: "${lead.co}" não está na lista de fictícias`);
    }
  }
});

// ─── anti-blast ───────────────────────────────────────────────────────────────
test('duas mensagens quase iguais no lote são pegas', () => {
  const items = [
    { n: 1, co: 'A', msg: 'saw the launch last week, how are you handling the rollout?' },
    { n: 2, co: 'B', msg: 'saw the launch last week, how are you handling the rollout!' },
    { n: 3, co: 'C', msg: 'completamente diferente, outra ideia, outro assunto aqui' },
  ];
  const issues = checkBatchDuplicates(items);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /#1 \(A\) e #2 \(B\)/);
});

test('threshold do anti-blast é configurável', () => {
  const items = [
    { n: 1, co: 'A', msg: 'aaaaaaaaaabbbbb' },
    { n: 2, co: 'B', msg: 'aaaaaaaaaaccccc' },
  ];
  assert.equal(checkBatchDuplicates(items, 0.9).length, 0);
  assert.equal(checkBatchDuplicates(items, 0.5).length, 1);
});

// ─── carregamento da voz ──────────────────────────────────────────────────────
test('operador sem arquivo cai no neutro e diz de onde veio', () => {
  const r = loadVoice('ninguem-com-esse-nome');
  assert.equal(r.source, 'defaults');
  assert.equal(r.error, null);
  assert.deepEqual(r.voice.bannedWords, []);
});

test('voice.json quebrado não passa em silêncio', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roger-voice-bad-'));
  const p = join(dir, 'voice.json');
  writeFileSync(p, '{ isto não é json');
  const r = loadVoice('qualquer', { path: p });
  assert.equal(r.source, 'invalid');
  assert.match(r.error, /voice\.json inválido/);
});

test('resolveVoice preenche o que falta e respeita o que veio', () => {
  const v = resolveVoice({ banEmDash: true, caps: { connection: 200 } });
  assert.equal(v.banEmDash, true);
  assert.equal(v.caps.connection, 200);
  assert.equal(v.caps.default, NEUTRAL_VOICE.caps.default);
  assert.equal(v.banEmoji, false);
});

test('maxChars da entrevista virou o cap default', () => {
  const v = resolveVoice({ maxChars: 420 });
  assert.equal(v.caps.default, 420);
});

test('voz lida de arquivo pelo caminho injetado', () => {
  const p = voiceFile({ banEmDash: true, bannedWords: ['synergy'] });
  const r = loadVoice('seja-quem-for', { path: p });
  assert.equal(r.source, 'file');
  assert.equal(r.voice.banEmDash, true);
  assert.deepEqual(r.voice.bannedWords, ['synergy']);
});
