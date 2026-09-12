#!/usr/bin/env node
// gen.mjs — camada Geração (Roger v5, F3). Motor único, dois modos.
// FILOSOFIA: determinismo no QUE entra (este builder), liberdade no COMO sai (LLM redige),
// trava dura na saída (lint-voz.mjs). buildGenerationBrief() é PURA e no-throw: recebe o report
// já classificado do intel.mjs (NÃO re-classifica, NÃO chama score.mjs) + contato/stage do Kommo,
// e monta o brief das 3 camadas (diagnóstico, cultura, redação). Em mode:'conversation' a camada
// Redação vira leitura-de-sinais + BANT + objeção->reframe + regra-de-voz.
//
// NÃO mexe na cadência (só LÊ via loadCadencia). conversation mode NÃO cria task no Kommo.
// Loaders parseiam os .md do context pack em runtime (mesmo padrão de cadencia.mjs) com
// FALLBACK hardcoded (no-throw). ESM, Node 24. Sem deps externas.
//
// CLI: node gen.mjs '{"contact":{...},"company":"...","stage":"FUP_2","intel":{...},"mode":"outbound"}'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCadencia } from './cadencia.mjs';
import { loadVoice } from './lib/voice.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAPPORT = join(ROOT, 'rapport');

// Qual contexto e qual operador. TODO (Bloco C): exigir as duas variáveis e falhar alto
// quando faltarem; o default abaixo existe só para não quebrar a instalação atual.
export const CONTEXT = process.env.ROGER_CONTEXT || 'example';
export const DEFAULT_OPERATOR = process.env.ROGER_OPERATOR || 'example';
const PACK = join(ROOT, 'rapport', 'contexts', CONTEXT);

// Arquivos de contexto que faltaram na leitura. O fallback embutido evita o crash,
// mas o silêncio era o problema: sem este registro, um pacote de contexto pela metade
// gerava mensagem com o texto de outra empresa sem ninguém perceber.
const missingPackFiles = new Set();
export function contextHealth() {
  return { context: CONTEXT, pack: PACK, missing: [...missingPackFiles] };
}

// ── leitura crua + parser de tabela markdown (padrão cadencia.mjs) ──
function readPack(relPath, base = PACK) {
  try {
    return readFileSync(join(base, relPath), 'utf8');
  } catch {
    missingPackFiles.add(join(base === PACK ? CONTEXT : 'rapport', relPath));
    return '';
  }
}

// Extrai linhas de tabela (| a | b | c |) que aparecem DEPOIS do header que casa headerRe.
// Retorna array de arrays de células (trim). Ignora a linha separadora |---|. Para no primeiro
// bloco não-tabela depois de a tabela já ter começado.
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

// ── FALLBACK: espelham os .md. Se o parse falhar, o brief degrada sem crashar. ──
const GEO_TO_REGION = {
  usa: 'USA NY', us: 'USA NY', 'united states': 'USA NY',
  uk: 'UK', 'united kingdom': 'UK',
  germany: 'Germânico (DE/CH)', alemanha: 'Germânico (DE/CH)',
  switzerland: 'Germânico (DE/CH)', 'suíça': 'Germânico (DE/CH)', suica: 'Germânico (DE/CH)',
  austria: 'Germânico (DE/CH)', 'áustria': 'Germânico (DE/CH)',
  france: 'França', 'frança': 'França',
  uae: 'UAE', dubai: 'UAE',
  singapore: 'Singapura / HK', singapura: 'Singapura / HK', 'hong kong': 'Singapura / HK', hk: 'Singapura / HK',
  japan: 'East Asia (JP/KR)', 'japão': 'East Asia (JP/KR)', japao: 'East Asia (JP/KR)',
  'south korea': 'East Asia (JP/KR)', 'coreia do sul': 'East Asia (JP/KR)', korea: 'East Asia (JP/KR)',
  brazil: 'LATAM (expansion)', brasil: 'LATAM (expansion)', mexico: 'LATAM (expansion)',
  'méxico': 'LATAM (expansion)', argentina: 'LATAM (expansion)', colombia: 'LATAM (expansion)',
};
const FALLBACK_CULTURE = {
  'USA NY': { registro: 'direto, bottom-line primeiro', abertura: "Quick one, saw X. Curious how you're handling Y." },
  'USA SF / Miami': { registro: 'relacional, mais caloroso', abertura: "Hey, been following what you're building with X." },
  'UK': { registro: 'formal, humor seco', abertura: 'Came across X, well played. Wondering about Y.' },
  'Germânico (DE/CH)': { registro: 'factual, evidência, sem synergy-flattery', abertura: 'X stands out for [fact]. How are you approaching Y?' },
  'França': { registro: 'conceitual, mais elaborado', abertura: 'Bonjour, votre approche sur X est intéressante.' },
  'UAE': { registro: 'relacional com formalidade', abertura: 'Hello [Name], impressive work on X.' },
  'Singapura / HK': { registro: 'eficiente, educado', abertura: 'Hi [Name], noticed X. Quick question on Y.' },
  'East Asia (JP/KR)': { registro: 'indireto, hierárquico, paciência', abertura: '[Name]-san, I admire the work on X.' },
  'LATAM (expansion)': { registro: 'relacional, warmth', abertura: 'Hey, vi o que vocês tão fazendo com X.' },
};
const TRANSVERSAL = {
  germanic: 'Germânico: nunca abrir com elogio vazio (amazing/love what you\'re doing); abrir com fato observado.',
  eastAsia: 'East Asia formal: paciência, sem CTA agressivo no primeiro toque.',
};

