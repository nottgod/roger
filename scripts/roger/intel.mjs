#!/usr/bin/env node
// intel.mjs — camada Intelligence da Roger v5 (F2).
// Orquestra Fundable + Exa + Firecrawl para enriquecer UM lead, detecta os sinais
// OBJETIVOS de timing (icp.md 3.7) e gap (diagnosis.md 3.11), monta o shape que
// score.mjs `classify()` consome, e produz um report acionável.
//
// Sinais SUBJETIVOS do gap signature (founder qualitativo, narrativa inconsistente,
// citado por voz relevante / bridges) NÃO são inferidos por código — entram como
// `needsJudgment` no report, pra humano avaliar. Honestidade > invenção.
//
// Scoring é do score.mjs (F1). intel.mjs NÃO reimplementa scoring.
//
// ESM, Node 24. Sem deps externas. APIs via lib/sources.mjs (fetch nativo).
//
// CLI: node intel.mjs '{"name":"Jane","company":"AcmeRWA"}'  → imprime report JSON.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fundableLookup, findWebsiteViaExa, firecrawlScrape, exaPainPoint,
} from './lib/sources.mjs';
import { classify } from './score.mjs';
import { loadConfig } from './lib/config.mjs';

const CONFIG_PATH = new URL('../../config.js', import.meta.url);

// Lê EXA_KEY / FUNDABLE_KEY / FIRECRAWL_KEY.
// Ordem: env var > config.js (parse leve, sem `import` pois config.js não exporta).
// config.js NUNCA é comitado (segredos). FIRECRAWL_KEY pode só existir no env.
export function loadKeys(env = process.env) {
  // Delegado ao carregador único (lib/config.mjs): process.env > .env > config.js legado.
  // A assinatura segue aceitando `env` para os testes injetarem sem tocar globals.
  return loadConfig({ env }).keys;
}

// ── Coleta: orquestra Fundable → website → Firecrawl → pain-point ────────────
// `deps` permite injetar coletores mockados nos testes (default: os reais).
export async function collectIntel(lead, keys, deps = {}) {
  const _fundableLookup = deps.fundableLookup || fundableLookup;
  const _findWebsiteViaExa = deps.findWebsiteViaExa || findWebsiteViaExa;
  const _firecrawlScrape = deps.firecrawlScrape || firecrawlScrape;
  const _exaPainPoint = deps.exaPainPoint || exaPainPoint;

  const company = (lead && (lead.company || lead.name)) || null;
  const out = {
    fundable: null,
    website: lead?.website || null,
    scraped: {},
    painPoint: null,
    sources: { fundable: 'skip', firecrawl: 'skip', exa: 'skip' },
  };
  if (!company) return out;

  // 1) Fundable: funding/round/founders/investors/headcount
  out.fundable = await _fundableLookup(keys.fundableKey, { companyName: company });
  out.sources.fundable = out.fundable ? 'ok' : 'fail';
  if (out.fundable?.website && !out.website) out.website = out.fundable.website;

  // 2) Website via Exa se ainda falta
  if (!out.website) {
    out.website = await _findWebsiteViaExa(keys.exaKey, company);
  }

  // 3) Firecrawl no site
  if (out.website) {
    out.scraped = await _firecrawlScrape(keys.firecrawlKey, out.website);
    out.sources.firecrawl = (out.scraped && Object.keys(out.scraped).length) ? 'ok' : 'fail';
  }

  // 4) Pain-point via Exa
  out.painPoint = await _exaPainPoint(keys.exaKey, company, out.website);
  out.sources.exa = out.painPoint ? 'ok' : 'fail';

  return out;
}

// ── Detecção de sinais OBJETIVOS (timing 3.7 + gap 3.11) ─────────────────────
// Só marca true o que dá pra inferir de dados coletados. O resto é needsJudgment.
export function detectSignals(collected, lead = {}) {
  const f = collected?.fundable || {};
  const s = collected?.scraped || {};
  const desc = `${s.description || ''} ${collected?.painPoint || ''}`.toLowerCase();

  // --- TIMING (icp.md 3.7) ---
  const timing = {};

  // funding <=12m: precisa de dealDate parseável
  if (f.dealDate) {
    const dt = Date.parse(f.dealDate);
    if (!Number.isNaN(dt)) {
      const months = (Date.now() - dt) / (1000 * 60 * 60 * 24 * 30.44);
      timing.recentFunding = months >= 0 && months <= 12;
    }
  }

  // lançamento recente ou por vir: heurística textual
  if (/\b(launch(ed|ing)?|shipped|rolling out|now live|ga\b)/.test(desc)
      && /\b(soon|upcoming|recently|new|this (month|quarter)|q[1-4]\s?20\d\d)\b/.test(desc)) {
    timing.newLaunch = true;
  }

  // contratando para a área do problema: heurística textual
  if (/\b(hiring|we'?re hiring|join us|open role)\b/.test(desc)) {
    timing.hiringForTheProblem = true;
  }

  // imprensa, parceria ou anúncio recente: heurística textual
  if (/\b(partner(ship|ed)?|integration|collaborat|press|featured|award)/.test(desc)
      && /\b(announc|new|recently|this (month|quarter))\b/.test(desc)) {
    timing.pressCoverage = true;
  }

  // --- GAP (diagnosis.md 3.11) — só os OBJETIVOS ---
  const gap = {};

  // corporativo sem conteúdo de substância: sem blog/research detectável no scrape
  if (collected?.sources?.firecrawl === 'ok') {
    const hasSubstance = /\b(blog|research|whitepaper|case stud|newsletter|documentation|docs)\b/.test(
      `${s.description || ''}`.toLowerCase(),
    );
    gap.genericMessaging = !hasSubstance;
  }

  // founder sem LinkedIn ativo: objetivo-fraco. Só marcamos se o scrape NÃO achou linkedin company
  // E não há linkedin no fundable. (sinal indireto; o qualitativo "inativo 90d" é needsJudgment)
  if (!s.linkedinCompany && !f.linkedin) {
    gap.founderInvisible = undefined; // não afirmamos; vira needsJudgment
  }

  // branding amador: NÃO inferível por código de forma confiável → needsJudgment.

  // sinais SUBJETIVOS que NUNCA inferimos (entram no report como needsJudgment):
  // O que NUNCA inferimos por código: vai para julgamento humano, nomeado.
  const needsJudgment = [
    'noRecentActivity (quieto em público — precisa de olho humano no perfil)',
    'founderInvisible (o dono do problema não aparece)',
    'inconsistentStory (o que o site diz versus o que a pessoa diz)',
    'genericMessaging (a mensagem deles não diz nada de específico)',
  ];

  // limpar chaves undefined (não viram true nem false no shape do score)
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === true || v === false));

  return { timing: clean(timing), gap: clean(gap), needsJudgment };
}

