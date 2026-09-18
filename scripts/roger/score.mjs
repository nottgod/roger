#!/usr/bin/env node
// score.mjs — scoring how warm a lead is. Pure functions: they take a `lead` and classify it.
//
// WHAT CHANGED: the ICP left the code. Geographies, out-of-market flags, segments, numbers
// (headcount, budget floor, gap and timing thresholds) and the names of the signals are all
// READ from the `icp.md` of the active context pack, in the tables marked `.M`. They used to
// be constants in here — which made the engine serve one company only, even though the
// comment at the top claimed the file "encodes the ICP from icp.md". Now it really does.
//
// The constants became a FALLBACK: a pack without those tables still works exactly the same,
// and `loadIcp().missing` says what was not found.
//
// No external deps. ESM.
//
// The lead shape it expects (missing fields are treated as unknown):
// {
//   name, company,
//   b2b2: bool,                 // sells to businesses (not mass consumers)?
//   headcount: number,
//   web3PostMVP: bool,          // product live, or launching within 90 days
//   web2Firm: bool,             // a qualified investment firm / family office (3.2.1)
//   geo: string,
//   decisorAcessivel: bool,     // is there a reachable decision maker
//   budgetProvavel: number,     // estimated USD per month
//   segment: string,            // a slug from 3.3.M
//   nonIcpFlags: [string],      // slugs from 3.6.M
//   expansaoParaMercadoAlvo: bool,
//   ...gap (3.11.M) and timing (3.7.M) signals, as booleans
// }

import { readContextFile, parseTable, parseKeyValueTable, splitList, contextDir } from './lib/md.mjs';

// ── FALLBACK: mirrors what used to be hardcoded ───────────────────────────────
const FALLBACK = {
  numbers: {
    headcount_min: 1,
    headcount_max: 100000,
    budget_floor_usd_month: 0,
    stage_gate: 0,
    gap_material_min: 2,
    timing_forte_min: 1,
  },
  // With no table in icp.md, no geography is refused: refusing in silence would be worse.
  geoAccept: [],
  geoDiscard: [],
  nonIcp: [],
  segments: {},
  gapKeys: ['noRecentActivity', 'genericMessaging', 'founderInvisible', 'inconsistentStory'],
  timingKeys: ['recentFunding', 'hiringForTheProblem', 'newLaunch', 'pressCoverage'],
};

export const DEFAULT_APPROACH = 'Engajamento Contextual';
export const NO_CASE = 'no direct case, cite the wider portfolio';

function norm(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
}