const SEG_ALIAS = {
  payments: 'payments', marketplaces: 'marketplaces',
  neobanks: 'neobanks', lending: 'lending',
};
// Espelha a tabela 3.12 do diagnosis.md do contexto ativo. Se o .md tiver a linha, ela vence.
const FALLBACK_VOCAB = {
  payments: { narrativa: 'Cada provedor novo traz um arquivo de settlement que ninguem assume', vocab: 'settlement file, chargeback, payout window, taxas do provedor' },
  marketplaces: { narrativa: 'Split de pagamento faz o ledger nunca bater com o banco na primeira tentativa', vocab: 'split payment, payout do vendedor, escrow, take rate' },
  neobanks: { narrativa: 'O crescimento multiplica o volume mais rapido que o time de financas', vocab: 'lancamento, conta transitoria, quebra, fechamento diario' },
  lending: { narrativa: 'Provisao de juros e pagamentos discordam no fim de todo mes', vocab: 'accrual, amortizacao, cronograma de pagamento, inadimplencia' },
};

const STRUCTURE_77 = {
  elementos: [
    'gancho específico (algo real e observado do lead, não genérico)',
    'observação consultiva (diagnóstico leve, não pitch)',
    'pergunta aberta (uma só, que força resposta)',
  ],
  formato: [
    'menos de 600 chars, 3 a 4 frases',
    'sem saudação formal, sem fechamento corporativo',
    "contrações (it's, you're, we've)",
    '1 imperfeição humana deliberada (minúscula no início, typo leve, contração informal)',
  ],
};
const FALLBACK_APPROACH = {
  Provocativo: 'persona que responde a tese/posição forte (founder opinativo, degen-native)',
  Case: 'persona que valida por prova social (CMO, Head of Growth)',
  'Engajamento Contextual': 'lead postou algo recente, comentar/responder com substância',
  Evento: 'lead vai a um evento onde você também estará',
  Institucional: 'C-level senior, firm/family office, registro formal',
};

// Só o ÂNGULO do toque. O intervalo (D+N) vem da cadência (fonte única: cadencia-funil.md via touchAngle).
// Prospecção DIRETA: todo toque, exceto o handshake e o break-up, fecha chamando pro papo.
const STAGE_ANGLE = {
  MENSAGEM_INICIAL: 'primeiro toque DIRETO: gancho de 1 linha + o que você faz + CTA de call. Com campanha: handshake curto, sem pitch, sem pergunta',
  connection: 'connection request: menos de 300 chars, sem pedido de call',
  FUP_1: 'campanha: o pitch na mesma thread (contexto prometido + posicionamento + CTA de call). Sem campanha: curto, sem reintroduzir, fecha com CTA de call',
  FUP_2: 'provocação com insight, TROCA DE ÂNGULO (não repetir a anterior) + CTA de call leve',
  FUP_3: 'prova social (case/cliente concreto) + CTA de call',
  FUP_4: 'chamada direta pra call de 15 min (ou troca de canal LinkedIn <-> Telegram)',
  FUP_5: 'última fisgada, mescla abordagem + CTA de call',
  FUP_MAIS: 'última tentativa honesta (break-up), porta aberta, sem pedir call (converte 5-10%)',
};

