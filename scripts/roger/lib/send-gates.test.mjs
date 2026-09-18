import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decide, detectBlock, recipientMatches, alreadyReplied, wroteFirst, isDuplicate,
  pauseMs, createBreaker,
} from './send-gates.mjs';

const ok = { hasMessageChannel: true, isInMailComposer: false, recipientName: 'Ana Ribeiro', bubbles: [], url: 'https://www.linkedin.com/messaging/thread/1' };
const touch = { recipient: 'Ana Ribeiro', text: 'saw the audit. how are the reruns going?', approved: true };

test('the happy path passes', () => {
  const r = decide(ok, touch);
  assert.equal(r.ok, true);
});

// ─── THE TRAP NOT WORTH COPYING ──────────────────────────────────────────────
test('the LEAD own words never trigger a block', () => {
  // In the reference, detection swept the whole page, and the lead own text is in it:
  // um lead escrevendo "captcha" derrubava a rodada.
  const bubbles = [{ fromMe: false, text: 'tive que resolver um captcha aqui, atividade incomum no meu banco' }];
  assert.equal(detectBlock({ url: ok.url, bannerText: '' }).ok, true);
  const r = decide({ ...ok, bubbles }, touch);
  assert.notEqual(r.code, 'blocked', 'o motivo pode ser outro, mas nunca bloqueio');
});

test('a block comes from the URL or a platform banner', () => {
  assert.equal(detectBlock({ url: 'https://www.linkedin.com/checkpoint/challenge' }).ok, false);
  assert.equal(detectBlock({ url: 'https://www.linkedin.com/authwall' }).ok, false);
  assert.equal(detectBlock({ bannerText: 'We noticed some unusual activity' }).ok, false);
  assert.equal(detectBlock({ bannerText: "You've reached the weekly invitation limit" }).ok, false);
  assert.match(detectBlock({ url: '/checkpoint/' }).reason, /the run ends/);
});

// ─── recipient ────────────────────────────────────────────────────────────────
test('the full name matches; a first name alone is not enough', () => {
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Ribeiro'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'ana ribeiro'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Ribeiro Souza'), true);
  assert.equal(recipientMatches('Ana Ribeiro', 'Ana Costa'), false, 'homônimo de primeiro nome não passa');
  assert.equal(recipientMatches('Ana Ribeiro', ''), false);
  assert.equal(recipientMatches('', 'Ana'), false);
});

test('an unconfirmed recipient refuses (fails closed)', () => {
  const r = decide({ ...ok, recipientName: 'Ana Costa' }, touch);
  assert.equal(r.code, 'recipient-mismatch');
  assert.match(r.reason, /expected "Ana Ribeiro"/);
});

test('a screen with no recipient name also refuses', () => {
  assert.equal(decide({ ...ok, recipientName: null }, touch).code, 'recipient-mismatch');
});

// ─── canal e InMail ───────────────────────────────────────────────────────────
test('a profile with no message channel is a connection problem, not a content one', () => {
  const r = decide({ ...ok, hasMessageChannel: false }, touch);
  assert.equal(r.code, 'no-message-channel');
});

test('the paid composer does not send', () => {
  const r = decide({ ...ok, isInMailComposer: true }, touch);
  assert.equal(r.code, 'inmail');
  assert.match(r.reason, /credit/);
});

// ─── estado da conversa ───────────────────────────────────────────────────────
test('replied = a message from them after our first touch, even if the last one is ours', () => {
  const bubbles = [
    { fromMe: true, text: 'primeiro toque' },
    { fromMe: false, text: 'interessante, me conta mais' },
    { fromMe: true, text: 'claro, segue' },
  ];
  assert.equal(alreadyReplied(bubbles), true);
  assert.equal(decide({ ...ok, bubbles }, touch).code, 'already-replied');
});

test('only our own messages is not a reply', () => {
  assert.equal(alreadyReplied([{ fromMe: true, text: 'a' }, { fromMe: true, text: 'b' }]), false);
});

test('they wrote first, so it is a conversation, not outbound', () => {
  const bubbles = [{ fromMe: false, text: 'oi, vi seu perfil e queria te vender algo' }];
  assert.equal(wroteFirst(bubbles), true);
  const r = decide({ ...ok, bubbles }, touch);
  assert.equal(r.code, 'wrote-first');
});

test('an unreadable thread refuses: cannot read is never the same as empty', () => {
  const r = decide({ ...ok, bubbles: null }, touch);
  assert.equal(r.code, 'unreadable-thread');
  assert.match(r.reason, /never the same as empty/);
});

test('a genuinely empty thread passes', () => {
  assert.equal(decide({ ...ok, bubbles: [] }, touch).ok, true);
});

// ─── duplicata ────────────────────────────────────────────────────────────────
test('text already in the conversation does not go again', () => {
  const bubbles = [{ fromMe: true, text: 'saw the audit. how are the reruns going?' }];
  assert.equal(isDuplicate(bubbles, touch.text), true);
  assert.equal(decide({ ...ok, bubbles }, touch).code, 'duplicate');
});

test('duplicate detection ignores case and whitespace', () => {
  assert.equal(isDuplicate([{ fromMe: true, text: 'SAW   the Audit. How are the reruns going?' }], touch.text), true);
});

test('different text is not a duplicate', () => {
  assert.equal(isDuplicate([{ fromMe: true, text: 'outra coisa completamente' }], touch.text), false);
});

// ─── approval and emptiness ───────────────────────────────────────────────────
test('an unapproved touch does not go, even with everything else in order', () => {
  const r = decide(ok, { ...touch, approved: false });
  assert.equal(r.code, 'not-approved');
});

test('empty text does not go', () => {
  assert.equal(decide(ok, { ...touch, text: '   ' }).code, 'empty');
});

// ─── ritmo, teto e janela ─────────────────────────────────────────────────────
test('a reached cap refuses before anything on the screen', () => {
  const r = decide({}, touch, { capReached: true });
  assert.equal(r.code, 'cap-reached');
  assert.match(r.reason, /cannot be replaced/);
});

test('one touch per lead per day', () => {
  assert.equal(decide(ok, touch, { alreadyTouchedToday: true }).code, 'same-day');
});

test('outside the window: too early does not go', () => {
  assert.equal(decide(ok, touch, { outsideWindow: true }).code, 'window');
});

test('a platform block outranks even the cap', () => {
  const r = decide({ url: '/checkpoint/' }, touch, { capReached: true });
  assert.equal(r.code, 'blocked');
});

test('the pause is random within the range', () => {
  assert.equal(pauseMs(() => 0, { minMs: 30_000, maxMs: 120_000 }), 30_000);
  assert.equal(pauseMs(() => 0.999999, { minMs: 30_000, maxMs: 120_000 }), 119_999);
  const v = pauseMs(Math.random, { minMs: 1000, maxMs: 2000 });
  assert.ok(v >= 1000 && v <= 2000);
});

test('the circuit breaker opens after three failures in a row and resets on success', () => {
  const b = createBreaker(3);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), false);
  assert.equal(b.fail(), true, 'terceira falha abre');
  assert.equal(b.tripped, true);
  b.ok();
  assert.equal(b.streak, 0);
  assert.equal(b.tripped, false);
});
