import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseCsv, coerceBoolean, coerceNumber, fieldForHeader, normalizeLead,
  readLeads, readLeadsFile, TEMPLATE_CSV,
} from './leads-file.mjs';

function tmp(name, content) {
  const dir = mkdtempSync(join(tmpdir(), 'roger-leads-'));
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

// ─── CSV de verdade, não split por vírgula ───────────────────────────────────
test('parseCsv respeita vírgula dentro de aspas', () => {
  const rows = parseCsv('name,notes\nAna,"met her in Lisbon, talked about RWA"\n');
  assert.deepEqual(rows[1], ['Ana', 'met her in Lisbon, talked about RWA']);
});

test('parseCsv entende aspas escapadas e quebra de linha dentro da célula', () => {
  const rows = parseCsv('name,notes\nAna,"disse ""sim"" na call\ne pediu proposta"\n');
  assert.equal(rows[1][1], 'disse "sim" na call\ne pediu proposta');
});

test('parseCsv tolera BOM do Excel, CRLF e ponto e vírgula', () => {
  const rows = parseCsv('﻿name;company\r\nAna;NorthPay\r\n');
  assert.deepEqual(rows[0], ['name', 'company']);
  assert.deepEqual(rows[1], ['Ana', 'NorthPay']);
});

test('parseCsv descarta linha totalmente vazia', () => {
  const rows = parseCsv('name\nAna\n\n\nSam\n');
  assert.deepEqual(rows, [['name'], ['Ana'], ['Sam']]);
});

// ─── cabeçalho que a pessoa já tem ───────────────────────────────────────────
test('cabeçalho em português ou inglês cai no mesmo campo', () => {
  assert.equal(fieldForHeader('Empresa'), 'company');
  assert.equal(fieldForHeader('company'), 'company');
  assert.equal(fieldForHeader('País'), 'geo');
  assert.equal(fieldForHeader('country'), 'geo');
  assert.equal(fieldForHeader('Team Size'), 'headcount');
  assert.equal(fieldForHeader('team_size'), 'headcount');
  assert.equal(fieldForHeader('coluna que ninguém conhece'), null);
});

// ─── coerção de dado escrito por humano ──────────────────────────────────────
test('boolean aceita sim, yes, x e vazio como desconhecido', () => {
  assert.equal(coerceBoolean('sim'), true);
  assert.equal(coerceBoolean('YES'), true);
  assert.equal(coerceBoolean('x'), true);
  assert.equal(coerceBoolean('não'), false);
  assert.equal(coerceBoolean('no'), false);
  assert.equal(coerceBoolean(''), false);
  assert.equal(coerceBoolean('talvez'), undefined);
});

test('número entende k, milhar com separador e sujeira de moeda', () => {
  assert.equal(coerceNumber('6k'), 6000);
  assert.equal(coerceNumber('$4,000/mo'), 4000);
  assert.equal(coerceNumber('12'), 12);
  assert.equal(coerceNumber('umas 20 pessoas'), 20);
  assert.equal(coerceNumber('muitos'), undefined);
  assert.equal(coerceNumber(''), undefined);
});

// ─── normalização ────────────────────────────────────────────────────────────
test('linha vira lead no shape que o score espera', () => {
  const { lead, error } = normalizeLead({
    Nome: 'Ana Ribeiro', Empresa: 'NorthPay', Cargo: 'Head of Marketing',
    País: 'Singapore', Segmento: 'payments', 'Team Size': '14', 'Orçamento': '6k',
    'Decisor': 'sim',
  });
  assert.equal(error, null);
  assert.equal(lead.name, 'Ana Ribeiro');
  assert.equal(lead.company, 'NorthPay');
  assert.equal(lead.role, 'Head of Marketing');
  assert.equal(lead.geo, 'Singapore');
  assert.equal(lead.headcount, 14);
  assert.equal(lead.budgetProvavel, 6000);
  assert.equal(lead.decisorAcessivel, true);
  assert.equal(lead.stage, 'MENSAGEM_INICIAL', 'stage tem default');
});

test('coluna desconhecida é preservada em extra, não jogada fora', () => {
  const { lead } = normalizeLead({ name: 'Ana', 'Fonte do lead': 'evento em Lisboa' });
  assert.deepEqual(lead.extra, { 'Fonte do lead': 'evento em Lisboa' });
});

test('linha sem nome e sem empresa é erro explicado, não silêncio', () => {
  const { lead, error } = normalizeLead({ country: 'Brazil' }, 3);
  assert.equal(lead, null);
  assert.match(error, /linha 4/);
  assert.match(error, /sem nome e sem empresa/);
});

test('valor que não dá para entender vira aviso, e o lead segue', () => {
  const { lead, warnings } = normalizeLead({ name: 'Ana', 'Team Size': 'sei lá' });
  assert.equal(lead.name, 'Ana');
  assert.equal(lead.headcount, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /não entendi o número/);
});

// ─── leitura completa ────────────────────────────────────────────────────────
test('uma linha ruim não derruba a lista inteira', () => {
  const csv = 'name,company\nAna,NorthPay\n,\nSam,Truleaf\n';
  const r = readLeads({ text: csv });
  assert.equal(r.leads.length, 2);
  assert.deepEqual(r.leads.map((l) => l.name), ['Ana', 'Sam']);
});

test('cabeçalho irreconhecível explica o que era esperado', () => {
  const r = readLeads({ text: 'col1,col2\na,b\n' });
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /não reconheci nenhuma coluna/);
  assert.match(r.errors[0], /name, company, linkedin/);
});

