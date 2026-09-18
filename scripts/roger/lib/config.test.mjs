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
test('parseDotEnv reads simple pairs and skips comments and blank lines', () => {
  const out = parseDotEnv('# a comment\n\nKOMMO_TOKEN=abc\nEXA_KEY=def\n');
  assert.deepEqual(out, { KOMMO_TOKEN: 'abc', EXA_KEY: 'def' });
});

test('parseDotEnv accepts export, quotes and = inside the value', () => {
  const out = parseDotEnv(`export A='x=y'\nB="z=w"\nC=p=q\n`);
  assert.equal(out.A, 'x=y');
  assert.equal(out.B, 'z=w');
  assert.equal(out.C, 'p=q');
});

test('parseDotEnv strips a trailing comment only outside quotes', () => {
  const out = parseDotEnv('A=valor # sobra\nB="com # dentro"\n');
  assert.equal(out.A, 'valor');
  assert.equal(out.B, 'com # dentro');
});

test('parseDotEnv ignores a line with no equals sign', () => {
  assert.deepEqual(parseDotEnv('LIXO\n'), {});
});

// ── parseLegacyJs ─────────────────────────────────────────────────────────────
test('parseLegacyJs accepts both quote and separator dialects', () => {
  const out = parseLegacyJs(`const CONFIG = { KOMMO_TOKEN: 'abc', EXA_KEY: "def", FUNDABLE_KEY = 'ghi' };`);
  assert.equal(out.KOMMO_TOKEN, 'abc');
  assert.equal(out.EXA_KEY, 'def');
  assert.equal(out.FUNDABLE_KEY, 'ghi');
});

test('parseLegacyJs keeps the first occurrence of a repeated key', () => {
  const out = parseLegacyJs(`{ A: 'primeiro', A: 'segundo' }`);
  assert.equal(out.A, 'primeiro');
});

test('parseLegacyJs returns an empty object for missing text', () => {
  assert.deepEqual(parseLegacyJs(null), {});
  assert.deepEqual(parseLegacyJs(''), {});
});

// ── precedence ────────────────────────────────────────────────────────────────
test('env beats .env, which beats config.js', () => {
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

test('a missing key is null, and so is its origin, without throwing', () => {
  const cfg = loadConfig({ env: {}, envFile: null, legacyFile: null });
  assert.equal(cfg.kommo.token, null);
  assert.equal(cfg.kommo.subdomain, null);
  assert.equal(cfg.origin.KOMMO_TOKEN, null);
  assert.equal(cfg.files.dotenv, false);
  assert.equal(cfg.files.legacy, false);
});

test('a file that does not exist does not throw', () => {
  const cfg = loadConfig({
    env: {},
    envFile: pathToFileURL('/caminho/que/nao/existe/.env'),
    legacyFile: pathToFileURL('/caminho/que/nao/existe/config.js'),
  });
  assert.equal(cfg.keys.exaKey, null);
});

test('an empty or whitespace-only string does not count as a value', () => {
  const cfg = loadConfig({ env: { KOMMO_TOKEN: '   ', EXA_KEY: '' }, envFile: null, legacyFile: null });
  assert.equal(cfg.kommo.token, null);
  assert.equal(cfg.keys.exaKey, null);
});

// ── tipos derivados ───────────────────────────────────────────────────────────
test('KOMMO_OWNER_ID becomes a number, and junk becomes null', () => {
  const ok = loadConfig({ env: { KOMMO_OWNER_ID: '99999999' }, envFile: null, legacyFile: null });
  assert.equal(ok.kommo.ownerId, 99999999);
  const ruim = loadConfig({ env: { KOMMO_OWNER_ID: 'eu-mesmo' }, envFile: null, legacyFile: null });
  assert.equal(ruim.kommo.ownerId, null);
});

test('ROGER_TZ defaults to -3 and accepts a negative', () => {
  assert.equal(loadConfig({ env: {}, envFile: null, legacyFile: null }).roger.tz, -3);
  assert.equal(loadConfig({ env: { ROGER_TZ: '0' }, envFile: null, legacyFile: null }).roger.tz, 0);
  assert.equal(loadConfig({ env: { ROGER_TZ: '-5' }, envFile: null, legacyFile: null }).roger.tz, -5);
});

// ── mask ──────────────────────────────────────────────────────────────────────
test('mask shows only the last 4 characters', () => {
  assert.equal(mask('abcdefghijklmnop'), '********mnop');
  assert.equal(mask('abc'), '***');
  assert.equal(mask(''), null);
  assert.equal(mask(null), null);
});

test('mask never returns the whole value of a long secret', () => {
  const secret = 'super-secreto-1234';
  const masked = mask(secret);
  assert.ok(!masked.includes('super'));
  assert.ok(masked.endsWith('1234'));
});

// ── specs ─────────────────────────────────────────────────────────────────────
test('every spec has the fields .env.example and doctor rely on', () => {
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
