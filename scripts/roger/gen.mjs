#!/usr/bin/env node
// gen.mjs — the Generation layer. One engine, two modes.
// PHILOSOPHY: determinism in WHAT goes in (this builder), freedom in HOW it comes out (the
// model writes), a hard guard on the way out (lint-voz.mjs). buildGenerationBrief() is PURE
// and never throws: it takes the already classified report from intel.mjs (it does NOT
// re-classify, it does NOT call score.mjs) plus contact and stage, and builds the brief in
// three layers (diagnosis, culture, wording). In mode:'conversation' the wording layer
// becomes reading-the-signal + BANT + objection→reframe + the voice rule.
//
// It does NOT touch the cadence (it only READS it via loadCadencia). conversation mode
// creates no task in the CRM. The loaders parse the context pack .md files at runtime (the
// same pattern as cadencia.mjs) with a hardcoded FALLBACK (never throws). ESM, Node 24.
// CLI: node gen.mjs '{"contact":{...},"company":"...","stage":"FUP_2","intel":{...}}'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCadencia } from './cadencia.mjs';
import { loadVoice } from './lib/voice.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAPPORT = join(ROOT, 'rapport');

// Which context and which operator. TODO: require both variables and fail loudly when they
// are missing; the default below exists only so the current install does not break.
export const CONTEXT = process.env.ROGER_CONTEXT || 'example';
export const DEFAULT_OPERATOR = process.env.ROGER_OPERATOR || 'example';
const PACK = join(ROOT, 'rapport', 'contexts', CONTEXT);

// Context files that were missing when read. The built-in fallback avoids the crash, but the
// silence was the problem: without this record, a half-finished context pack produced a
// message carrying another company's text and nobody noticed.
const missingPackFiles = new Set();
export function contextHealth() {
  return { context: CONTEXT, pack: PACK, missing: [...missingPackFiles] };
}

// ── raw reading + markdown table parser (the cadencia.mjs pattern) ──
function readPack(relPath, base = PACK) {
  try {
    return readFileSync(join(base, relPath), 'utf8');
  } catch {
    missingPackFiles.add(join(base === PACK ? CONTEXT : 'rapport', relPath));
    return '';
  }
}

// Pulls table rows (| a | b | c |) that appear AFTER the header matching headerRe. Returns an
// array of arrays of cells (trimmed). Skips the separator row |---|. Stops at the first
// non-table block once the table has started.
export function parseTable(text, headerRe) {
  if (!text) return [];
  const section = headerRe ? (text.split(headerRe)[1] || '') : text;
  const rows = [];
  for (const line of section.split('\n')) {
    if (!/^\s*\|/.test(line)) { if (rows.length) break; else continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c) || c === '')) continue; // separador
    rows.push(cells);
  }
  return rows;
}

// ── FALLBACK: these mirror the .md files. If the parse fails, the brief degrades without crashing. ──
const GEO_TO_REGION = {
  usa: 'USA NY', us: 'USA NY', 'united states': 'USA NY',
  uk: 'UK', 'united kingdom': 'UK',
  germany: 'Germanic (DE/CH)', alemanha: 'Germanic (DE/CH)',
  switzerland: 'Germanic (DE/CH)', 'suíça': 'Germanic (DE/CH)', suica: 'Germanic (DE/CH)',
  austria: 'Germanic (DE/CH)', 'áustria': 'Germanic (DE/CH)',
  france: 'France', 'frança': 'France',
  uae: 'UAE', dubai: 'UAE',
  singapore: 'Singapore / HK', singapura: 'Singapore / HK', 'hong kong': 'Singapore / HK', hk: 'Singapore / HK',
  japan: 'East Asia (JP/KR)', 'japão': 'East Asia (JP/KR)', japao: 'East Asia (JP/KR)',
  'south korea': 'East Asia (JP/KR)', 'coreia do sul': 'East Asia (JP/KR)', korea: 'East Asia (JP/KR)',
  brazil: 'LATAM (expansion)', brasil: 'LATAM (expansion)', mexico: 'LATAM (expansion)',
  'méxico': 'LATAM (expansion)', argentina: 'LATAM (expansion)', colombia: 'LATAM (expansion)',
};
const FALLBACK_CULTURE = {
  'USA NY': { registro: 'direct, bottom line first', abertura: "Quick one, saw X. Curious how you're handling Y." },
  'USA SF / Miami': { registro: 'relational, warmer', abertura: "Hey, been following what you're building with X." },
  'UK': { registro: 'formal, dry humour', abertura: 'Came across X, well played. Wondering about Y.' },
  'Germanic (DE/CH)': { registro: 'factual, evidence, no synergy flattery', abertura: 'X stands out for [fact]. How are you approaching Y?' },
  'France': { registro: 'conceptual, more elaborate', abertura: 'Bonjour, votre approche sur X est intéressante.' },
  'UAE': { registro: 'relational, with formality', abertura: 'Hello [Name], impressive work on X.' },
  'Singapore / HK': { registro: 'efficient, polite', abertura: 'Hi [Name], noticed X. Quick question on Y.' },
  'East Asia (JP/KR)': { registro: 'indirect, hierarchical, patient', abertura: '[Name]-san, I admire the work on X.' },
  'LATAM (expansion)': { registro: 'relational, warm', abertura: 'Hey, been following what you are building with X.' },
};
const TRANSVERSAL = {
  germanic: 'Germanic: never open with empty praise (amazing / love what you are doing); open with an observed fact.',
  eastAsia: 'East Asia, formal: patience, no aggressive CTA on the first touch.',
};