test('planilha vazia é erro, não zero lead em silêncio', () => {
  assert.match(readLeads({ text: '' }).errors[0], /vazia/);
});

test('JSON também serve, como lista ou com a chave leads', () => {
  const a = readLeads({ text: '[{"name":"Ana","company":"NorthPay"}]', format: 'json' });
  assert.equal(a.leads[0].company, 'NorthPay');
  const b = readLeads({ text: '{"leads":[{"name":"Sam"}]}', format: 'json' });
  assert.equal(b.leads[0].name, 'Sam');
});

test('JSON inválido devolve erro legível e nenhuma exceção', () => {
  const r = readLeads({ text: '{ isto não é json', format: 'json' });
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /JSON inválido/);
});

test('arquivo inexistente devolve erro, não lança', () => {
  const r = readLeadsFile('/caminho/que/nao/existe.csv');
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /não consegui abrir/);
});

test('formato vem da extensão do arquivo', () => {
  const p = tmp('leads.json', '[{"name":"Ana"}]');
  const r = readLeadsFile(p);
  assert.equal(r.source, 'json');
  assert.equal(r.leads[0].name, 'Ana');
});

test('o modelo de planilha que a gente entrega é lido sem erro nenhum', () => {
  const r = readLeads({ text: TEMPLATE_CSV });
  assert.deepEqual(r.errors, []);
  assert.equal(r.leads.length, 2);
  assert.equal(r.leads[0].company, 'NorthPay');
  assert.equal(r.leads[0].budgetProvavel, 6000);
  assert.equal(r.leads[1].headcount, 140);
  // o template agora carrega sinais de timing, que é o que tira o lead de FRIO
  assert.equal(r.leads[1].recentFunding, true);
  assert.equal(r.leads[0].recentFunding, false);
});

test('coluna de sinal que o icp.md define vira flag booleana no lead', () => {
  // noRecentActivity e hiringForTheProblem não estão em FIELD_ALIASES de propósito:
  // os nomes vêm do icp.md de cada pessoa, então o parser aceita qualquer coluna
  // booleana pelo nome dela.
  const r = readLeads({ text: 'name,company,hiringForTheProblem,no recent activity,Fonte\nAna,NorthPay,yes,sim,evento' });
  const lead = r.leads[0];
  assert.equal(lead.hiringForTheProblem, true);
  assert.equal(lead.noRecentActivity, true);
  assert.deepEqual(lead.extra, { Fonte: 'evento' }, 'texto que não é booleano continua indo para extra');
});
