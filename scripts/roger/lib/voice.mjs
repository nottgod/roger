// voice.mjs — a voz do operador como DADO, não como constante de código.
//
// Por que este módulo existe: a trava de voz nasceu com o gosto de uma pessoa dentro
// do código (sem travessão, sem "Hey", sem a palavra "leads"). Isso é ótimo para ela e
// errado para todo mundo. Aqui a voz vira um arquivo que pertence a quem opera:
//
//   rapport/operators/<slug>/voice.json   ← gerado pela entrevista (onboarding.mjs)
//
// As chaves são as MESMAS que `toVoiceConfig()` do onboarding emite, de propósito: o que
// a entrevista produz entra aqui sem tradução.
//
// NEUTRO POR PADRÃO: sem arquivo, valem só as regras universais (o que é ruim em qualquer
// voz). As regras de gosto ficam desligadas — e quem chama recebe `source: 'defaults'`
// para poder avisar, em vez de afrouxar a trava em silêncio.
//
// ESM, sem deps.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// fileURLToPath, não URL.pathname: pathname vem percent-encoded e quebraria
// numa instalação com espaço no caminho.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const RAPPORT = 'rapport';

// Regras de gosto: desligadas até a pessoa dizer o contrário.
// Regras universais NÃO moram aqui — elas são do core e não se configuram.
export const NEUTRAL_VOICE = {
  language: null,
  // tamanho
  maxChars: 600,
  caps: { default: 600, connection: 300 },
  warnAboveChars: null,
  warnBelowChars: null,
  maxQuestions: 1,
  sentencesTarget: null,
  // gosto tipográfico
  banEmDash: false,
  banEnDash: false,
  banEmoji: false,
  banEmojiFirstTouch: false,
  banExclamation: false,
  // registro
  banFormalGreeting: false,
  banConsultantJargon: false,
  banVanityMetrics: false,
  allowHumanSlip: true,
  requireCleanGrammar: false,
  // identidade
  greeting: null,
  signoff: null,
  signoffAllowedStages: null, // null = em qualquer stage
  // listas da pessoa
  bannedWords: [],
  bannedPhrases: [],
  // CTA
  ctaStyle: null,
  callCta: null, // { bannedIn: [...], warnIfMissingIn: [...], minCharsForWarn: n }
  // regras em prosa, para o gerador mostrar a quem escreve
  rules: [],
};

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

// Merge raso com um nível para os objetos conhecidos (caps, callCta).
export function resolveVoice(partial) {
  const v = { ...NEUTRAL_VOICE };
  if (!isPlainObject(partial)) return v;
  for (const [k, value] of Object.entries(partial)) {
    if (value === undefined || value === null) continue;
    if (isPlainObject(NEUTRAL_VOICE[k]) && isPlainObject(value)) v[k] = { ...NEUTRAL_VOICE[k], ...value };
    else v[k] = value;
  }
  // maxChars e caps.default são a mesma ideia dita de dois jeitos (a entrevista emite maxChars).
  if (isPlainObject(partial) && partial.maxChars && !partial.caps?.default) {
    v.caps = { ...v.caps, default: partial.maxChars };
  }
  return v;
}

// Lê a voz do operador. NUNCA lança: sem arquivo, devolve o neutro e diz de onde veio.
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
    // Arquivo existe mas está quebrado: isto NÃO passa em silêncio.
    return { operator: slug, source: 'invalid', path, voice: resolveVoice(null), error: `voice.json inválido: ${e.message}` };
  }
}
