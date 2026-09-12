#!/usr/bin/env node
// doctor.mjs — diz o que está pronto e o que falta, antes de você gastar tempo ou dinheiro.
//
// Duas regras que valem para todo este arquivo:
//   1. NUNCA imprime uma chave. Só a máscara (4 últimos caracteres).
//   2. A validação de chave paga é feita SEM COMPRAR NADA: manda um pedido
//      deliberadamente incompleto e olha o código de resposta. 401/403 significa
//      chave ruim; 400 significa "a chave passou, o pedido é que estava vazio".
//      Uma busca de verdade custaria dinheiro só para dizer "ok".
//
// uso:
//   node doctor.mjs            checa tudo
//   node doctor.mjs --offline  só o que não precisa de rede

import { loadConfig, mask, KEY_SPECS } from './lib/config.mjs';

const ROOT = new URL('../../', import.meta.url);

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const out = (s = '') => process.stdout.write(s + '\n');

const MARK = { ok: GREEN('ok  '), warn: YELLOW('warn'), fail: RED('fail') };

const results = [];
function report(status, label, detail) {
  results.push({ status, label, detail });
  out(`  ${MARK[status]}  ${label}${detail ? D(` — ${detail}`) : ''}`);
}

// ── ambiente ──────────────────────────────────────────────────────────────────
function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) report('ok', `Node ${process.versions.node}`);
  else report('fail', `Node ${process.versions.node}`, 'Roger needs Node 22 or newer');
}

async function checkFiles(cfg) {
  if (cfg.files.dotenv) report('ok', '.env found');
  else if (cfg.files.legacy) report('warn', '.env missing', 'reading the legacy config.js instead — move your keys to .env');
  else report('warn', 'no .env yet', 'cp .env.example .env, then fill in what you have');

  const { existsSync } = await import('node:fs');
  const operator = cfg.roger.operator;
  if (!operator) {
    report('warn', 'no operator selected', 'set ROGER_OPERATOR, or run: npm run onboarding');
  } else if (existsSync(new URL(`rapport/operators/${operator}/persona.md`, ROOT))) {
    const hasVoice = existsSync(new URL(`rapport/operators/${operator}/voice.json`, ROOT));
    report('ok', `operator "${operator}"`, hasVoice ? 'persona.md + voice.json' : 'persona.md (no voice.json — the voice guard will use defaults)');
  } else {
    report('fail', `operator "${operator}" has no persona.md`, 'run: npm run onboarding');
  }

  const context = cfg.roger.context;
  if (!context) report('warn', 'no context selected', 'set ROGER_CONTEXT to a folder under rapport/contexts/');
  else if (existsSync(new URL(`rapport/contexts/${context}/`, ROOT))) report('ok', `context "${context}"`);
  else report('fail', `context "${context}" not found`, `expected rapport/contexts/${context}/`);
}

function checkKeysPresence(cfg) {
  for (const spec of KEY_SPECS) {
    if (!spec.secret) continue;
    const value = cfg.values[spec.name];
    if (value) report('ok', `${spec.name} present`, `${mask(value)} (from ${cfg.origin[spec.name]})`);
    else report('warn', `${spec.name} not set`, spec.cost === 'free' ? spec.where : `optional — ${spec.what}`);
  }
}

// ── rede: valida sem comprar ──────────────────────────────────────────────────
async function probe(url, init, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return { status: res.status };
  } catch (e) {
    return { status: 0, error: e?.name === 'AbortError' ? 'timeout' : 'network error' };
  } finally {
    clearTimeout(timer);
  }
}

function verdictFromStatus(name, { status, error }) {
  if (status === 0) return report('warn', `${name} unreachable`, error);
  if (status === 401 || status === 403) return report('fail', `${name} rejected the key`, `HTTP ${status} — rotate or re-copy it`);
  if (status === 429) return report('warn', `${name} rate-limited`, 'the key works, the account is throttled right now');
  return report('ok', `${name} accepted the key`, `HTTP ${status} on a deliberately empty request`);
}

