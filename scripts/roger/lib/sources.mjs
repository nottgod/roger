#!/usr/bin/env node
// sources.mjs — the low level collectors of the Intelligence layer.
//
// PORTABLE CORE: this module is an adapted copy of collectors that lived in an earlier,
// private lead-finder codebase (Exa search, Firecrawl scraping, a funding lookup). The
// duplication is intentional: that layer is separate from the Roger core, and nothing
// here imports from it. If you are reading this in the open repo, there is nothing
// missing — this file is self contained.
//
//
// FAILURE CONTRACT (an invariant across the whole module):
//   No function THROWS. On error, timeout or an invalid response they return null (for a
//   single object) or {} / [] (for a collection). The caller handles absence, not exceptions.
//
// Injectable fetch: every function accepts opts.fetchImpl (default: globalThis.fetch).
// That lets the tests mock the network without touching globals.
//
// ESM, Node 24. No external deps.

const EXA_SEARCH = 'https://api.exa.ai/search';
const FIRECRAWL_SCRAPE = 'https://api.firecrawl.dev/v1/scrape';
const FUNDABLE_BASE = 'https://www.tryfundable.ai/api/v1';

const DEFAULT_TIMEOUT_MS = 15000;

// fetch with a timeout via AbortController; never throws (returns null on failure).
async function safeFetch(fetchImpl, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Exa: generic semantic search ────────────────────────────────────────────
// pattern: POST with x-api-key + contents.highlights
export async function exaSearch(exaKey, query, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!exaKey || !query) return { results: [] };
  const body = {
    query,
    numResults: opts.numResults || 3,
    ...(opts.category ? { category: opts.category } : {}),
    ...(opts.includeDomains ? { includeDomains: opts.includeDomains } : {}),
    ...(opts.startPublishedDate ? { startPublishedDate: opts.startPublishedDate } : {}),
    contents: { highlights: { maxCharacters: 400, numSentences: 2 } },
  };
  const res = await safeFetch(fetchImpl, EXA_SEARCH, {
    method: 'POST',
    headers: { 'x-api-key': exaKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, opts.timeoutMs);
  if (!res || !res.ok) return { results: [] };
  try {
    const data = await res.json();
    return { results: data.results || [] };
  } catch {
    return { results: [] };
  }
}

// ── Exa: pain point summary ─────────────────────────────────────────────────
export async function exaPainPoint(exaKey, companyName, website, opts = {}) {
  if (!exaKey || !companyName) return null;
  let includeDomains;
  if (website) {
    try { includeDomains = [new URL(website).hostname]; } catch { includeDomains = undefined; }
  }
  const { results } = await exaSearch(
    exaKey,
    `${companyName} Web3 crypto blockchain company pain point challenge`,
    { category: 'company', numResults: 3, includeDomains, ...opts },
  );
  return results?.[0]?.highlights?.join(' ') || null;
}

// ── Exa: find the website ───────────────────────────────────────────────────
export async function findWebsiteViaExa(exaKey, companyName, opts = {}) {
  if (!exaKey || !companyName) return null;
  const { results } = await exaSearch(
    exaKey,
    `${companyName} Web3 crypto blockchain company official site`,
    { category: 'company', numResults: 3, ...opts },
  );
  return results?.[0]?.url || null;
}

// ── Firecrawl: scrape a site ────────────────────────────────────────────────
export async function firecrawlScrape(firecrawlKey, url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!firecrawlKey || !url) return {};
  const res = await safeFetch(fetchImpl, FIRECRAWL_SCRAPE, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true, waitFor: 2000 }),
  }, opts.timeoutMs);
  if (!res || !res.ok) return {};
  try {
    const data = await res.json();
    const markdown = data?.data?.markdown || '';
    return extractFromMarkdown(markdown);
  } catch {
    return {};
  }
}

// boilerplate = a cookie/privacy/skip-nav banner, OR a list of tags and stack
// (>= 6 comma separated parts averaging <= 2 words each = short tokens).
function isBoilerplate(p) {
  if (/cookie|we value your privacy|accept all|privacy policy|skip to (main )?content/i.test(p)) return true;
  const parts = p.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 6) {
    const avgWords = parts.reduce((sum, part) => sum + part.split(/\s+/).filter(Boolean).length, 0) / parts.length;
    if (avgWords <= 2) return true;
  }
  return false;
}

