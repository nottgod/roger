import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decide, detectBlock, recipientMatches, alreadyReplied, wroteFirst, isDuplicate,
  pauseMs, createBreaker,
} from './send-gates.mjs';

const ok = { hasMessageChannel: true, isInMailComposer: false, recipientName: 'Ana Ribeiro', bubbles: [], url: 'https://www.linkedin.com/messaging/thread/1' };
const touch = { recipient: 'Ana Ribeiro', text: 'saw the audit. how are the reruns going?', approved: true };

test('o caminho feliz passa', () => {
  const r = decide(ok, touch);
  assert.equal(r.ok, true);
});

// ─── A ARMADILHA QUE NÃO SE COPIA ────────────────────────────────────────────
test('o texto do LEAD nunca dispara bloqueio', () => {
  // Na referência a detecção varria a página inteira, e o texto do lead está nela:
  // um lead escrevendo "captcha" derrubava a rodada.
  const bubbles = [{ fromMe: false, text: 'tive que resolver um captcha aqui, atividade incomum no meu banco' }];
  assert.equal(detectBlock({ url: ok.url, bannerText: '' }).ok, true);
  const r = decide({ ...ok, bubbles }, touch);
  assert.notEqual(r.code, 'blocked', 'o motivo pode ser outro, mas nunca bloqueio');
});

test('bloqueio vem de URL ou banner da plataforma', () => {
  assert.equal(detectBlock({ url: 'https://www.linkedin.com/checkpoint/challenge' }).ok, false);
  assert.equal(detectBlock({ url: 'https://www.linkedin.com/authwall' }).ok, false);
  assert.equal(detectBlock({ bannerText: 'We noticed some unusual activity' }).ok, false);
  assert.equal(detectBlock({ bannerText: "You've reached the weekly invitation limit" }).ok, false);
  assert.match(detectBlock({ url: '/checkpoint/' }).reason, /a rodada encerra/);
});

// ─── destinatário ─────────────────────────────────────────────────────────────
test('nome completo casa; primeiro nome sozinho não basta', () => {
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Ribeiro'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'ana ribeiro'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Ribeiro Souza'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Costa'), false, 'homônimo de primeiro nome não passa');
  assert.equal(recipientMatches('Ana Ribeiro', ''), false);
  assert.equal(recipientMatches('', 'Ana'), false);
});

test('destinatário não confirmado recusa (falha fechada)', () => {
  const r = decide({ ...ok, recipientName: 'Ana Costa' }, touch);
  assert.equal(r.code, 'recipient-mismatch');
  assert.match(r.reason, /esperava "Ana Ribeiro"/);
});

test('tela sem nome de destinatário também recusa', () => {
  assert.equal(decide({ ...ok, recipientName: null }, touch).code, 'recipient-mismatch');
});

// ─── canal e InMail ───────────────────────────────────────────────────────────
test('perfil sem canal de mensagem é questão de conexão, não de conteúdo', () => {
  const r = decide({ ...ok, hasMessageChannel: false }, touch);
  assert.equal(r.code, 'no-message-channel');
});

test('compositor pago não envia', () => {
  const r = decide({ ...ok, isInMailComposer: true }, touch);
  assert.equal(r.code, 'inmail');
  assert.match(r.reason, /crédito/);
});

// ─── estado da conversa ───────────────────────────────────────────────────────
test('respondeu = mensagem dele depois do nosso primeiro toque, mesmo que a última seja nossa', () => {
  const bubbles = [
    { fromMe: true, text: 'primeiro toque' },
    { fromMe: false, text: 'interessante, me conta mais' },
    { fromMe: true, text: 'claro, segue' },
  ];
  assert.equal(alreadyReplied(bubbles), true);
  assert.equal(decide({ ...ok, bubbles }, touch).code, 'already-replied');
});

test('só nossas mensagens não é resposta', () => {
  assert.equal(alreadyReplied([{ fromMe: true, text: 'a' }, { fromMe: true, text: 'b' }]), false);
});

test('ele escreveu primeiro vira conversa, não outbound', () => {
  const bubbles = [{ fromMe: false, text: 'oi, vi seu perfil e queria te vender algo' }];
  assert.equal(wroteFirst(bubbles), true);
  const r = decide({ ...ok, bubbles }, touch);
  assert.equal(r.code, 'wrote-first');
});

test('thread ilegível recusa: "não sei ler" nunca é "está vazia"', () => {
  const r = decide({ ...ok, bubbles: null }, touch);
  assert.equal(r.code, 'unreadable-thread');
  assert.match(r.reason, /nunca é "está vazia"/);
});

test('thread vazia de verdade passa', () => {
  assert.equal(decide({ ...ok, bubbles: [] }, touch).ok, true);
});

// ─── duplicata ────────────────────────────────────────────────────────────────
test('texto que já está na conversa não vai de novo', () => {
  const bubbles = [{ fromMe: true, text: 'saw the audit. how are the reruns going?' }];
  assert.equal(isDuplicate(bubbles, touch.text), true);
  assert.equal(decide({ ...ok, bubbles }, touch).code, 'duplicate');
});

test('duplicata ignora diferença de caixa e espaço', () => {
  assert.equal(isDuplicate([{ fromMe: true, text: 'SAW   the Audit. How are the reruns going?' }], touch.text), true);
});

test('texto diferente não é duplicata', () => {
  assert.equal(isDuplicate([{ fromMe: true, text: 'outra coisa completamente' }], touch.text), false);
});

// ─── aprovação e vazio ────────────────────────────────────────────────────────
test('toque não aprovado não sai, nem com tudo mais em ordem', () => {
  const r = decide(ok, { ...touch, approved: false });
  assert.equal(r.code, 'not-approved');
});

test('texto vazio não sai', () => {
  assert.equal(decide(ok, { ...touch, text: '   ' }).code, 'empty');
});

// ─── ritmo, teto e janela ─────────────────────────────────────────────────────
test('teto atingido recusa antes de qualquer coisa da tela', () => {
  const r = decide({}, touch, { capReached: true });
  assert.equal(r.code, 'cap-reached');
  assert.match(r.reason, /não se repõe/);
});

test('um toque por lead por dia', () => {
  assert.equal(decide(ok, touch, { alreadyTouchedToday: true }).code, 'same-day');
});

test('fora da janela: adiantado não sai', () => {
  assert.equal(decide(ok, touch, { outsideWindow: true }).code, 'window');
});

test('bloqueio da plataforma vence até o teto', () => {
  const r = decide({ url: '/checkpoint/' }, touch, { capReached: true });
  assert.equal(r.code, 'blocked');
});

test('pausa é aleatória dentro da faixa', () => {
  assert.equal(pauseMs(() => 0, { minMs: 30_000, maxMs: 120_000 }), 30_000);
  assert.equal(pauseMs(() => 0.999999, { minMs: 30_000, maxMs: 120_000 }), 119_999);
  const v = pauseMs(Math.random, { minMs: 1000, maxMs: 2000 });
  assert.ok(v >= 1000 && v <= 2000);
});

test('disjuntor abre em três falhas seguidas e zera no sucesso', () => {
  const b = createBreaker(3);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), true, 'terceira falha abre');
  assert.equal(b.tripped, true);
  b.ok();
  assert.equal(b.streak, 0);
  assert.equal(b.tripped, false);
});
