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

// ─── a instrução que vai na frente do briefing ───────────────────────────────
test('a instrução diz para não inventar fato, que é a regra que mais importa', () => {
  const i = instruction('sam', 'MENSAGEM_INICIAL');
  assert.match(i, /Never invent/i);
  assert.match(i, /null field means unknown/i);
});

test('a instrução pede UMA mensagem e nada além dela', () => {
  const i = instruction('sam', 'FUP_2');
  assert.match(i, /ONE outbound message/);
  assert.match(i, /nothing else/i);
  assert.match(i, /No preamble/i);
});

test('a instrução carrega o operador e o stage', () => {
  const i = instruction('ana', 'FUP_3');
  assert.match(i, /as ana/);
  assert.match(i, /stage FUP_3/);
});

test('o comando de conferência aponta para a voz e o stage certos', () => {
  const c = checkCommand('ana', 'FUP_2');
  assert.match(c, /lint-voz\.mjs/);
  assert.match(c, /--stage FUP_2/);
  assert.match(c, /--operator ana/);
});

// ─── de onde vem o lead ──────────────────────────────────────────────────────
test('--lead aceita JSON', () => {
  const { lead, error } = resolveLead({ leadJson: '{"name":"Ana","company":"NorthPay"}' });
  assert.equal(error, null);
  assert.equal(lead.company, 'NorthPay');
});

test('--lead com JSON quebrado explica, não estoura', () => {
  const { lead, error } = resolveLead({ leadJson: '{isto não é json' });
  assert.equal(lead, null);
  assert.match(error, /not valid JSON/);
});

test('--file lê a linha pedida da planilha', () => {
  const p = csv('name,company\nAna,NorthPay\nSam,Truleaf\n');
  assert.equal(resolveLead({ file: p, n: 1 }).lead.company, 'NorthPay');
  assert.equal(resolveLead({ file: p, n: 2 }).lead.company, 'Truleaf');
});

test('linha que não existe é erro que diz quantas existem', () => {
  const p = csv('name,company\nAna,NorthPay\n');
  const { error } = resolveLead({ file: p, n: 9 });
  assert.match(error, /has 1 leads/);
  assert.match(error, /number 9/);
});

test('sem --lead e sem --file, diz o que informar', () => {
  const { error } = resolveLead({});
  assert.match(error, /--lead/);
  assert.match(error, /--file/);
});

test('planilha ilegível devolve o erro do leitor, não uma exceção', () => {
  const { lead, error } = resolveLead({ file: '/caminho/que/nao/existe.csv' });
  assert.equal(lead, null);
  assert.match(error, /não consegui abrir/);
});
