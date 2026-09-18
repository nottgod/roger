#!/usr/bin/env node
// score.mjs — scoring de calor B2B². Funções puras: recebem um `lead` e classificam.
//
// O QUE MUDOU EM 12/09: o ICP saiu do código. Geografias, não-ICP, segmentos, números
// (headcount, piso de budget, limiares de gap e timing) e os nomes dos sinais são LIDOS
// do `icp.md` do context pack ativo, nas tabelas marcadas `.M`. Antes eram constantes
// aqui dentro — o que tornava o motor de uma empresa só, apesar de o comentário no topo
// dizer que o arquivo "codifica o ICP de icp.md". Agora codifica de verdade.
//
// As constantes viraram FALLBACK: pack sem as tabelas continua funcionando igual, e
// `loadIcp().missing` diz o que não foi encontrado.
//
// Sem deps externas. ESM.
//
// Shape esperado do lead (campos ausentes tratados como desconhecidos):
// {
//   name, company,
//   b2b2: bool,                 // vende pra empresa (não consumo de massa)?
//   headcount: number,
//   web3PostMVP: bool,          // produto live ou launch <=90d
//   web2Firm: bool,             // investment firm / family office qualificada (3.2.1)
//   geo: string,
//   decisorAcessivel: bool,
//   budgetProvavel: number,     // USD/mês estimado
//   segment: string,            // um slug de 3.3.M
//   nonIcpFlags: [string],      // slugs de 3.6.M
//   expansaoParaMercadoAlvo: bool,
//   ...sinais de gap (3.11.M) e de timing (3.7.M) como booleanos
// }

import { readContextFile, parseTable, parseKeyValueTable, splitList, contextDir } from './lib/md.mjs';

// ── FALLBACK: espelha o que estava hardcoded até 11/09 ────────────────────────
const FALLBACK = {
  numbers: {
    headcount_min: 1,
    headcount_max: 100000,
    budget_floor_usd_month: 0,
    stage_gate: 0,
    gap_material_min: 2,
    timing_forte_min: 1,
  },
  // Sem tabela no icp.md, nenhuma geografia é recusada: recusar em silencio seria pior.
  geoAccept: [],
  geoDiscard: [],
  nonIcp: [],
  segments: {},
  gapKeys: ['noRecentActivity', 'genericMessaging', 'founderInvisible', 'inconsistentStory'],
  timingKeys: ['recentFunding', 'hiringForTheProblem', 'newLaunch', 'pressCoverage'],
};

export const DEFAULT_APPROACH = 'Engajamento Contextual';
export const NO_CASE = 'sem caso direto, citar carteira geral';

function norm(s) {
  return (s == null ? '' : String(s)).trim().toLowerCase();
}

// Número do .md com rede de segurança: célula vazia, texto ("muitos") ou lixo volta ao
// default. Sem o teste de formato, `Number('')` é 0 — e um 0 silencioso viraria um gate
// que aceita qualquer coisa.
function intOr(value, dflt) {
  const raw = String(value ?? '').trim();
  if (!raw) return dflt;
  const cleaned = raw.replace(/[^\d-]/g, '');
  if (!/^-?\d+$/.test(cleaned)) return dflt;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : dflt;
}

// ── carregamento do ICP ───────────────────────────────────────────────────────
const cache = new Map();

// loadIcp({ text })     → parseia este texto (usado pelos testes, sem tocar disco)
// loadIcp({ packDir })  → lê o icp.md daquele pack
// loadIcp()             → lê o pack do contexto ativo, com memo
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
  if (!Object.keys(rawNumbers).length) missing.push('3.2.M números');
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
    missing.push('3.6.M não-ICP');
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

  // não-ICP explícito (3.6) = descarte imediato
  const flags = (l.nonIcpFlags || []).map(norm);
  const hitNonIcp = flags.find((f) => icp.nonIcp.has(f));
  if (hitNonIcp) return { pass: false, reason: `not our market (3.6): ${hitNonIcp}` };

  // B2B² (exclui consumo de massa)
  if (l.b2b2 === false) return { pass: false, reason: 'not B2B² (sells to mass consumers)' };

  // headcount dentro da faixa
  if (typeof l.headcount === 'number' && (l.headcount < n.headcount_min || l.headcount > n.headcount_max)) {
    return { pass: false, reason: `headcount ${l.headcount} is outside ${n.headcount_min}-${n.headcount_max}` };
  }

  // Portão de estágio: OPCIONAL, e desligado por padrão. Ele é herança do primeiro
  // contexto que esta engine atendeu, onde "produto ao vivo" era hard-gate. Para a
  // maioria dos negócios isso não existe, e ligado por padrão ele descartava todo lead
  // vindo de planilha. Ligue com `stage_gate | 1` na tabela 3.2.M do seu icp.md.
  if (n.stage_gate && l.web3PostMVP !== true && l.web2Firm !== true) {
    return { pass: false, reason: 'no valid stage (your icp.md requires a live product or a qualified round)' };
  }

  // geografia (3.4)
  const geo = norm(l.geo);
  if (geo && icp.geoDiscard.has(geo)) return { pass: false, reason: `geografia de descarte: ${l.geo}` };
  if (geo && icp.geoAccept.size && !icp.geoAccept.has(geo) && !l.expansaoParaMercadoAlvo) {
    return { pass: false, reason: `geography not accepted: ${l.geo}` };
  }

  // decisor acessível
  if (l.decisorAcessivel === false) return { pass: false, reason: 'no reachable decision maker' };

  // budget provável acima do piso
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

// Testes em score.test.mjs (rodar: node --test score.test.mjs).
