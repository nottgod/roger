import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { instruction, checkCommand, resolveLead } from './draft.mjs';

function csv(conteudo) {
  const dir = mkdtempSync(join(tmpdir(), 'roger-draft-'));
  const p = join(dir, 'leads.csv');
  writeFileSync(p, conteudo);
  return p;
}

// ─── the instruction that goes in front of the briefing ──────────────────────
test('the instruction says not to invent a fact, which is the rule that matters most', () => {
  const i = instruction('sam', 'MENSAGEM_INICIAL');
  assert.match(i, /Never invent/i);
  assert.match(i, /null field means unknown/i);
});

test('the instruction asks for ONE message and nothing else', () => {
  const i = instruction('sam', 'FUP_2');
  assert.match(i, /ONE outbound message/);
  assert.match(i, /nothing else/i);
  assert.match(i, /No preamble/i);
});

test('the instruction carries the operator and the stage', () => {
  const i = instruction('ana', 'FUP_3');
  assert.match(i, /as ana/);
  assert.match(i, /stage FUP_3/);
});

test('the check command points at the right voice and stage', () => {
  const c = checkCommand('ana', 'FUP_2');
  assert.match(c, /lint-voz\.mjs/);
  assert.match(c, /--stage FUP_2/);
  assert.match(c, /--operator ana/);
});

// ─── de onde vem o lead ──────────────────────────────────────────────────────
test('--lead accepts JSON', () => {
  const { lead, error } = resolveLead({ leadJson: '{"name":"Ana","company":"NorthPay"}' });
  assert.equal(error, null);
  assert.equal(lead.company, 'NorthPay');
});

test('--lead with broken JSON explains, it does not blow up', () => {
  const { lead, error } = resolveLead({ leadJson: '{this is not json' });
  assert.equal(lead, null);
  assert.match(error, /not valid JSON/);
});

test('--file reads the requested row of the spreadsheet', () => {
  const p = csv('name,company\nAna,NorthPay\nSam,Truleaf\n');
  assert.equal(resolveLead({ file: p, n: 1 }).lead.company, 'NorthPay');
  assert.equal(resolveLead({ file: p, n: 2 }).lead.company, 'Truleaf');
});

test('a row that does not exist is an error that says how many do', () => {
  const p = csv('name,company\nAna,NorthPay\n');
  const { error } = resolveLead({ file: p, n: 9 });
  assert.match(error, /has 1 leads/);
  assert.match(error, /number 9/);
});

test('with neither --lead nor --file, it says what to pass', () => {
  const { error } = resolveLead({});
  assert.match(error, /--lead/);
  assert.match(error, /--file/);
});

test('an unreadable spreadsheet returns the reader error, not an exception', () => {
  const { lead, error } = resolveLead({ file: '/path/that/does/not/exist.csv' });
  assert.equal(lead, null);
  assert.match(error, /could not open/);
});