// A number from the .md with a safety net: an empty cell, text ("lots") or junk falls back
// to the default. Without the format check, `Number('')` is 0 — and a silent 0 would become
// a gate that accepts anything.
function intOr(value, dflt) {
  const raw = String(value ?? '').trim();
  if (!raw) return dflt;
  const cleaned = raw.replace(/[^\d-]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return dflt;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : dflt;
}

// ── loading the ICP ───────────────────────────────────────────────────────────
const cache = new Map();

// loadIcp({ text })     → parses this text (used by the tests, without touching disk)
// loadIcp({ packDir })  → reads the icp.md of that pack
// loadIcp()             → reads the pack of the active context, memoised
export function loadIcp(opts = {}) {
  if (opts.text === undefined) {
    const key = contextDir(opts);
    if (!opts.noCache && cache.has(key)) return cache.get(key);
    const resolved = buildIcp(readContextFile('icp.md', opts), 'icp.md');
    if (!opts.noCache) cache.set(key, resolved);
    return resolved;
  }
  return buildIcp(opts.text, 'inline');
}

function buildIcp(text, sourceLabel) {
  const missing = [];

  const rawNumbers = parseKeyValueTable(text, /##\s*3\.2\.M/);
  if (!Object.keys(rawNumbers).length) missing.push('3.2.M numbers');
  const numbers = {};
  for (const [key, dflt] of Object.entries(FALLBACK.numbers)) {
    numbers[key] = intOr(rawNumbers[key], dflt);
  }

  const geoAccept = new Set();
  const geoDiscard = new Set();
  const geoRows = parseTable(text, /##\s*3\.4\.M/);
  if (!geoRows.length) {
    missing.push('3.4.M geografia');
    FALLBACK.geoAccept.forEach((g) => geoAccept.add(g));
    FALLBACK.geoDiscard.forEach((g) => geoDiscard.add(g));
  } else {
    for (const row of geoRows) {
      const slug = norm(row[0]);
      const decision = norm(row[1]);
      if (!slug || /^slug$/.test(slug) || !decision) continue;
      const target = decision === 'discard' ? geoDiscard : geoAccept;
      target.add(slug);
      for (const alias of splitList(row[2])) target.add(alias);
    }
  }

  const nonIcp = new Set();
  const nonIcpRows = parseTable(text, /##\s*3\.6\.M/);
  if (!nonIcpRows.length) {
    missing.push('3.6.M not our market');
    FALLBACK.nonIcp.forEach((s) => nonIcp.add(s));
  } else {
    for (const row of nonIcpRows) {
      const slug = norm(row[0]);
      if (slug && !/^slug$/.test(slug)) nonIcp.add(slug);
    }
  }

  const segments = new Map();
  const segRows = parseTable(text, /##\s*3\.3\.M/);
  if (!segRows.length) {
    missing.push('3.3.M segmentos');
    for (const [slug, v] of Object.entries(FALLBACK.segments)) segments.set(slug, v);
  } else {
    for (const row of segRows) {
      const slug = norm(row[0]);
      if (!slug || /^slug$/.test(slug)) continue;
      segments.set(slug, { cluster: (row[1] || '').trim() || NO_CASE, approach: (row[2] || '').trim() || DEFAULT_APPROACH });
    }
  }

  const keysFrom = (headerRe, fallbackKeys, label) => {
    const rows = parseTable(text, headerRe);
    const keys = rows
      .map((r) => (r[0] || '').replace(/`/g, '').trim())
      .filter((k) => k && !/^key$/i.test(k));
    if (!keys.length) { missing.push(label); return [...fallbackKeys]; }
    return keys;
  };
  const gapKeys = keysFrom(/##\s*3\.11\.M/, FALLBACK.gapKeys, '3.11.M sinais de gap');
  const timingKeys = keysFrom(/##\s*3\.7\.M/, FALLBACK.timingKeys, '3.7.M sinais de timing');

  return {
    source: missing.length === 0 ? sourceLabel : (missing.length >= 6 ? 'fallback' : `${sourceLabel} (parcial)`),
    missing,
    numbers,
    geoAccept,
    geoDiscard,
    nonIcp,
    segments,
    gapKeys,
    timingKeys,
  };
}

// ── gates ─────────────────────────────────────────────────────────────────────
export function icpGate(lead, icp = loadIcp()) {
  const l = lead || {};
  const n = icp.numbers;

  // explicitly out of market (3.6) = immediate discard
  const flags = (l.nonIcpFlags || []).map(norm);
  const hitNonIcp = flags.find((f) => icp.nonIcp.has(f));
  if (hitNonIcp) return { pass: false, reason: `not our market (3.6): ${hitNonIcp}` };

  // B2B² (excludes mass consumer)
  if (l.b2b2 === false) return { pass: false, reason: 'not B2B² (sells to mass consumers)' };

  // headcount within the range
  if (typeof l.headcount === 'number' && (l.headcount < n.headcount_min || l.headcount > n.headcount_max)) {
    return { pass: false, reason: `headcount ${l.headcount} is outside ${n.headcount_min}-${n.headcount_max}` };
  }

  // Stage gate: OPTIONAL, and off by default. It is inherited from the first context this
  // engine served, where "product is live" was a hard gate. For most businesses that does
  // not exist, and left on by default it discarded every lead coming from a spreadsheet.
  // Turn it on with `stage_gate | 1` in table 3.2.M of your icp.md.
  if (n.stage_gate && l.web3PostMVP !== true && l.web2Firm !== true) {
    return { pass: false, reason: 'no valid stage (your icp.md requires a live product or a qualified round)' };
  }

  // geography (3.4)
  const geo = norm(l.geo);
  if (geo && icp.geoDiscard.has(geo)) return { pass: false, reason: `geografia de descarte: ${l.geo}` };
  if (geo && icp.geoAccept.size && !icp.geoAccept.has(geo) && !l.expansaoParaMercadoAlvo) {
    return { pass: false, reason: `geography not accepted: ${l.geo}` };
  }

  // a reachable decision maker
  if (l.decisorAcessivel === false) return { pass: false, reason: 'no reachable decision maker' };

  // likely budget above the floor
  if (typeof l.budgetProvavel === 'number' && l.budgetProvavel < n.budget_floor_usd_month) {
    return { pass: false, reason: `likely budget $${l.budgetProvavel} is below the floor of $${n.budget_floor_usd_month}` };
  }

  return { pass: true, reason: 'passou nos hard-gates B2B²' };
}

export function gapSignature(lead, icp = loadIcp()) {
  const l = lead || {};
  const signals = icp.gapKeys.filter((k) => l[k] === true);
  return { count: signals.length, signals, material: signals.length >= icp.numbers.gap_material_min };
}

export function timingSignals(lead, icp = loadIcp()) {
  const l = lead || {};
  const signals = icp.timingKeys.filter((k) => l[k] === true);
  return { count: signals.length, signals, forte: signals.length >= icp.numbers.timing_forte_min };
}

export function classify(lead, icp = loadIcp()) {
  const gate = icpGate(lead, icp);
  if (!gate.pass) {
    return { tier: 'DESCARTE', reason: gate.reason };
  }

  const gap = gapSignature(lead, icp);
  const timing = timingSignals(lead, icp);
  const seg = norm((lead || {}).segment);
  const match = icp.segments.get(seg) || null;

  let calor;
  if (gap.material || timing.forte) calor = 'QUENTE';
  else if (gap.count >= 1 || timing.count >= 1) calor = 'MORNO';
  else calor = 'FRIO';

  return {
    tier: calor,
    segment: (lead || {}).segment || 'desconhecido',
    casoParecido: match ? match.cluster : NO_CASE,
    abordagem: match ? match.approach : DEFAULT_APPROACH,
    gap: gap.count,
    gapSignals: gap.signals,
    timing: timing.count,
    timingSignals: timing.signals,
    reason: `ICP OK · gap ${gap.count}/${icp.gapKeys.length} · timing ${timing.count}/${icp.timingKeys.length}`,
  };
}

// Tests in score.test.mjs (run: node --test score.test.mjs).