// ── Heuristic extraction ────────────────────────────────────────────────────
// Returns { linkedinCompany?, twitter?, teamSizeHint?, description?, country?, sector? }
export function extractFromMarkdown(content) {
  const result = {};
  if (!content) return result;

  const liMatch = content.match(/https?:\/\/(?:www\.)?linkedin\.com\/company\/[a-zA-Z0-9_-]+/);
  if (liMatch) result.linkedinCompany = liMatch[0];

  const twMatch = content.match(/https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/);
  if (twMatch && !['home', 'share', 'intent'].includes(twMatch[1].toLowerCase())) {
    result.twitter = twMatch[0];
  }

  const teamMatch = content.match(/\b(\d{1,3})\s*(?:employees?|people|team members?|full.?time)\b/i);
  if (teamMatch) result.teamSizeHint = parseInt(teamMatch[1], 10);

  const paras = content.split('\n\n').map((p) => p.trim()).filter((p) => p.length > 40 && !p.startsWith('#'));
  if (paras.length > 0) {
    const clean = paras.find((p) => !isBoilerplate(p));
    result.description = (clean || paras[0]).slice(0, 200); // fallback: 1º parágrafo se tudo for boilerplate
  }

  const countryMap = [
    [/\b(United States|USA|San Francisco|New York|Silicon Valley)\b/i, 'United States'],
    [/\b(United Kingdom|UK|London)\b/i, 'United Kingdom'],
    [/\b(Singapore)\b/i, 'Singapore'],
    [/\b(Hong Kong)\b/i, 'Hong Kong'],
    [/\b(Dubai|UAE|United Arab Emirates)\b/i, 'UAE'],
    [/\b(Switzerland|Zug|Geneva)\b/i, 'Switzerland'],
    [/\b(Cayman Islands)\b/i, 'Cayman Islands'],
    [/\b(British Virgin Islands|BVI)\b/i, 'BVI'],
  ];
  for (const [pattern, country] of countryMap) {
    if (pattern.test(content)) { result.country = country; break; }
  }

  const catMap = [
    [/\b(RWA|real.world asset|tokeniz)/i, 'RWA'],
    [/\b(liquid staking|LST|LRT|restaking)\b/i, 'LST/LRT'],
    [/\b(DeFi|decentralized finance|liquidity|yield)\b/i, 'DeFi'],
    [/\b(chain.?abstraction)\b/i, 'Chain Abstraction'],
    [/\b(AI infra|AI infrastructure|machine learning.*crypto|crypto.*AI)\b/i, 'AI Infra'],
    [/\b(CeFi|centralized finance|exchange|bridge)\b/i, 'CeFi Bridge'],
    [/\b(layer 2|L2|rollup|zk)\b/i, 'L2 Infrastructure'],
    [/\b(payment|stablecoin)\b/i, 'Payments'],
  ];
  for (const [pattern, cat] of catMap) {
    if (pattern.test(content)) { result.sector = cat; break; }
  }

  return result;
}

// ── Funding: look up ONE company by name ────────────────────────────────────
// Finds the most recent deal matching the name, then fetches the company detail.
// Returns an enriched object or null. Never throws. NO cache (the cache in the original
// depended on browser storage, so it was not ported).
//
export async function fundableLookup(fundableKey, { companyName, fetchImpl, timeoutMs } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (!fundableKey || !companyName) return null;

  // 1) fetch recent deals (a broad filter; the fine grained one is score.mjs's job)
  const dealsRes = await safeFetch(f, `${FUNDABLE_BASE}/deals/`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${fundableKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      company: { industries: ['cryptocurrency', 'web3-34b4', 'blockchain'], locations: [] },
      deal: {},
      page_size: 50,
      page: 1,
      sort_by: 'most_recent_deal',
    }),
  }, timeoutMs);
  if (!dealsRes || !dealsRes.ok) return null;

  let deals;
  try {
    const data = await dealsRes.json();
    deals = data?.data?.deals || [];
  } catch {
    return null;
  }

  // 2) find the deal whose company name matches (normalised)
  const target = normName(companyName);
  const match = deals.find((d) => d.company_name && normName(d.company_name) === target)
    || deals.find((d) => d.company_name && normName(d.company_name).includes(target));
  if (!match || !match.company_id) return null;

  // 3) fetch the company detail
  const compRes = await safeFetch(f, `${FUNDABLE_BASE}/company/?id=${match.company_id}`, {
    headers: { 'Authorization': `Bearer ${fundableKey}` },
  }, timeoutMs);
  if (!compRes || !compRes.ok) return null;

  let company;
  try {
    const data = await compRes.json();
    company = data?.data?.company;
  } catch {
    return null;
  }
  if (!company) return null;

  return buildFundableEntry(company, match);
}

// builds the company entry, with no browser deps
function buildFundableEntry(c, deal) {
  return {
    name: c.name || null,
    domain: c.domain || null,
    website: c.domain ? `https://${c.domain}` : null,
    linkedin: c.linkedin || null,
    twitter: c.twitter || null,
    industries: (c.industries || []).map((i) => i?.name).filter(Boolean),
    country: c.location?.country?.name || c.location?.region?.name || null,
    numEmployees: c.num_employees || null,
    stage: fundableStage(deal),
    amountRaisedUsd: deal?.total_round_raised || null,
    dealDate: deal?.announced_date || deal?.date || null, // ISO se disponível
    investors: (deal?.investors || []).map((i) => i?.name).filter(Boolean),
    source: 'fundable',
  };
}

function fundableStage(deal) {
  if (!deal) return 'seed';
  if (deal.pre) return 'pre-seed';
  switch (deal.round_type) {
    case 'SERIES_A': return 'series-a';
    case 'SERIES_B': return 'series-b';
    case 'GRANT': return 'grant';
    case 'ACCELERATOR': return 'accelerator';
    default: return 'seed';
  }
}

function normName(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase().replace(/\s+/g, ' ');
}
