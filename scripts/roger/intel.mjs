#!/usr/bin/env node
// intel.mjs — the Intelligence layer.
// It orchestrates the funding lookup + Exa + Firecrawl to enrich ONE lead, detects the
// OBJECTIVE timing (icp.md 3.7) and gap (diagnosis.md 3.11) signals, builds the shape
// that `classify()` in score.mjs consumes, and produces an actionable report.
//
// The SUBJECTIVE gap signals (a qualitative read on the founder, an inconsistent story,
// being cited by a voice that matters) are NOT inferred by code — they land in the report
// as `needsJudgment`, for a human to weigh. Honesty over invention.
//
// Scoring belongs to score.mjs. intel.mjs does NOT reimplement scoring.
//
// ESM, Node 24. No external deps. APIs via lib/sources.mjs (native fetch).
//
// CLI: node intel.mjs '{"name":"Jane","company":"AcmeRWA"}'  → prints the report as JSON.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  fundableLookup, findWebsiteViaExa, firecrawlScrape, exaPainPoint,
} from './lib/sources.mjs';
import { classify } from './score.mjs';
import { loadConfig } from './lib/config.mjs';

const CONFIG_PATH = new URL('../../config.js', import.meta.url);

// Reads EXA_KEY / FUNDABLE_KEY / FIRECRAWL_KEY.
// Order: env var > .env > legacy config.js.
// config.js is NEVER committed (secrets). FIRECRAWL_KEY may exist only in the env.
export function loadKeys(env = process.env) {
  // Delegated to the single loader (lib/config.mjs): process.env > .env > legacy config.js.
  // The signature still accepts `env` so the tests can inject without touching globals.
  return loadConfig({ env }).keys;
}

// ── Collection: funding → website → Firecrawl → pain point ───────────────────
// `deps` lets the tests inject mocked collectors (default: the real ones).
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

  // 1) funding: round, founders, investors, headcount
  out.fundable = await _fundableLookup(keys.fundableKey, { companyName: company });
  out.sources.fundable = out.fundable ? 'ok' : 'fail';
  if (out.fundable?.website && !out.website) out.website = out.fundable.website;

  // 2) website via Exa, if it is still missing
  if (!out.website) {
    out.website = await _findWebsiteViaExa(keys.exaKey, company);
  }

  // 3) Firecrawl on the site
  if (out.website) {
    out.scraped = await _firecrawlScrape(keys.firecrawlKey, out.website);
    out.sources.firecrawl = (out.scraped && Object.keys(out.scraped).length) ? 'ok' : 'fail';
  }

  // 4) pain point via Exa
  out.painPoint = await _exaPainPoint(keys.exaKey, company, out.website);
  out.sources.exa = out.painPoint ? 'ok' : 'fail';

  return out;
}

// ── Detecting the OBJECTIVE signals (timing 3.7 + gap 3.11) ─────────────────
// It only marks true what can be inferred from collected data. The rest is needsJudgment.
export function detectSignals(collected, lead = {}) {
  const f = collected?.fundable || {};
  const s = collected?.scraped || {};
  const desc = `${s.description || ''} ${collected?.painPoint || ''}`.toLowerCase();

  // --- TIMING (icp.md 3.7) ---
  const timing = {};

  // funded within 12 months: needs a parseable deal date
  if (f.dealDate) {
    const dt = Date.parse(f.dealDate);
    if (!Number.isNaN(dt)) {
      const months = (Date.now() - dt) / (1000 * 60 * 60 * 24 * 30.44);
      timing.recentFunding = months >= 0 && months <= 12;
    }
  }

  // a recent or upcoming launch: text heuristic
  if (/\b(launch(ed|ing)?|shipped|rolling out|now live|ga\b)/.test(desc)
      && /\b(soon|upcoming|recently|new|this (month|quarter)|q[1-4]\s?20\d\d)\b/.test(desc)) {
    timing.newLaunch = true;
  }

  // hiring for the area of the problem: text heuristic
  if (/\b(hiring|we'?re hiring|join us|open role)\b/.test(desc)) {
    timing.hiringForTheProblem = true;
  }

  // press, a partnership or a recent announcement: text heuristic
  if (/\b(partner(ship|ed)?|integration|collaborat|press|featured|award)/.test(desc)
      && /\b(announc|new|recently|this (month|quarter))\b/.test(desc)) {
    timing.pressCoverage = true;
  }

  // --- GAP (diagnosis.md 3.11) — only the OBJECTIVE ones ---
  const gap = {};

  // a corporate site with no substance: no blog or research detectable in the scrape
  if (collected?.sources?.firecrawl === 'ok') {
    const hasSubstance = /\b(blog|research|whitepaper|case stud|newsletter|documentation|docs)\b/.test(
      `${s.description || ''}`.toLowerCase(),
    );
    gap.genericMessaging = !hasSubstance;
  }

  // founder with no active LinkedIn: weakly objective. We only mark it when the scrape did
  // NOT find a company LinkedIn AND there is none in the funding data. (The qualitative
  if (!s.linkedinCompany && !f.linkedin) {
    gap.founderInvisible = undefined; // we do not affirm it; it becomes needsJudgment
  }

  // amateur branding: NOT reliably inferable by code → needsJudgment.

  // The SUBJECTIVE signals we NEVER infer (they enter the report as needsJudgment):
  // What we never infer by code goes to human judgment, named.
  const needsJudgment = [
    'noRecentActivity (quiet in public — needs a human eye on the profile)',
    'founderInvisible (the owner of the problem does not show up)',
    'inconsistentStory (o que o site diz versus o que a pessoa diz)',
    'genericMessaging (a mensagem deles não diz nada de específico)',
  ];

  // strip undefined keys (they must not become true or false in the score shape)
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v === true || v === false));

  return { timing: clean(timing), gap: clean(gap), needsJudgment };
}

// ── Builds the shape score.mjs consumes, and calls classify ──────────────────
function toScoreLead(lead, collected, signals) {
  const f = collected?.fundable || {};
  const s = collected?.scraped || {};
  // headcount: an explicit value on the lead wins > funding data > a hint from the scrape
  const headcount = typeof lead?.headcount === 'number' ? lead.headcount
    : (typeof f.numEmployees === 'number' ? f.numEmployees
      : (typeof s.teamSizeHint === 'number' ? s.teamSizeHint : undefined));
  return {
    name: lead?.name,
    company: lead?.company || f.name,
    // gate fields: what the lead already carried wins; Intelligence fills in what it can detect
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
    // detected signals (the objective ones)
    ...signals.timing,
    ...signals.gap,
    // subjective signals a human already confirmed on the incoming lead win
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

// ── Programmatic entry point ─────────────────────────────────────────────────
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
