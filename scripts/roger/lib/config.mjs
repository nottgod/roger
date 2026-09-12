// config.mjs — carregador ÚNICO de configuração.
//
// Antes existiam três parsers divergentes do mesmo arquivo (kommo-config, intel, kpi),
// com três precedências e dois dialetos de aspas. Este módulo é a fonte única.
//
// PRECEDÊNCIA (a primeira que tiver valor ganha):
//   1. process.env          — o que o shell/CI define
//   2. .env na raiz         — o caminho documentado para quem instala
//   3. config.js na raiz    — legado (gitignored); segue lido para não quebrar instalação antiga
//
// CONTRATO: nunca lança e NUNCA devolve segredo em log. Chave ausente = null, e quem
// chama decide se aquilo era obrigatório. Para mostrar valor a um humano, use mask().
//
// Injetável para teste: loadConfig({ env, envFile, legacyFile }).
// ESM, sem deps externas.

import { readFileSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url);

// Cada chave que o projeto conhece, com o que o humano precisa saber para preenchê-la.
// Serve de fonte para o .env.example e para o `doctor`.
export const KEY_SPECS = [
  {
    name: 'KOMMO_TOKEN',
    group: 'crm',
    required: false,
    secret: true,
    what: 'Long-lived access token of your Kommo integration.',
    where: 'Kommo → Settings → Integrations → your integration → Keys and scopes.',
    cost: 'free',
  },
  {
    name: 'KOMMO_SUBDOMAIN',
    group: 'crm',
    required: false,
    secret: false,
    what: 'Your Kommo subdomain: the first part of <this>.kommo.com.',
    where: 'The address bar when you are logged into Kommo.',
    cost: 'free',
  },
  {
    name: 'KOMMO_OWNER_ID',
    group: 'crm',
    required: false,
    secret: false,
    what: 'Your own user id in Kommo. Roger only ever reads and writes leads that belong to this id.',
    where: 'Kommo → Settings → Users → click yourself → the id in the URL.',
    cost: 'free',
  },
  {
    name: 'EXA_KEY',
    group: 'research',
    required: false,
    secret: true,
    what: 'Exa.ai search, used to research the person and the company before writing.',
    where: 'https://dashboard.exa.ai → API keys.',
    cost: 'paid per search',
  },
  {
    name: 'FIRECRAWL_KEY',
    group: 'research',
    required: false,
    secret: true,
    what: 'Firecrawl, used to read the company website.',
    where: 'https://firecrawl.dev → API keys.',
    cost: 'paid per page',
  },
  {
    name: 'FUNDABLE_KEY',
    group: 'research',
    required: false,
    secret: true,
    what: 'Fundable, used for funding signals. Fully optional.',
    where: 'https://tryfundable.ai → API.',
    cost: 'paid',
  },
  {
    name: 'ROGER_CONTEXT',
    group: 'roger',
    required: false,
    secret: false,
    what: 'Which context pack to use, i.e. the folder name under rapport/contexts/.',
    where: 'You choose it when you build your context.',
    cost: 'free',
  },
  {
    name: 'ROGER_OPERATOR',
    group: 'roger',
    required: false,
    secret: false,
    what: 'Which operator to write as, i.e. the folder name under rapport/operators/.',
    where: 'The voice interview creates this for you.',
    cost: 'free',
  },
  {
    name: 'ROGER_TZ',
    group: 'roger',
    required: false,
    secret: false,
    what: 'Timezone offset in hours used for cadence dates. Default -3.',
    where: 'Your own timezone.',
    cost: 'free',
  },
];

const SPEC_BY_NAME = new Map(KEY_SPECS.map((s) => [s.name, s]));

function readIf(url) {
  try { return readFileSync(url, 'utf8'); } catch { return null; }
}

// .env padrão: KEY=value, uma por linha. Aceita `export KEY=v`, comentários com #,
// aspas simples/duplas e `=` dentro do valor. Linha sem `=` é ignorada.
export function parseDotEnv(text) {
  const out = {};
  if (!text) return out;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const clean = line.replace(/^export\s+/, '');
    const eq = clean.indexOf('=');
    if (eq <= 0) continue;
    const name = clean.slice(0, eq).trim();
    let value = clean.slice(eq + 1).trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim(); // comentário à direita só fora de aspas
    if (name) out[name] = value;
  }
  return out;
}

// config.js legado: `const CONFIG = { KEY: 'v', OUTRA: "v" }`. Aceita `:` e `=`,
// aspas simples e duplas — a união dos três dialetos que existiam antes.
export function parseLegacyJs(text) {
  const out = {};
  if (!text) return out;
  const re = /([A-Z][A-Z0-9_]*)\s*[:=]\s*(['"])([^'"]*)\2/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!(m[1] in out)) out[m[1]] = m[3];
  }
  return out;
}

// Mostra um valor a um humano sem revelá-lo: só os 4 últimos caracteres.
// Segredo curto vira '****' inteiro. null/'' vira null.
export function mask(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  if (s.length <= 4) return '*'.repeat(s.length);
  return `${'*'.repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const dotenv = parseDotEnv(opts.envFile === null ? null : readIf(opts.envFile ?? new URL('.env', ROOT)));
  const legacy = parseLegacyJs(opts.legacyFile === null ? null : readIf(opts.legacyFile ?? new URL('config.js', ROOT)));

  const origin = {};
  const pick = (name) => {
    const fromEnv = nonEmpty(env[name]);
    if (fromEnv) { origin[name] = 'env'; return fromEnv; }
    const fromDot = nonEmpty(dotenv[name]);
    if (fromDot) { origin[name] = 'dotenv'; return fromDot; }
    const fromLegacy = nonEmpty(legacy[name]);
    if (fromLegacy) { origin[name] = 'legacy'; return fromLegacy; }
    origin[name] = null;
    return null;
  };

  const values = {};
  for (const spec of KEY_SPECS) values[spec.name] = pick(spec.name);

  const ownerRaw = values.KOMMO_OWNER_ID;
  const ownerId = ownerRaw && /^\d+$/.test(ownerRaw) ? Number(ownerRaw) : null;
  const tzRaw = values.ROGER_TZ;
  const tz = tzRaw && /^-?\d+$/.test(tzRaw) ? Number(tzRaw) : -3;

  return {
    kommo: {
      token: values.KOMMO_TOKEN,
      subdomain: values.KOMMO_SUBDOMAIN,
      ownerId,
    },
    keys: {
      exaKey: values.EXA_KEY,
      firecrawlKey: values.FIRECRAWL_KEY,
      fundableKey: values.FUNDABLE_KEY,
    },
    roger: {
      context: values.ROGER_CONTEXT,
      operator: values.ROGER_OPERATOR,
      tz,
    },
    values,
    origin,
    files: {
      dotenv: Object.keys(dotenv).length > 0,
      legacy: Object.keys(legacy).length > 0,
    },
  };
}

export function specFor(name) {
  return SPEC_BY_NAME.get(name) || null;
}
