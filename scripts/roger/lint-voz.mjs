#!/usr/bin/env node
// The hard voice guard — blocks (exit 1) any message that breaks the mechanical rules.
// It runs BEFORE any message reaches the point of being sent.
//
// Two categories, and the difference between them is the point of this file:
//
//   UNIVERSAL — bad in any voice (an unreplaced placeholder, markdown leaking through,
//               dead corporate speak, a message over the limit). Not configurable.
//   YOURS     — the taste of whoever signs it (dashes, "Hey", emoji, words they never
//               use, the sign-off, the CTA). It comes from rapport/operators/<slug>/
//               voice.json, which the voice interview writes. With no file, those rules
//               stay OFF and the CLI says so — the guard never loosens in silence.
//
// Usage:
//   node lint-voz.mjs batch-2026-06-10.json --operator example
//   echo "some text" | node lint-voz.mjs --stage FUP_2 --operator example
//
// Every check is an exported function, testable on its own (lint-voz.test.mjs).

import { readFileSync } from 'node:fs';
import { loadVoice } from './lib/voice.mjs';

// ── universal: dead corporate speak ───────────────────────────────────────────
// Phrases that give away a template in any sales language, for any operator.
export const DEAD_CORPORATE = [
  "i'd love to", 'i hope this finds you', 'hope this finds you', 'synergy', 'synergies',
  'value proposition', 'looking forward to', 'best regards', 'touch base',
  'reach out to you', 'just checking in', 'wanted to reach out', 'following up',
  'came across your profile', 'came across your', 'we help companies like',
  'explore synergies',
];

// Placeholders left unreplaced. Sending one of these is the cheapest mistake to avoid.
export const PLACEHOLDERS = ['[firstname]', '[company]', '[name]', '{nome}', '{name}', '{company}'];

const VANITY_METRIC = /\d+\s*(?:million|m|k)?\s*impressions\b/i;
const ENGAGEMENT_RATE = /\d+\s*%\s*engagement\b/i;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

const err = (code, message) => ({ level: 'error', code, message });
const warn = (code, message) => ({ level: 'warn', code, message });

function stageFlags(stage) {
  const s = String(stage || '');
  return {
    stage: s,
    isFup: /^FUP/i.test(s),
    isConnection: /connection|conex/i.test(s),
    isFirstTouch: /inicial|mensagem_inicial|^mi$|connection|conex/i.test(s),
    isConversation: /conversa|conversation/i.test(s),
  };
}

function wordRe(word) {
  return new RegExp(`\\b${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

// ── universal checks ──────────────────────────────────────────────────────────
export function checkPlaceholders(msg) {
  const lower = msg.toLowerCase();
  return PLACEHOLDERS.filter((p) => lower.includes(p))
    .map((p) => err('placeholder', `placeholder não substituído: "${p}"`));
}

export function checkMarkdownLeak(msg) {
  const out = [];
  if (/\*\*|##|```/.test(msg)) out.push(err('markdown', 'markdown (** ## ```) vazando no texto de envio'));
  if (msg.includes('|')) out.push(err('pipe', 'a pipe (|) does not belong in a message'));
  if (/^>/m.test(msg)) out.push(err('blockquote', 'a blockquote (>) does not belong in a message'));
  if (/^\s*[-*•]\s+/m.test(msg)) out.push(err('bullets', 'a bullet list does not belong in a message'));
  return out;
}

export function checkDeadCorporate(msg) {
  const lower = msg.toLowerCase();
  return DEAD_CORPORATE.filter((p) => lower.includes(p))
    .map((p) => err('dead-corporate', `dead sales phrase: "${p}"`));
}

export function checkQuestionCount(msg, voice) {
  // `false` turns the check off on purpose. `null`/absent = never declared, use the default.
  if (voice.maxQuestions === false) return [];
  const max = voice.maxQuestions ?? 1;
  const n = (msg.match(/\?/g) || []).length;
  if (n > max) return [err('questions', `${n} perguntas na mensagem, máx ${max}`)];
  return [];
}