// ── templates da mensagem ──────────────────────────────────────────────────────
// Fonte: `mensagens.md` do context pack ativo. O fallback abaixo é um ESQUELETO
// genérico de propósito: o que a empresa faz é do contexto, não do motor.
const MSGS_FILE = 'mensagens.md';
const FALLBACK_TEMPLATES = {
  M1: "Great to connect, {Nome}! I'll write to you shortly with some context on why I reached out.",
  M2: '{Nome}, as promised, some context. {o que você faz, em uma frase}. Worth a quick call this week to see if it fits what you are building?',
  M2_DIRETO: '{Nome}, {gancho específico de 1 linha}. {o que você faz, em uma frase}. Open to a quick call this week?',
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

// Campanha pré-pronta (CF Campanha): M1 na Mensagem Inicial, M2 na FUP_1. Sem campanha: MI = M2-direto.
export function templateKeyFor(stage, campanha) {
  const s = String(stage || '').toUpperCase();
  const isCampaign = !!(campanha && String(campanha).trim());
  if (/MENSAGEM_INICIAL|INICIAL/.test(s)) return isCampaign ? 'M1' : 'M2_DIRETO';
  if (s === 'FUP_1' && isCampaign) return 'M2';
  return null;
}

// Fallback de regras de voz. A voz de verdade vive em operators/<slug>/voice.json
// (campo `rules`), gerado pela entrevista. Isto aqui é só o que sobra quando não há voz
// nenhuma declarada — e `voiceSnippets` avisa quando está neste caso.
const FALLBACK_VOICE_RULES = [
  'oral e direto, do jeito que a pessoa fala',
  'uma pergunta só, aberta, que dá vontade de responder',
  'tom diagnóstico, não venda: alguém que viu um detalhe, não um vendedor pedindo tempo',
];

// ── helpers puros ──
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
  if (region === 'Germânico (DE/CH)') transversal.push(TRANSVERSAL.germanic);
  if (region === 'East Asia (JP/KR)') transversal.push(TRANSVERSAL.eastAsia);
  return {
    geo: geo || null,
    region: region || '(geo não mapeado, default registro neutro)',
    registro: base ? base.registro : 'direto, bottom-line primeiro (geo não mapeado)',
    abertura: base ? base.abertura : '',
    transversal,
  };
}

export function segmentVocab(segment) {
  const slug = (segment == null ? '' : String(segment)).trim().toLowerCase();
  const label = SEG_ALIAS[slug] || slug;
  // segment vazio/desconhecido: degrada pra null. Sem isto, label '' + rowLabel.includes('')
  // sempre-true fazia o loop casar o CABEÇALHO da tabela 3.12 e vazá-lo como narrativa/vocab pro brief.
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
    // De onde a voz veio: 'file' = voice.json da pessoa; 'defaults' = ninguém declarou,
    // estamos escrevendo com regra genérica; 'invalid' = arquivo quebrado.
    voiceSource: resolved.source,
    voiceFile: resolved.path,
    voiceError: resolved.error,
    voice: resolved.voice,
  };
}

// ── camada diagnóstico (constante global) ──
// A dor central vem do contexto (tabela `3.9.M` do diagnosis.md). O fallback não descreve
// negócio nenhum de propósito: ele manda a pessoa escrever a dela.
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
  'agency / marketing services / growth consultancy (banidos de domínio)',
  'em-dash (—), pipe (|), markdown vazando',
  'jargão consultor (hook, framing, lift, circling back, make sense?, doing a lot of work)',
  'métricas de vaidade (X impressions, X% engagement)',
  'pedido de call em connection request (nota de CR)',
  'saudação formal (Hey/Hi/Hello/Dear); múltiplas perguntas',
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
    aviso: 'Use só fatos presentes aqui. Campo null = desconhecido. NUNCA inventar funding/número.',
  };
}