async function checkKommo(cfg) {
  const { token, subdomain, ownerId } = cfg.kommo;
  if (!token && !subdomain) return report('warn', 'Kommo not configured', 'fine — use the spreadsheet mode');
  if (!subdomain) return report('fail', 'KOMMO_SUBDOMAIN missing', 'without it Roger cannot build the API address');
  if (!token) return report('fail', 'KOMMO_TOKEN missing', 'set it in .env');

  const res = await probe(`https://${subdomain}.kommo.com/api/v4/account`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 200) report('ok', 'Kommo reachable and the token works');
  else if (res.status === 401 || res.status === 403) report('fail', 'Kommo rejected the token', `HTTP ${res.status} — it may be expired or from another account`);
  else if (res.status === 0) report('warn', 'Kommo unreachable', res.error);
  else report('warn', 'Kommo answered unexpectedly', `HTTP ${res.status}`);

  if (!ownerId) report('fail', 'KOMMO_OWNER_ID missing', 'Roger refuses to touch a CRM without knowing which leads are yours');
  else report('ok', `owner id ${ownerId}`, 'only leads owned by this id are ever touched');
}

async function checkResearch(cfg) {
  const { exaKey, firecrawlKey, fundableKey } = cfg.keys;
  if (exaKey) {
    verdictFromStatus('Exa', await probe('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': exaKey, 'Content-Type': 'application/json' },
      body: '{}',
    }));
  }
  if (firecrawlKey) {
    verdictFromStatus('Firecrawl', await probe('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    }));
  }
  if (fundableKey) {
    verdictFromStatus('Fundable', await probe('https://www.tryfundable.ai/api/v1/deals/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fundableKey}`, 'Content-Type': 'application/json' },
      body: '{}',
    }));
  }
}

// ── o braço de envio ──────────────────────────────────────────────────────────
// A pergunta que a tela 7 do onboarding deixa no ar: estou pronto para mandar?
async function checkSendArm(cfg) {
  const { existsSync } = await import('node:fs');

  try {
    const { loadPlaywright } = await import('./lib/linkedin-page.mjs');
    await loadPlaywright();
    report('ok', 'Playwright installed', 'the send arm can drive a browser');
  } catch {
    report('warn', 'Playwright not installed', 'only needed to send: npm i playwright && npx playwright install chromium');
  }

  const identity = process.env.ROGER_IDENTITY || cfg.roger.operator;
  if (!identity) {
    report('warn', 'no sending identity', 'set ROGER_IDENTITY (or ROGER_OPERATOR) to the account that will speak');
  } else if (existsSync(new URL(`.roger/chrome-profile-${identity}`, ROOT))) {
    report('ok', `browser profile for "${identity}"`, 'you logged in once; that session stays yours');
  } else {
    report('warn', `no browser profile for "${identity}"`, 'the first run opens a window for you to log in by hand');
  }

  try {
    const { createJournal } = await import('./lib/journal.mjs');
    const { fileURLToPath } = await import('node:url');
    const journalDir = `${fileURLToPath(ROOT)}.roger/journal`;
    // Um diagnóstico não deveria criar estado: se o journal ainda não existe, só diz isso.
    if (!existsSync(journalDir)) {
      report('ok', 'no send journal yet', 'it is created on the first real send');
      return;
    }
    const journal = createJournal({ dir: journalDir });
    const pending = journal.pending();
    const today = identity ? journal.countToday(identity) : 0;
    if (pending.length) {
      report('warn', `${pending.length} send(s) declared but never confirmed`, 'those leads stay out of the queue until someone checks — that is the point');
    } else {
      report('ok', 'no unconfirmed sends');
    }
    if (identity) report('ok', `${today} message(s) sent today as "${identity}"`, 'the daily cap is counted from the journal, not from the CRM');
  } catch (e) {
    report('warn', 'could not read the send journal', e.message);
  }
}

async function main() {
  const offline = process.argv.includes('--offline');
  const cfg = loadConfig();

  out(`\n${B('Roger doctor')}${offline ? D(' (offline)') : ''}\n`);

  out(B('Environment'));
  checkNode();
  await checkFiles(cfg);

  out(`\n${B('Keys')}`);
  checkKeysPresence(cfg);

  out(`\n${B('Sending')}`);
  await checkSendArm(cfg);

  if (!offline) {
    out(`\n${B('Reaching the services')}${D('  (no search is performed, nothing is billed)')}`);
    await checkKommo(cfg);
    await checkResearch(cfg);
  }

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  out(`\n${B('Summary')}  ${GREEN(`${results.length - fails - warns} ok`)} · ${YELLOW(`${warns} to look at`)} · ${RED(`${fails} blocking`)}`);
  out(fails ? RED('\nFix the blocking ones before running a real batch.') : GREEN('\nNothing blocking. Roger that.'));
  process.exitCode = fails ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
