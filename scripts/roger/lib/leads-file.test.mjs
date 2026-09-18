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

// ─── real CSV, not a split on commas ─────────────────────────────────────────
test('parseCsv respects a comma inside quotes', () => {
  const rows = parseCsv('name,notes\nAna,"met her in Lisbon, talked about RWA"\n');
  assert.deepEqual(rows[1], ['Ana', 'met her in Lisbon, talked about RWA']);
});

test('parseCsv understands escaped quotes and a line break inside a cell', () => {
  const rows = parseCsv('name,notes\nAna,"disse ""sim"" na call\ne pediu proposta"\n');
  assert.equal(rows[1][1], 'disse "sim" na call\ne pediu proposta');
});

test('parseCsv tolerates the Excel BOM, CRLF and semicolons', () => {
  const rows = parseCsv('﻿name;company\r\nAna;NorthPay\r\n');
  assert.deepEqual(rows[0], ['name', 'company']);
  assert.deepEqual(rows[1], ['Ana', 'NorthPay']);
});

test('parseCsv drops a completely empty row', () => {
  const rows = parseCsv('name\nAna\n\n\nSam\n');
  assert.deepEqual(rows, [['name'], ['Ana'], ['Sam']]);
});

// ─── the header the person already has ───────────────────────────────────────
test('a header in English or Portuguese lands in the same field', () => {
  assert.equal(fieldForHeader('Empresa'), 'company');
  assert.equal(fieldForHeader('company'), 'company');
  assert.equal(fieldForHeader('País'), 'geo');
  assert.equal(fieldForHeader('country'), 'geo');
  assert.equal(fieldForHeader('Team Size'), 'headcount');
  assert.equal(fieldForHeader('team_size'), 'headcount');
  assert.equal(fieldForHeader('coluna que ninguém conhece'), null);
});

// ─── coercing data written by a human ────────────────────────────────────────
test('boolean accepts yes, sim, x, and treats empty as unknown', () => {
  assert.equal(coerceBoolean('sim'), true);
  assert.equal(coerceBoolean('YES'), true);
  assert.equal(coerceBoolean('x'), true);
  assert.equal(coerceBoolean('não'), false);
  assert.equal(coerceBoolean('no'), false);
  assert.equal(coerceBoolean(''), false);
  assert.equal(coerceBoolean('talvez'), undefined);
});

test('number understands k, thousands separators and currency noise', () => {
  assert.equal(coerceNumber('6k'), 6000);
  assert.equal(coerceNumber('$4,000/mo'), 4000);
  assert.equal(coerceNumber('12'), 12);
  assert.equal(coerceNumber('umas 20 pessoas'), 20);
  assert.equal(coerceNumber('muitos'), undefined);
  assert.equal(coerceNumber(''), undefined);
});

// ─── normalising ─────────────────────────────────────────────────────────────
test('a row becomes a lead in the shape score expects', () => {
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

test('an unknown column is kept in extra, not thrown away', () => {
  const { lead } = normalizeLead({ name: 'Ana', 'Fonte do lead': 'evento em Lisboa' });
  assert.deepEqual(lead.extra, { 'Fonte do lead': 'evento em Lisboa' });
});

test('a row with no name and no company is an explained error, not silence', () => {
  const { lead, error } = normalizeLead({ country: 'Brazil' }, 3);
  assert.equal(lead, null);
  assert.match(error, /linha 4/);
  assert.match(error, /sem nome e sem empresa/);
});

test('a value that cannot be understood becomes a warning, and the lead survives', () => {
  const { lead, warnings } = normalizeLead({ name: 'Ana', 'Team Size': 'sei lá' });
  assert.equal(lead.name, 'Ana');
  assert.equal(lead.headcount, undefined);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /não entendi o número/);
});

// ─── leitura completa ────────────────────────────────────────────────────────
test('one bad row does not take down the whole list', () => {
  const csv = 'name,company\nAna,NorthPay\n,\nSam,Truleaf\n';
  const r = readLeads({ text: csv });
  assert.equal(r.leads.length, 2);
  assert.deepEqual(r.leads.map((l) => l.name), ['Ana', 'Sam']);
});

test('an unrecognisable header explains what was expected', () => {
  const r = readLeads({ text: 'col1,col2\na,b\n' });
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /não reconheci nenhuma coluna/);
  assert.match(r.errors[0], /name, company, linkedin/);
});

test('an empty sheet is an error, not zero leads in silence', () => {
  assert.match(readLeads({ text: '' }).errors[0], /vazia/);
});

test('JSON works too, as a list or under the leads key', () => {
  const a = readLeads({ text: '[{"name":"Ana","company":"NorthPay"}]', format: 'json' });
  assert.equal(a.leads[0].company, 'NorthPay');
  const b = readLeads({ text: '{"leads":[{"name":"Sam"}]}', format: 'json' });
  assert.equal(b.leads[0].name, 'Sam');
});

test('invalid JSON returns a readable error and no exception', () => {
  const r = readLeads({ text: '{ isto não é json', format: 'json' });
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /JSON inválido/);
});

test('a missing file returns an error, it does not throw', () => {
  const r = readLeadsFile('/caminho/que/nao/existe.csv');
  assert.equal(r.leads.length, 0);
  assert.match(r.errors[0], /não consegui abrir/);
});

test('the format comes from the file extension', () => {
  const p = tmp('leads.json', '[{"name":"Ana"}]');
  const r = readLeadsFile(p);
  assert.equal(r.source, 'json');
  assert.equal(r.leads[0].name, 'Ana');
});

test('the starter spreadsheet we ship is read with no errors at all', () => {
  const r = readLeads({ text: TEMPLATE_CSV });
  assert.deepEqual(r.errors, []);
  assert.equal(r.leads.length, 2);
  assert.equal(r.leads[0].company, 'NorthPay');
  assert.equal(r.leads[0].budgetProvavel, 6000);
  assert.equal(r.leads[1].headcount, 140);
  // the template now carries timing signals, which is what lifts the lead out of COLD
  assert.equal(r.leads[1].recentFunding, true);
  assert.equal(r.leads[0].recentFunding, false);
});

test('a signal column named in icp.md becomes a boolean flag on the lead', () => {
  // noRecentActivity and hiringForTheProblem are deliberately not in FIELD_ALIASES:
  // the names come from each person icp.md, so the parser accepts any column
  // booleana pelo nome dela.
  const r = readLeads({ text: 'name,company,hiringForTheProblem,no recent activity,Fonte\nAna,NorthPay,yes,sim,evento' });
  const lead = r.leads[0];
  assert.equal(lead.hiringForTheProblem, true);
  assert.equal(lead.noRecentActivity, true);
  assert.deepEqual(lead.extra, { Fonte: 'evento' }, 'texto que não é booleano continua indo para extra');
});