const SEG_ALIAS = {
  payments: 'payments', marketplaces: 'marketplaces',
  neobanks: 'neobanks', lending: 'lending',
};
// Mirrors table 3.12 of the active diagnosis.md. If the .md has the row, the .md wins.
const FALLBACK_VOCAB = {
  payments: { narrativa: 'Cada provedor novo traz um arquivo de settlement que ninguem assume', vocab: 'settlement file, chargeback, payout window, taxas do provedor' },
  marketplaces: { narrativa: 'Split de pagamento faz o ledger nunca bater com o banco na primeira tentativa', vocab: 'split payment, payout do vendedor, escrow, take rate' },
  neobanks: { narrativa: 'O crescimento multiplica o volume mais rapido que o time de financas', vocab: 'lancamento, conta transitoria, quebra, fechamento diario' },
  lending: { narrativa: 'Provisao de juros e pagamentos discordam no fim de todo mes', vocab: 'accrual, amortizacao, cronograma de pagamento, inadimplencia' },
};

const STRUCTURE_77 = {
  elementos: [
    'a specific hook (something real you observed about them, not generic)',
    'a consultative observation (a light diagnosis, not a pitch)',
    'one open question (just one, and worth answering)',
  ],
  formato: [
    'under 600 chars, three to four sentences',
    'no formal greeting, no corporate sign-off',
    "contractions (it's, you're, we've)",
    'one deliberate human imperfection (a lowercase start, a light typo, an informal contraction)',
  ],
};
const FALLBACK_APPROACH = {
  Provocativo: 'someone who responds to a strong opinion (an outspoken founder)',
  Case: 'someone who validates by proof (a CMO, a Head of Growth)',
  'Engajamento Contextual': 'they posted something recently — reply with substance',
  Evento: 'they are going to an event you will also be at',
  Institucional: 'senior C-level, a firm or family office, formal register',
};

// Only the ANGLE of the touch. The interval (D+N) comes from the cadence (single source:
// cadencia-funil.md via touchAngle). Every touch except the handshake and the break-up closes by asking to talk.
const STAGE_ANGLE = {
  MENSAGEM_INICIAL: 'first touch, DIRECT: a one-line hook + what you do + ask for a call. With a campaign: a short handshake, no pitch, no question',
  connection: 'connection request: under 300 chars, no call request',
  FUP_1: 'with a campaign: the pitch in the same thread (the context you promised + positioning + ask for a call). Without one: short, no reintroduction, close by asking for a call',
  FUP_2: 'a provocation with an insight, CHANGE THE ANGLE (do not repeat the last one) + a light ask for a call',
  FUP_3: 'social proof (a concrete case or customer) + ask for a call',
  FUP_4: 'a direct ask for a 15 minute call (or switch channel, LinkedIn <-> Telegram)',
  FUP_5: 'last hook, mix the approach + ask for a call',
  FUP_MAIS: 'the honest last try (break-up), door left open, no call request (converts 5-10%)',
};

