import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig, parseDotEnv, parseLegacyJs, mask, KEY_SPECS, specFor } from './config.mjs';

function tmpFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'roger-config-'));
  const p = join(dir, name);
  writeFileSync(p, content);
  return pathToFileURL(p);
}

// ── parseDotEnv ───────────────────────────────────────────────────────────────
test('parseDotEnv lê pares simples e ignora comentário e linha vazia', () => {
  const out = parseDotEnv('# comentário\n\nKOMMO_TOKEN=abc\nEXA_KEY=def\n');
  assert.deepEqual(out, { KOMMO_TOKEN: 'abc', EXA_KEY: 'def' });
});

test('parseDotEnv aceita export, aspas e = dentro do valor', () => {
  const out = parseDotEnv(`export A='x=y'\nB="z=w"\nC=p=q\n`);
  assert.equal(out.A, 'x=y');
  assert.equal(out.B, 'z=w');
  assert.equal(out.C, 'p=q');
});

test('parseDotEnv tira comentário à direita só fora de aspas', () => {
  const out = parseDotEnv('A=valor # sobra\nB="com # dentro"\n');
  assert.equal(out.A, 'valor');
  assert.equal(out.B, 'com # dentro');
});

test('parseDotEnv ignora linha sem sinal de igual', () => {
  assert.deepEqual(parseDotEnv('LIXO\n'), {});
});

// ── parseLegacyJs ─────────────────────────────────────────────────────────────
test('parseLegacyJs aceita os dois dialetos de aspas e de separador', () => {
  const out = parseLegacyJs(`const CONFIG = { KOMMO_TOKEN: 'abc', EXA_KEY: "def", FUNDABLE_KEY = 'ghi' };`);
  assert.equal(out.KOMMO_TOKEN, 'abc');
  assert.equal(out.EXA_KEY, 'def');
  assert.equal(out.FUNDABLE_KEY, 'ghi');
});

test('parseLegacyJs mantém a primeira ocorrência de uma chave repetida', () => {
  const out = parseLegacyJs(`{ A: 'primeiro', A: 'segundo' }`);
  assert.equal(out.A, 'primeiro');
});

test('parseLegacyJs devolve objeto vazio para texto ausente', () => {
  assert.deepEqual(parseLegacyJs(null), {});
  assert.deepEqual(parseLegacyJs(''), {});
});

// ── precedência ───────────────────────────────────────────────────────────────
test('env vence .env, que vence config.js', () => {
  const envFile = tmpFile('.env', 'KOMMO_TOKEN=do-dotenv\nEXA_KEY=exa-do-dotenv\n');
  const legacyFile = tmpFile('config.js', `{ KOMMO_TOKEN: 'do-legado', EXA_KEY: 'exa-do-legado', FUNDABLE_KEY: 'fund-do-legado' }`);

  const cfg = loadConfig({ env: { KOMMO_TOKEN: 'do-env' }, envFile, legacyFile });

  assert.equal(cfg.kommo.token, 'do-env');
  assert.equal(cfg.origin.KOMMO_TOKEN, 'env');
  assert.equal(cfg.keys.exaKey, 'exa-do-dotenv');
  assert.equal(cfg.origin.EXA_KEY, 'dotenv');
  assert.equal(cfg.keys.fundableKey, 'fund-do-legado');
  assert.equal(cfg.origin.FUNDABLE_KEY, 'legacy');
});

test('chave ausente é null e a origem também, sem lançar', () => {
  const cfg = loadConfig({ env: {}, envFile: null, legacyFile: null });
  assert.equal(cfg.kommo.token, null);
  assert.equal(cfg.kommo.subdomain, null);
  assert.equal(cfg.origin.KOMMO_TOKEN, null);
  assert.equal(cfg.files.dotenv, false);
  assert.equal(cfg.files.legacy, false);
});

test('arquivo inexistente não lança', () => {
  const cfg = loadConfig({
    env: {},
    envFile: pathToFileURL('/caminho/que/nao/existe/.env'),
    legacyFile: pathToFileURL('/caminho/que/nao/existe/config.js'),
  });
  assert.equal(cfg.keys.exaKey, null);
});

test('string vazia ou só espaço não conta como valor', () => {
  const cfg = loadConfig({ env: { KOMMO_TOKEN: '   ', EXA_KEY: '' }, envFile: null, legacyFile: null });
  assert.equal(cfg.kommo.token, null);
  assert.equal(cfg.keys.exaKey, null);
});

// ── tipos derivados ───────────────────────────────────────────────────────────
test('KOMMO_OWNER_ID vira número, e lixo vira null', () => {
  const ok = loadConfig({ env: { KOMMO_OWNER_ID: '99999999' }, envFile: null, legacyFile: null });
  assert.equal(ok.kommo.ownerId, 99999999);
  const ruim = loadConfig({ env: { KOMMO_OWNER_ID: 'eu-mesmo' }, envFile: null, legacyFile: null });
  assert.equal(ruim.kommo.ownerId, null);
});

test('ROGER_TZ tem default -3 e aceita negativo', () => {
  assert.equal(loadConfig({ env: {}, envFile: null, legacyFile: null }).roger.tz, -3);
  assert.equal(loadConfig({ env: { ROGER_TZ: '0' }, envFile: null, legacyFile: null }).roger.tz, 0);
  assert.equal(loadConfig({ env: { ROGER_TZ: '-5' }, envFile: null, legacyFile: null }).roger.tz, -5);
});

// ── mask ──────────────────────────────────────────────────────────────────────
test('mask mostra só os 4 últimos caracteres', () => {
  assert.equal(mask('abcdefghijklmnop'), '********mnop');
  assert.equal(mask('abc'), '***');
  assert.equal(mask(''), null);
  assert.equal(mask(null), null);
});

test('mask nunca devolve o valor inteiro de um segredo longo', () => {
  const secret = 'super-secreto-1234';
  const masked = mask(secret);
  assert.ok(!masked.includes('super'));
  assert.ok(masked.endsWith('1234'));
});

// ── specs ─────────────────────────────────────────────────────────────────────
test('todo spec tem os campos que o .env.example e o doctor usam', () => {
  for (const spec of KEY_SPECS) {
    assert.equal(typeof spec.name, 'string');
    assert.equal(typeof spec.what, 'string');
    assert.equal(typeof spec.where, 'string');
    assert.ok(['crm', 'research', 'roger'].includes(spec.group));
    assert.equal(typeof spec.secret, 'boolean');
  }
  assert.equal(specFor('EXA_KEY').group, 'research');
  assert.equal(specFor('NAO_EXISTE'), null);
});