// ── Monta o shape que score.mjs consome e chama classify ─────────────────────
function toScoreLead(lead, collected, signals) {
  const f = collected?.fundable || {};
  const s = collected?.scraped || {};
  // headcount: prioriza valor explícito do lead > Fundable > hint do scrape
  const headcount = typeof lead?.headcount === 'number' ? lead.headcount
    : (typeof f.numEmployees === 'number' ? f.numEmployees
      : (typeof s.teamSizeHint === 'number' ? s.teamSizeHint : undefined));
  return {
    name: lead?.name,
    company: lead?.company || f.name,
    // campos de gate: o que o lead já trouxe vence; Intelligence preenche o detectável
    b2b2: lead?.b2b2,
    headcount,
    web3PostMVP: lead?.web3PostMVP,
    web2Firm: lead?.web2Firm,
    geo: lead?.geo || f.country || s.country,
    decisorAcessivel: lead?.decisorAcessivel,
    budgetProvavel: lead?.budgetProvavel,
    segment: lead?.segment || mapSectorToSegment(s.sector || f.industries?.[0]),
    nonIcpFlags: lead?.nonIcpFlags || [],
    expansaoParaMercadoAlvo: lead?.expansaoParaMercadoAlvo,
    // sinais detectados (objetivos)
    ...signals.timing,
    ...signals.gap,
    // sinais subjetivos que o humano/F3 já tenha confirmado no lead de entrada vencem
    ...pickSubjective(lead),
  };
}

const SUBJECTIVE_KEYS = [
  'founderInativo90d', 'brandingAmador', 'naoCitadoPorVoz', 'chegaFrio',
  'ausenteDasConversas', 'partnershipSemNarrativa', 'inconsistenciaSiteFounder',
  'tvlCrescendo', 'tokenLaunch90d',
];
function pickSubjective(lead = {}) {
  const o = {};
  for (const k of SUBJECTIVE_KEYS) if (lead[k] === true) o[k] = true;
  return o;
}

function mapSectorToSegment(sector) {
  if (!sector) return undefined;
  const m = {
    'RWA': 'rwa', 'LST/LRT': 'lst', 'DeFi': 'asset-management',
    'Chain Abstraction': 'infra', 'AI Infra': 'infra',
    'CeFi Bridge': 'cefi-bridges', 'L2 Infrastructure': 'l2', 'Payments': 'infra',
  };
  return m[sector] || undefined;
}

export function buildIntelReport(lead, collected, signals, classification) {
  return {
    lead: { name: lead?.name || null, company: lead?.company || collected?.fundable?.name || null },
    tier: classification?.tier || null,
    segment: classification?.segment || null,
    angle: classification?.casoParecido || null,
    approach: classification?.abordagem || null,
    timing: {
      detected: Object.keys(signals?.timing || {}).filter((k) => signals.timing[k] === true),
      count: classification?.timing ?? null,
    },
    gap: {
      detected: Object.keys(signals?.gap || {}).filter((k) => signals.gap[k] === true),
      needsJudgment: signals?.needsJudgment || [],
      count: classification?.gap ?? null,
    },
    sources: collected?.sources || {},
    reason: classification?.reason || null,
    raw: {
      website: collected?.website || null,
      fundable: collected?.fundable || null,
      scraped: collected?.scraped || {},
      painPoint: collected?.painPoint || null,
    },
  };
}

// ── Entry point programático ─────────────────────────────────────────────────
export async function runIntel(lead, keys, deps = {}) {
  const collected = await collectIntel(lead, keys, deps);
  const signals = detectSignals(collected, lead);
  const scoreLead = toScoreLead(lead, collected, signals);
  const classification = classify(scoreLead);
  return buildIntelReport(lead, collected, signals, classification);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('uso: node intel.mjs \'{"name":"...","company":"..."}\'');
    process.exit(1);
  }
  let lead;
  try { lead = JSON.parse(arg); } catch { console.error('arg nao e JSON valido'); process.exit(1); }
  const keys = loadKeys();
  runIntel(lead, keys)
    .then((report) => { console.log(JSON.stringify(report, null, 2)); })
    .catch((e) => { console.error('intel falhou:', e?.message); process.exit(1); });
}