function outboundGate(intel = {}) {
  if (!intel || intel.tier === 'DESCARTE') {
    return { go: false, skipReason: `DESCARTE: ${intel?.reason || 'fora do ICP'} — não gerar` };
  }
  const gapCount = intel.gap?.count ?? 0;
  const src = intel.sources || {};
  const srcOk = src.fundable === 'ok' || src.exa === 'ok' || src.firecrawl === 'ok';
  if (intel.tier === 'FRIO' && gapCount === 0 && !srcOk) {
    return { go: false, skipReason: 'sem matéria pra msg forte (FRIO + gap raso + fontes pobres) — não gerar placeholder' };
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
      templatesFile: join(RAPPORT, MSGS_FILE),
      rule: campanha
        ? 'campanha pré-pronta: usar o template (variar levemente, anti-blast). Cadência já semeada nos cards — NUNCA criar FUP nova'
        : (taskText ? 'seguir a instrução do texto da task (instrução do card manda)' : 'sem instrução no card: usar o ângulo do toque (padrão direto M1/M2, fechar chamando pra call)'),
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

// ── conversation: objeções e BANT vêm do CONTEXTO, não do motor ────────────────
// Fonte: tabelas `C.3.M` (objeções) e `C.2.M` (BANT) do `conversation.md` do pacote ativo.
// Os fallbacks abaixo são genéricos de propósito: a doutrina comercial de uma empresa não
// pertence ao código. Na coluna `match`, alternativas são separadas por `;;`, porque `|`
// é o separador de célula do markdown.
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
  // recusa educada: NÃO é positive (o substring 'interested' nu sequestrava o sinal). É alerta, não descarte.
  if (/\b(not|no longer|never)\s+(interested|looking)\b|uninterested|not (a )?(good )?fit|sem interesse|n[ãa]o (tenho|temos|há) interesse/.test(t)) return 'alert';
  // referral = lead te passa pro DECISOR (terceiro). Verbos ambíguos ancorados a 3a pessoa pra não pegar
  // convite self-referencial ("talk to you", "reach out to me"), que é caminho positive/chefe-modo, não handoff.
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
    skipReason: signal === 'discard' ? 'sinal de descarte: encerrar honesto, não forçar próxima msg' : null,
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

// ── render: GenerationBrief -> markdown legível pro LLM redigir ──
function list(arr) { return (arr && arr.length) ? arr.map((x) => `- ${x}`).join('\n') : '- (nenhum)'; }

export function renderBrief(brief) {
  if (!brief) return '(brief vazio)';
  const head = `# GenerationBrief — modo ${brief.mode} — ${brief.company || '(sem empresa)'}`;
  if (brief.go === false) {
    return `${head}\n\n## NÃO GERAR (SKIP)\n${brief.skipReason || 'sem razão registrada'}\n`;
  }
  if (brief.mode === 'conversation') {
    const o = brief.objection;
    return [
      head,
      `**Última msg do lead:** ${brief.lastLeadMsg || '(não fornecida)'}`,
      `**Sinal:** ${brief.signal}`,
      `**Regra de voz:** ${brief.voiceRule?.rule} — ${brief.voiceRule?.why}`,
      o ? `**Objeção detectada:** ${o.key}\n**Reframe:** ${o.reframe}` : '**Objeção detectada:** nenhuma',
      `\n## Diagnóstico\nDor central: ${brief.diagnostic?.dorCentral}\nSegmento: ${brief.diagnostic?.segment || '?'} — vocabulário: ${brief.diagnostic?.vocab || '?'}`,
      `\n## BANT leve (1 pergunta por vez)\n${list((brief.bant?.probe || []).map((b) => `${b.key}: ${b.sondar}`))}`,
      `\n## Cultura\nRegião: ${brief.culture?.region} — registro: ${brief.culture?.registro}\n${list(brief.culture?.transversal)}`,
      `\n## Voz (ler ${brief.voice?.personaFile})\n${list(brief.voice?.rules)}`,
      `\n## Catálogo completo: ${brief.contextFile}`,
      `\n_${brief.note}_`,
    ].join('\n');
  }
  const d = brief.diagnostic || {}; const r = brief.redacao || {}; const c = brief.culture || {}; const rf = brief.rawFacts || {}; const cd = brief.card || {};
  return [
    head,
    `Stage: ${brief.stage} · contato: ${brief.contact?.name || '?'} (${brief.contact?.role || '?'}, ${brief.contact?.geo || '?'})`,
    `\n## 0. Instrução do card (manda sobre o resto)\nCampanha: ${cd.campanha || '(sem)'} · texto da task: ${cd.taskText || '(sem)'}\nRegra: ${cd.rule || '?'}${cd.template ? `\nTemplate ${cd.templateKey} (base, variar por lead): "${cd.template}"` : ''}\nTemplates editáveis em: ${cd.templatesFile || '?'}`,
    `\n## 1. Diagnóstico\nDor central: ${d.dorCentral}\nÂngulo (caso parecido): ${d.angle || '?'}\nAbordagem sugerida: ${d.approach || '?'}\nSegmento: ${d.segment || '?'} — narrativa: ${d.narrativa || '?'}\nVocabulário pra soar crível: ${d.vocab || '?'}\nGap detectado: ${(d.gapDetected || []).join(', ') || '(nenhum objetivo)'}\nGap a julgar (NÃO inventar): ${(d.gapNeedsJudgment || []).join('; ') || '(nenhum)'}\nTiming: ${(d.timingDetected || []).join(', ') || '(nenhum)'}`,
    `\n## 2. Cultura\nRegião: ${c.region} — registro: ${c.registro}\nAbertura exemplo: ${c.abertura || '?'}\n${list(c.transversal)}`,
    `\n## 3. Redação\nÂngulo do toque: ${r.touchAngle?.angle} (+${r.touchAngle?.days ?? '?'}d do toque anterior)\nQuando usar a abordagem: ${r.quando || '?'}\nEstrutura (7.7):\n${list(r.estrutura?.elementos)}\nFormato:\n${list(r.estrutura?.formato)}\nChars: alvo ${r.charTarget?.min}-${r.charTarget?.max}, cap ${r.charTarget?.cap}\nBanidos a vigiar:\n${list(r.bannedToWatch)}`,
    `\n## Voz (ler ${r.voice?.personaFile})\n${list(r.voice?.rules)}`,
    `\n## Fatos reais (NUNCA inventar fora disto)\nwebsite: ${rf.website || 'null'} · funding: ${rf.funding ? JSON.stringify(rf.funding) : 'null'} · painPoint: ${rf.painPoint || 'null'}\n_${rf.aviso}_`,
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
