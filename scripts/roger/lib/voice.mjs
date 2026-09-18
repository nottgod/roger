// voice.mjs — the operator's voice as DATA, not as a constant in the code.
//
// Why this module exists: the voice guard was born with one person's taste inside the
// code (no em dash, no "Hey", never the word "leads"). That is great for them and wrong
// for everyone else. Here the voice becomes a file that belongs to whoever operates:
//
//   rapport/operators/<slug>/voice.json   ← written by the interview (onboarding.mjs)
//
// The keys are the SAME ones `toVoiceConfig()` emits in the interview, on purpose: what
// the interview produces lands here without translation.
//
// NEUTRAL BY DEFAULT: with no file, only the universal rules apply (what is bad in any
// voice). The rules of taste stay off — and the caller gets `source: 'defaults'` so it
// can say so, instead of quietly loosening the guard.
//
// ESM, no deps.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// fileURLToPath, not URL.pathname: pathname comes percent-encoded and would break on an
// install whose path has a space in it.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RAPPORT = 'rapport';

// Rules of taste: off until the person says otherwise.
// Universal rules do NOT live here — they belong to the core and are not configurable.
export const NEUTRAL_VOICE = {
  language: null,
  // length
  maxChars: 600,
  caps: { default: 600, connection: 300 },
  warnAboveChars: null,
  warnBelowChars: null,
  maxQuestions: 1,
  sentencesTarget: null,
  // typographic taste
  banEmDash: false,
  banEnDash: false,
  banEmoji: false,
  banEmojiFirstTouch: false,
  banExclamation: false,
  // register
  banFormalGreeting: false,
  banConsultantJargon: false,
  banVanityMetrics: false,
  allowHumanSlip: true,
  requireCleanGrammar: false,
  // identity
  greeting: null,
  signoff: null,
  signoffAllowedStages: null, // null = em qualquer stage
  // the person's own lists
  bannedWords: [],
  bannedPhrases: [],
  // CTA
  ctaStyle: null,
  callCta: null, // { bannedIn: [...], warnIfMissingIn: [...], minCharsForWarn: n }
  // rules in prose, for the generator to show whoever writes
  rules: [],
};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Shallow merge, one level deep for the known objects (caps, callCta).
export function resolveVoice(partial) {
  const v = { ...NEUTRAL_VOICE };
  if (!isPlainObject(partial)) return v;
  for (const [k, value] of Object.entries(partial)) {
    if (value === undefined || value === null) continue;
    if (isPlainObject(NEUTRAL_VOICE[k]) && isPlainObject(value)) v[k] = { ...NEUTRAL_VOICE[k], ...value };
    else v[k] = value;
  }
  // maxChars and caps.default are the same idea said twice (the interview emits maxChars).
  if (isPlainObject(partial) && partial.maxChars && !partial.caps?.default) {
    v.caps = { ...v.caps, default: partial.maxChars };
  }
  return v;
}

// Reads the operator's voice. It NEVER throws: with no file it returns the neutral one
// and says where that came from.
export function loadVoice(operator, opts = {}) {
  const slug = (operator == null ? '' : String(operator)).trim();
  if (!slug) return { operator: null, source: 'defaults', path: null, voice: resolveVoice(null), error: null };

  const path = opts.path || join(ROOT, RAPPORT, 'operators', slug, 'voice.json');
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { operator: slug, source: 'defaults', path, voice: resolveVoice(null), error: null };
  }
  try {
    const parsed = JSON.parse(raw);
    return { operator: slug, source: 'file', path, voice: resolveVoice(parsed), error: null };
  } catch (e) {
    // The file exists but is broken: this does NOT pass in silence.
    return { operator: slug, source: 'invalid', path, voice: resolveVoice(null), error: `voice.json inválido: ${e.message}` };
  }
}