// ── message templates ──────────────────────────────────────────────────────────
// Source: `mensagens.md` of the active context pack. The fallback below is a deliberately
// generic SKELETON: what the company does belongs to the context, not to the engine.
const MSGS_FILE = 'mensagens.md';
const FALLBACK_TEMPLATES = {
  M1: "Great to connect, {Name}! I'll write to you shortly with some context on why I reached out.",
  M2: '{Name}, as promised, some context. {what you do, in one sentence}. Worth a quick call this week to see if it fits what you are building?',
  M2_DIRETO: '{Name}, {a specific one-line hook}. {what you do, in one sentence}. Open to a quick call this week?',
};
const TEMPLATE_SECTION = { M1: /^m1\b/, M2: /^m2\s*—|^m2\s/, M2_DIRETO: /^m2-direto/ };

export function contextTemplate(key) {
  const re = TEMPLATE_SECTION[key];
  const txt = readPack(MSGS_FILE);
  if (re && txt) {
    const sec = txt.split(/\n## /).find((s) => re.test(s.trim().toLowerCase()));
    if (sec) {
      const lines = [];
      for (const line of sec.split('\n')) {
        if (/^\s*>/.test(line)) lines.push(line.replace(/^\s*>\s?/, ''));
        else if (lines.length) break; // primeiro blockquote contíguo da seção
      }
      const t = lines.join(' ').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
  }
  return FALLBACK_TEMPLATES[key] || null;
}

// A ready-made campaign: M1 on the first message, M2 on FUP_1. With no campaign: the first message is M2-direct.
export function templateKeyFor(stage, campanha) {
  const s = String(stage || '').toUpperCase();
  const isCampaign = !!(campanha && String(campanha).trim());
  if (/MENSAGEM_INICIAL|INICIAL/.test(s)) return isCampaign ? 'M1' : 'M2_DIRETO';
  if (s === 'FUP_1' && isCampaign) return 'M2';
  return null;
}

// Fallback voice rules. The real voice lives in operators/<slug>/voice.json (the `rules`
// field), written by the interview. This here is only what is left when no voice was
// declared at all — and `voiceSnippets` says so when that is the case.
const FALLBACK_VOICE_RULES = [
  'oral e direto, do jeito que a pessoa fala',
  'uma pergunta só, aberta, que dá vontade de responder',
  'tom diagnóstico, não venda: alguém que viu um detalhe, não um vendedor pedindo tempo',
];

// ── pure helpers ──
export function cultureLookup(geo) {
  const key = (geo == null ? '' : String(geo)).trim().toLowerCase();
  const region = GEO_TO_REGION[key] || null;
  let parsed = null;
  if (region) {
    const rows = parseTable(readPack('culture.md'), /##\s*8\.1/);
    const row = rows.find((r) => r[0] === region);
    if (row && row[1]) parsed = { registro: row[1], abertura: row[2] || '' };
  }
  const base = parsed || (region ? FALLBACK_CULTURE[region] : null);
  const transversal = [];
  if (region === 'Germanic (DE/CH)') transversal.push(TRANSVERSAL.germanic);
  if (region === 'East Asia (JP/KR)') transversal.push(TRANSVERSAL.eastAsia);
  return {
    geo: geo || null,
    region: region || '(geo não mapeado, default registro neutro)',
    registro: base ? base.registro : 'direct, bottom line first (geo not mapped)',
    abertura: base ? base.abertura : '',
    transversal,
  };
}

export function segmentVocab(segment) {
  const slug = (segment == null ? '' : String(segment)).trim().toLowerCase();
  const label = SEG_ALIAS[slug] || slug;
  // an empty or unknown segment degrades to null. Without this, label '' + rowLabel.includes('')
  // was always true, so the loop matched the HEADER of table 3.12 and leaked it into the brief.
  if (!label) return { segment: segment || null, narrativa: null, vocab: null };
  let parsed = null;
  const rows = parseTable(readPack('diagnosis.md'), /##\s*3\.12/);
  for (const r of rows) {
    const rowLabel = (r[0] || '').replace(/\*/g, '').trim().toLowerCase();
    if (rowLabel && (rowLabel === label || rowLabel.includes(label))) { parsed = { narrativa: r[1], vocab: r[2] }; break; }
  }
  const base = parsed || FALLBACK_VOCAB[label] || null;
  return { segment: segment || null, narrativa: base ? base.narrativa : null, vocab: base ? base.vocab : null };
}

export function approachStructure(approach) {
  const want = (approach == null ? '' : String(approach)).trim();
  let quando = null;
  const rows = parseTable(readPack('approaches.md'), /##\s*7\.8/);
  for (const r of rows) {
    if ((r[0] || '').trim().toLowerCase() === want.toLowerCase()) { quando = r[1]; break; }
  }
  if (!quando) quando = FALLBACK_APPROACH[want] || null;
  return { approach: approach || null, quando, estrutura: STRUCTURE_77 };
}

export function touchAngle(stage) {
  const key = String(stage || '').trim();
  const angle = STAGE_ANGLE[key] || STAGE_ANGLE[key.toUpperCase()] || '(stage não mapeado)';
  let days = null; let next = null;
  try {
    const { map } = loadCadencia();
    if (map && map[key]) { days = map[key].days; next = map[key].next; }
  } catch { /* no-throw: cadência tem fallback próprio */ }
  return { stage: key, angle, days, next };
}

export function voiceSnippets(operator = DEFAULT_OPERATOR) {
  const rel = `operators/${operator}/persona.md`;
  const txt = readPack(rel, RAPPORT);
  const resolved = loadVoice(operator);
  const rules = (resolved.voice.rules || []).length ? resolved.voice.rules : FALLBACK_VOICE_RULES;
  return {
    operator,
    personaFile: join(RAPPORT, rel),
    loaded: txt.length > 0,
    rules,
    // Where the voice came from: 'file' = the person's voice.json; 'defaults' = nobody
    // declared one, we are writing with generic rules; 'invalid' = the file is broken.
    voiceSource: resolved.source,
    voiceFile: resolved.path,
    voiceError: resolved.error,
    voice: resolved.voice,
  };
}

// ── the diagnosis layer ──
// The core pain comes from the context (table `3.9.M` of diagnosis.md). The fallback
// describes no business on purpose: it tells the person to write their own.
const FALLBACK_DOR_CENTRAL = 'dor central não declarada — escreva a sua na tabela 3.9.M do diagnosis.md do seu contexto, em uma linha';

let _dorCentral = null;
export function loadDorCentral() {
  if (_dorCentral) return _dorCentral;
  const rows = parseTable(readPack('diagnosis.md'), /##\s*3\.9\.M/);
  const row = rows.find((r) => /^dor_central$/i.test((r[0] || '').replace(/[`*]/g, '').trim()));
  _dorCentral = (row && row[1]) ? row[1].trim() : FALLBACK_DOR_CENTRAL;
  return _dorCentral;
}
const BANNED_TO_WATCH = [
  'agency / marketing services / growth consultancy (banned in this domain)',
  'em dash (—), pipe (|), markdown leaking through',
  'consultant jargon (hook, framing, lift, circling back, make sense?, doing a lot of work)',
  'vanity metrics (X impressions, X% engagement)',
  'asking for a call inside a connection request',
  'formal greetings (Hey/Hi/Hello/Dear); more than one question',
];

function charTargetFor(stage, templateKey = null) {
  const s = String(stage || '').toLowerCase();
  if (templateKey === 'M1') return { min: 60, max: 140, cap: 300 }; // handshake curtíssimo
  if (/connection|conex/.test(s)) return { min: 80, max: 300, cap: 300 };
  if (/inicial|mensagem_inicial|^mi$/.test(s)) return { min: 200, max: 450, cap: 600 };
  if (templateKey === 'M2') return { min: 250, max: 450, cap: 600 }; // pitch pós-handshake
  return { min: 80, max: 200, cap: 600 }; // FUP
}

function groundFacts(intel = {}) {
  const raw = intel.raw || {};
  const f = raw.fundable || null;
  return {
    website: raw.website || null,
    funding: f ? { dealDate: f.dealDate || null, numEmployees: f.numEmployees ?? null, country: f.country || null } : null,
    painPoint: raw.painPoint || null,
    aviso: 'Use only the facts present here. A null field means unknown. NEVER invent funding or a number.',
  };
}

function outboundGate(intel = {}) {
  if (!intel || intel.tier === 'DESCARTE') {
    return { go: false, skipReason: `SKIP: ${intel?.reason || 'outside the ICP'} — do not write` };
  }
  const gapCount = intel.gap?.count ?? 0;
  const src = intel.sources || {};
  const srcOk = src.fundable === 'ok' || src.exa === 'ok' || src.firecrawl === 'ok';
  if (intel.tier === 'FRIO' && gapCount === 0 && !srcOk) {
    return { go: false, skipReason: 'not enough material for a strong message (cold + shallow gap + thin sources) — do not write a placeholder' };
  }
  return { go: true, skipReason: null };
}

function buildOutboundBrief(input) {
  const contact = input.contact || {};
  const intel = input.intel || {};
  const { company, stage } = input;
  const gate = outboundGate(intel);
  const culture = cultureLookup(contact.geo);
  const vocab = segmentVocab(intel.segment);
  const approach = approachStructure(intel.approach);
  const campanha = input.campanha || null;
  const taskText = (input.taskText && String(input.taskText).trim() !== '.') ? String(input.taskText).trim() : null;
  const templateKey = templateKeyFor(stage, campanha);
  return {
    mode: 'outbound',
    go: gate.go,
    skipReason: gate.skipReason,
    stage: stage || null,
    card: {
      campanha,
      taskText,
      templateKey,
      template: templateKey ? contextTemplate(templateKey) : null,
      // relative on purpose: this briefing gets pasted into a chat, and an absolute path
      // from someone else's machine helps nobody.
      templatesFile: `rapport/contexts/${CONTEXT}/${MSGS_FILE}`,
      rule: campanha
        ? 'campanha pré-pronta: usar o template (variar levemente, anti-blast). Cadência já semeada nos cards — NUNCA criar FUP nova'
        : (taskText ? 'follow the task text (the card instruction wins)' : 'no card instruction: use the angle for this touch (direct by default on M1/M2, close by asking for a call)'),
    },
    company: company || intel.lead?.company || null,
    contact: { name: contact.name || null, role: contact.role || null, geo: contact.geo || null, linkedin: contact.linkedin || null },
    diagnostic: {
      dorCentral: loadDorCentral(),
      angle: intel.angle || null,
      approach: intel.approach || null,
      gapDetected: intel.gap?.detected || [],
      gapNeedsJudgment: intel.gap?.needsJudgment || [],
      gapCount: intel.gap?.count ?? null,
      timingDetected: intel.timing?.detected || [],
      segment: intel.segment || null,
      narrativa: vocab.narrativa,
      vocab: vocab.vocab,
    },
    culture,
    redacao: {
      approach: intel.approach || null,
      quando: approach.quando,
      estrutura: approach.estrutura,
      touchAngle: touchAngle(stage),
      voice: voiceSnippets(input.operator || DEFAULT_OPERATOR),
      charTarget: charTargetFor(stage, templateKey),
      bannedToWatch: BANNED_TO_WATCH,
    },
    rawFacts: groundFacts(intel),
  };
}

// ── conversation: objections and BANT come from the CONTEXT, not from the engine ──
// Source: tables `C.3.M` (objections) and `C.2.M` (BANT) of the active `conversation.md`.
// The fallbacks below are generic on purpose: one company's sales doctrine does not belong
// in the code. In the `match` column, alternatives are separated by `;;`, because `|` is the
// markdown cell separator.
const FALLBACK_OBJECTIONS = [
  { key: 'agency', match: /(don'?t|do not|não)\s+(work with|trabalh\w*\s+com).{0,14}agenc|no agencies|sem agência/i,
    reframe: 'Afirmar a categoria positiva do que você faz, sem repetir o termo que ele rejeitou. Conceder onde ele tem razão e contornar pelo lado.' },
  { key: 'in-house', match: /in[\s-]?house|internal team|own (bd|team)|time interno|bd interno/i,
    reframe: 'Não é substituição, é aceleração e cobertura. Perguntar o escopo antes de aceitar: quase sempre há um gap que o time interno não cobre.' },
  { key: 'price-early', match: /\b(price|pricing|cost|how much|quanto custa|preço)\b/i,
    reframe: 'Reancorar no resultado ANTES do número. Não soltar preço sem ter estabelecido o que ele compra.' },
  { key: 'send-proposal', match: /send (me )?(a )?proposal|just send|manda (a )?proposta/i,
    reframe: 'Proposta sem contexto é genérica. Uma conversa curta primeiro, depois a proposta sob medida.' },
  { key: 'think-about-it', match: /think about it|get back to you|vou pensar|depois eu vejo/i,
    reframe: 'Sem próximo passo concreto vira frio em uma semana. Oferecer um passo específico, com data.' },
];

const FALLBACK_BANT = [
  { key: 'need', sondar: 'o lead reconhece o problema que você resolve?' },
  { key: 'authority', sondar: 'é ele que decide, ou precisa trazer outro decisor?' },
  { key: 'budget', sondar: 'há sinal de budget compatível, sem cravar número cedo' },
  { key: 'timeline', sondar: 'quando começaria (só quando o sinal já é positivo)' },
];

let _objections = null;
export function loadObjections() {
  if (_objections) return _objections;
  const rows = parseTable(readPack('conversation.md'), /##\s*C\.3\.M/);
  const parsed = [];
  for (const r of rows) {
    const key = (r[0] || '').replace(/[`*]/g, '').trim();
    const src = (r[1] || '').trim();
    const reframe = (r[2] || '').trim();
    if (!key || /^key$/i.test(key) || !src || !reframe) continue;
    try {
      parsed.push({ key, match: new RegExp(src.split(';;').join('|'), 'i'), reframe });
    } catch { /* padrão inválido no .md: ignora a linha em vez de derrubar a geração */ }
  }
  _objections = parsed.length ? parsed : FALLBACK_OBJECTIONS;
  return _objections;
}

let _bant = null;
export function loadBant() {
  if (_bant) return _bant;
  const rows = parseTable(readPack('conversation.md'), /##\s*C\.2\.M/);
  const parsed = rows
    .map((r) => ({ key: (r[0] || '').replace(/[`*]/g, '').trim(), sondar: (r[1] || '').trim() }))
    .filter((x) => x.key && !/^key$/i.test(x.key) && x.sondar);
  _bant = parsed.length ? parsed : FALLBACK_BANT;
  return _bant;
}

function classifySignal(text) {
  const t = (text || '').toLowerCase();
  if (!t) return 'unknown';
  if (/stop messaging|leave me alone|i said no|please respect|not interested at all|fuck off/.test(t)) return 'discard';
  if (/\b(price|pricing|how much|preço|quanto custa)\b/.test(t) || /just send|send me (a )?proposal|i'?ll think about it|think about it/.test(t)) return 'alert';
  if (/we don'?t work with agenc|in[\s-]?house/.test(t)) return 'alert'; // objeção recuperável
  // a polite refusal: NOT positive (the bare substring 'interested' used to hijack the signal). It is a warning, not a discard.
  if (/\b(not|no longer|never)\s+(interested|looking)\b|uninterested|not (a )?(good )?fit|sem interesse|n[ãa]o (tenho|temos|há) interesse/.test(t)) return 'alert';
  // referral = the lead hands you to the DECISION MAKER (a third party). Ambiguous verbs are anchored to the third
  // person so a self-referential invite ("talk to you", "reach out to me") is not caught: that is the positive path, not a handoff.
  if (/best person|right person to|connect you with|put you in touch|introduce you to|drop (him|her|them) a|(message|ping|contact) (him|her|them)|loop (in|him|her|them)|(reach out to|talk to|speak (to|with)) (him|her|them|our|the|my)|is the (best |right )?person/i.test(t)) return 'referral';
  if (/how (do|does)|tell me more|references|case stud(y|ies)|\bcases\b|timeline|when (can|could)|happy to|let'?s (chat|talk|call)|i'?m interested|we'?re interested|we'd be interested|interested in|sounds (interesting|good)/.test(t)) return 'positive';
  return 'neutral';
}

function lastLeadMsg(input) {
  const t = input.thread || {};
  if (typeof t.lastLeadMsg === 'string') return t.lastLeadMsg;
  if (Array.isArray(t.messages)) {
    const leadMsgs = t.messages.filter((m) => m && m.from === 'lead');
    if (leadMsgs.length) return leadMsgs[leadMsgs.length - 1].text || '';
  }
  if (typeof t.lastMessage === 'string') return t.lastMessage;
  return '';
}

function detectObjection(text) {
  for (const o of loadObjections()) if (o.match.test(text || '')) return { key: o.key, reframe: o.reframe };
  return null;
}

function pickVoiceRule(input, signal, objection, last) {
  const thread = input.thread || {};
  const exchanges = thread.exchanges || (Array.isArray(thread.messages) ? thread.messages.length : 0);
  const l = (last || '').toLowerCase();
  if (signal === 'discard') return { rule: 'descarte-honesto', why: 'sinal de descarte: encerrar honesto, sem queimar a ponte' };
  if (/i don'?t (quite )?understand|não entendi/.test(l)) return { rule: 'recovery', why: '"my bad, simpler:" + pergunta limpa, cortar jargão' };
  if (signal === 'referral') return { rule: 'referral-handoff', why: 'lead te passou pro decisor: agradece curto quem indicou e escreve a abertura quente pro indicado, citando quem indicou' };
  if (objection) return { rule: 'conceder-reframe', why: 'objeção/discordância: conceder onde tem razão + reframe lateral; nunca defender o termo rejeitado' };
  if (thread.leadAskedNextStep || /send me more|send more|happy to (chat|call|talk)|let'?s (call|talk|chat)|book a/.test(l)) return { rule: 'chefe-modo', why: 'lead pediu próximo passo: info concreta + 2-3 clientes + call' };
  if (thread.substantiveNegotiation || /\b(scope|contract|sow|pricing breakdown|proposta detalhada|negocia)/.test(l)) return { rule: 'handoff', why: 'virou substantiva/negociação: o humano assume (handoff honesto)' };
  if (exchanges >= 6) return { rule: 'chefe-modo', why: '3+ trocas substantivas: chefe-modo natural' };
  return { rule: 'socratic', why: 'primeira tese substantiva: devolver como pergunta (80-150 chars), não plantar credencial nem pedir call' };
}

function buildConversationBrief(input) {
  const contact = input.contact || {};
  const intel = input.intel || {};
  const { company } = input;
  const last = lastLeadMsg(input);
  const signal = classifySignal(last);
  const objection = detectObjection(last);
  const voiceRule = pickVoiceRule(input, signal, objection, last);
  const vocab = segmentVocab(intel.segment);
  return {
    mode: 'conversation',
    go: signal !== 'discard',
    skipReason: signal === 'discard' ? 'discard signal: close it honestly instead of forcing another message' : null,
    company: company || intel.lead?.company || null,
    contact: { name: contact.name || null, role: contact.role || null, geo: contact.geo || null },
    lastLeadMsg: last || null,
    signal, // positive | neutral | alert | discard | unknown
    objection, // {key, reframe} | null
    voiceRule, // {rule, why}
    bant: { probe: loadBant(), regra: 'uma pergunta por vez, sem interrogatório' },
    diagnostic: { dorCentral: loadDorCentral(), segment: intel.segment || null, narrativa: vocab.narrativa, vocab: vocab.vocab },
    culture: cultureLookup(contact.geo),
    voice: voiceSnippets(input.operator || DEFAULT_OPERATOR),
    contextFile: join(PACK, 'conversation.md'),
    rawFacts: groundFacts(intel),
    note: 'conversation NÃO cria task no Kommo (gerente sobe a cadência). Lint stage="conversation".',
  };
}

export function buildGenerationBrief(input = {}) {
  const inp = input || {};
  const mode = inp.mode === 'conversation' ? 'conversation' : 'outbound';
  return mode === 'conversation' ? buildConversationBrief(inp) : buildOutboundBrief(inp);
}

// ── render: GenerationBrief -> markdown the model can read and write from ──
function list(arr) { return (arr && arr.length) ? arr.map((x) => `- ${x}`).join('\n') : '- (none)'; }

export function renderBrief(brief) {
  if (!brief) return '(empty brief)';
  const head = `# GenerationBrief — ${brief.mode} mode — ${brief.company || '(no company)'}`;
  if (brief.go === false) {
    return `${head}\n\n## DO NOT WRITE (SKIP)\n${brief.skipReason || 'no reason recorded'}\n`;
  }
  if (brief.mode === 'conversation') {
    const o = brief.objection;
    return [
      head,
      `**Their last message:** ${brief.lastLeadMsg || '(not provided)'}`,
      `**Signal:** ${brief.signal}`,
      `**Voice rule:** ${brief.voiceRule?.rule} — ${brief.voiceRule?.why}`,
      o ? `**Objection detected:** ${o.key}\n**Reframe:** ${o.reframe}` : '**Objection detected:** none',
      `\n## Diagnosis\nCore pain: ${brief.diagnostic?.dorCentral}\nSegment: ${brief.diagnostic?.segment || '?'} — vocabulary: ${brief.diagnostic?.vocab || '?'}`,
      `\n## Light BANT (one question at a time)\n${list((brief.bant?.probe || []).map((b) => `${b.key}: ${b.sondar}`))}`,
      `\n## Culture\nRegion: ${brief.culture?.region} — how people expect to be addressed: ${brief.culture?.registro}\n${list(brief.culture?.transversal)}`,
      `\n## Voice (read ${brief.voice?.personaFile})\n${list(brief.voice?.rules)}`,
      `\n## Full catalogue: ${brief.contextFile}`,
      `\n_${brief.note}_`,
    ].join('\n');
  }
  const d = brief.diagnostic || {}; const r = brief.redacao || {}; const c = brief.culture || {}; const rf = brief.rawFacts || {}; const cd = brief.card || {};
  return [
    head,
    `Stage: ${brief.stage} · contact: ${brief.contact?.name || '?'} (${brief.contact?.role || '?'}, ${brief.contact?.geo || '?'})`,
    `\n## 0. Card instruction (overrides the rest)\nCampaign: ${cd.campanha || '(none)'} · task text: ${cd.taskText || '(none)'}\nRule: ${cd.rule || '?'}${cd.template ? `\nTemplate ${cd.templateKey} (a base — vary it per lead): "${cd.template}"` : ''}\nTemplates are editable in: ${cd.templatesFile || '?'}`,
    `\n## 1. Diagnosis\nCore pain: ${d.dorCentral}\nAngle (a similar case): ${d.angle || '?'}\nSuggested approach: ${d.approach || '?'}\nSegment: ${d.segment || '?'} — narrative: ${d.narrativa || '?'}\nVocabulary that sounds like an insider: ${d.vocab || '?'}\nGap detected: ${(d.gapDetected || []).join(', ') || '(none measurable)'}\nGap to judge (do NOT invent): ${(d.gapNeedsJudgment || []).join('; ') || '(none)'}\nTiming: ${(d.timingDetected || []).join(', ') || '(none)'}`,
    `\n## 2. Culture\nRegion: ${c.region} — how people expect to be addressed: ${c.registro}\nExample opening: ${c.abertura || '?'}\n${list(c.transversal)}`,
    `\n## 3. Wording\nAngle for this touch: ${r.touchAngle?.angle} (+${r.touchAngle?.days ?? '?'}d after the previous one)\nWhen to use this approach: ${r.quando || '?'}\nStructure:\n${list(r.estrutura?.elementos)}\nFormat:\n${list(r.estrutura?.formato)}\nChars: target ${r.charTarget?.min}-${r.charTarget?.max}, cap ${r.charTarget?.cap}\nBanned words to watch:\n${list(r.bannedToWatch)}`,
    `\n## Voice (read ${r.voice?.personaFile})\n${list(r.voice?.rules)}`,
    `\n## Real facts (NEVER invent anything outside this)\nwebsite: ${rf.website || 'null'} · funding: ${rf.funding ? JSON.stringify(rf.funding) : 'null'} · painPoint: ${rf.painPoint || 'null'}\n_${rf.aviso}_`,
  ].join('\n');
}

// ── CLI ──
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('uso: node gen.mjs \'{"contact":{...},"company":"...","stage":"FUP_2","intel":{...},"mode":"outbound"}\'');
    process.exit(1);
  }
  let input;
  try { input = JSON.parse(arg); } catch { console.error('arg nao e JSON valido'); process.exit(1); }
  console.log(renderBrief(buildGenerationBrief(input)));
}