export function checkLength(msg, voice, flags) {
  const out = [];
  const len = msg.length;
  const cap = flags.isConnection ? (voice.caps?.connection ?? 300) : (voice.caps?.default ?? voice.maxChars ?? 600);
  if (cap && len > cap) {
    out.push(err('too-long', `message is ${len} chars (max ${cap}${flags.isConnection ? ' for a connection request' : ''})`));
  } else if (voice.warnAboveChars && len > voice.warnAboveChars && !flags.isConnection) {
    out.push(warn('long', `mensagem com ${len} chars, acima do alvo (${voice.warnAboveChars})`));
  }
  if (voice.warnBelowChars && len < voice.warnBelowChars && !flags.isConversation) {
    out.push(warn('short', `mensagem com só ${len} chars, confere se não ficou seca demais`));
  }
  return out;
}

// ── the person's own checks (all no-ops when the voice does not ask) ──────────
export function checkDashes(msg, voice) {
  const out = [];
  if (voice.banEmDash && msg.includes('—')) out.push(err('em-dash', 'em dash (—) not allowed in this voice'));
  if ((voice.banEnDash ?? voice.banEmDash) && msg.includes('–')) out.push(err('en-dash', 'en dash (–) not allowed in this voice'));
  return out;
}

export function checkGreeting(msg, voice) {
  if (!voice.banFormalGreeting) return [];
  if (/^(hey|hi|hello|dear)\b/i.test(msg.trim())) {
    return [err('formal-greeting', 'formal greeting at the start (Hey/Hi/Hello/Dear) — this voice opens straight in')];
  }
  return [];
}

export function checkEmoji(msg, voice, flags) {
  if (voice.banEmoji && EMOJI_RE.test(msg)) return [err('emoji', 'emoji not allowed in this voice')];
  if (voice.banEmojiFirstTouch && flags.isFirstTouch && EMOJI_RE.test(msg)) {
    return [err('emoji-first-touch', 'emoji not allowed on the first touch in this voice')];
  }
  return [];
}

export function checkExclamation(msg, voice) {
  if (voice.banExclamation && msg.includes('!')) return [err('exclamation', 'exclamation mark not allowed in this voice')];
  return [];
}

export function checkBannedList(msg, voice) {
  const lower = msg.toLowerCase();
  const out = [];
  for (const p of voice.bannedPhrases || []) {
    if (p && lower.includes(String(p).toLowerCase())) out.push(err('banned-phrase', `phrase banned in this voice: "${p}"`));
  }
  for (const w of voice.bannedWords || []) {
    if (w && wordRe(w).test(msg)) out.push(err('banned-word', `word banned in this voice: "${w}"`));
  }
  return out;
}

export function checkVanityMetrics(msg, voice) {
  if (!voice.banVanityMetrics) return [];
  const out = [];
  if (VANITY_METRIC.test(msg)) out.push(err('vanity', 'vanity metric (X impressions) banned in this voice'));
  if (ENGAGEMENT_RATE.test(msg)) out.push(err('vanity', 'vanity metric (X% engagement) banned in this voice'));
  return out;
}

export function checkSignoff(msg, voice, flags) {
  const sig = voice.signoff;
  const allowed = voice.signoffAllowedStages;
  if (!sig || !allowed) return [];
  const present = msg.toLowerCase().includes(String(sig).toLowerCase());
  if (!present) return [];
  const ok = allowed.some((s) => new RegExp(s, 'i').test(flags.stage));
  if (ok) return [];
  return [err('signoff', `sign-off "${sig}" is not allowed at stage ${flags.stage || '(no stage)'}`)];
}

export function checkCallCta(msg, voice, flags) {
  const rule = voice.callCta;
  if (!rule) return [];
  const patterns = [
    /\bquick call\b/i, /\b30[\s-]*minute\b/i, /\b30\s*min\b/i, /\b20\s*min(?:utes)?\b/i,
    /\bworth\s+\d+\s+minutes\b/i, /\bhop on a call\b/i, /\bbook a call\b/i,
    /\ba call\b/i, /\bquick chat\b/i,
  ];
  const asks = patterns.some((re) => re.test(msg));
  const matches = (list) => (list || []).some((s) => new RegExp(s, 'i').test(flags.stage));
  if (asks && matches(rule.bannedIn)) {
    return [err('call-cta', `asking for a call is not allowed at stage ${flags.stage}`)];
  }
  if (!asks && matches(rule.warnIfMissingIn) && msg.length > (rule.minCharsForWarn ?? 0)) {
    return [warn('no-call-cta', 'mensagem sem CTA de call — esta voz fecha chamando para o papo')];
  }
  return [];
}

// ── composition ───────────────────────────────────────────────────────────────
// lintMessage(msg, 'FUP_2')                      → universal rules only
// lintMessage(msg, 'FUP_2', voice)               → universal + the person's
// lintMessage(msg, { stage: 'FUP_2', voice })    → the same, in named form
export function lintMessage(msg, stageOrOpts = 'FUP', maybeVoice = null) {
  const opts = typeof stageOrOpts === 'object' && stageOrOpts !== null ? stageOrOpts : { stage: stageOrOpts };
  const voice = opts.voice || maybeVoice || loadVoice(null).voice;
  const flags = stageFlags(opts.stage);
  const text = String(msg ?? '');

  const findings = [
    ...checkPlaceholders(text),
    ...checkMarkdownLeak(text),
    ...checkDeadCorporate(text),
    ...checkQuestionCount(text, voice),
    ...checkLength(text, voice, flags),
    ...checkDashes(text, voice),
    ...checkGreeting(text, voice),
    ...checkEmoji(text, voice, flags),
    ...checkExclamation(text, voice),
    ...checkBannedList(text, voice),
    ...checkVanityMetrics(text, voice),
    ...checkSignoff(text, voice, flags),
    ...checkCallCta(text, voice, flags),
  ];

  return {
    findings,
    errors: findings.filter((f) => f.level === 'error').map((f) => f.message),
    warnings: findings.filter((f) => f.level === 'warn').map((f) => f.message),
  };
}

// Anti-blast: two nearly identical messages in the same batch are detectable from outside.
export function checkBatchDuplicates(items, threshold = 0.8) {
  const issues = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i].msg; const b = items[j].msg;
      if (!a || !b) continue;
      const shorter = Math.min(a.length, b.length);
      if (!shorter) continue;
      let same = 0;
      for (let k = 0; k < shorter; k += 1) if (a[k] === b[k]) same += 1;
      if (same / shorter > threshold) {
        issues.push(`#${items[i].n} (${items[i].co}) e #${items[j].n} (${items[j].co}) são >${Math.round(threshold * 100)}% idênticas — blast detectável`);
      }
    }
  }
  return issues;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const flag = (name, dflt = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
  const stageFlag = flag('--stage', 'FUP');
  const operator = flag('--operator', process.env.ROGER_OPERATOR);
  const fileArg = args.find((a) => a.endsWith('.json'));

  const resolved = loadVoice(operator);
  if (resolved.error) {
    console.log(`✗ ${resolved.error}`);
    process.exit(1);
  }
  if (resolved.source !== 'file') {
    console.log(`⚠ no voice.json${operator ? ` for "${operator}"` : ' (no operator given)'} — only the universal rules are active.`);
    console.log('  The rules of taste (dashes, greetings, emoji, your own words) come from the interview: npm run onboarding\n');
  }
  const { voice } = resolved;

  let failed = false;

  if (fileArg) {
    const batch = JSON.parse(readFileSync(fileArg, 'utf8'));
    const items = batch.leads || batch;
    console.log(`lint-voz: ${items.length} mensagens em ${fileArg}${resolved.source === 'file' ? ` (voz: ${resolved.operator})` : ''}\n`);
    for (const item of items) {
      if (!item.msg) continue;
      const { errors, warnings } = lintMessage(item.msg, { stage: item.stage || stageFlag, voice });
      if (errors.length || warnings.length) {
        console.log(`#${item.n ?? '?'} ${item.co ?? ''} (${item.stage ?? stageFlag})`);
        for (const e of errors) { console.log(`  ✗ ${e}`); failed = true; }
        for (const w of warnings) console.log(`  ⚠ ${w}`);
      }
    }
    const dups = checkBatchDuplicates(items.filter((i) => i.msg));
    for (const d of dups) { console.log(`✗ DUPLICATA: ${d}`); failed = true; }
    if (!failed) console.log('✓ every message passed the voice guard');
  } else {
    const text = readFileSync(0, 'utf8').trim();
    const { errors, warnings } = lintMessage(text, { stage: stageFlag, voice });
    for (const e of errors) { console.log(`✗ ${e}`); failed = true; }
    for (const w of warnings) console.log(`⚠ ${w}`);
    if (!errors.length) console.log('✓ passed the voice guard');
  }

  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
