// leads-file.mjs — leads de uma PLANILHA, para quem não tem CRM.
//
// Este é o caminho principal de quem está começando: exporta um CSV do lugar onde a
// lista já vive (Notion, Airtable, Sheets, Apollo, um export do LinkedIn) e a Roger
// trabalha em cima dele. Sem integração, sem token, sem pedir permissão a ninguém.
//
// Princípios:
//   1. NUNCA lança. Linha ruim vira erro na lista e a rodada segue com as boas — porque
//      uma célula errada não deveria matar uma lista de 200 leads.
//   2. Aceita o cabeçalho que a pessoa já tem, em português ou inglês (FIELD_ALIASES).
//      Ninguém deveria renomear colunas para agradar um script.
//   3. Coerção generosa em cima de dado escrito por humano: "sim", "yes", "x", "6k",
//      "$4,000". O que não der para entender vira aviso, não erro silencioso.
//
// ESM, sem deps.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

// Cada campo do lead e os nomes de coluna que a gente aceita para ele.
// A chave é o campo canônico (o shape documentado no score.mjs).
export const FIELD_ALIASES = {
  name: ['name', 'nome', 'full name', 'contact', 'contato', 'person', 'pessoa', 'lead'],
  company: ['company', 'empresa', 'organization', 'organização', 'organizacao', 'account', 'conta'],
  role: ['role', 'title', 'cargo', 'position', 'posição', 'posicao', 'job title'],
  linkedin: ['linkedin', 'linkedin url', 'profile', 'perfil', 'url', 'link'],
  website: ['website', 'site', 'domain', 'domínio', 'dominio', 'company website'],
  geo: ['geo', 'country', 'país', 'pais', 'location', 'localização', 'localizacao', 'region', 'região'],
  segment: ['segment', 'segmento', 'category', 'categoria', 'vertical', 'industry', 'indústria', 'industria'],
  headcount: ['headcount', 'employees', 'funcionários', 'funcionarios', 'team size', 'tamanho', 'size'],
  budgetProvavel: ['budget', 'orçamento', 'orcamento', 'budget provável', 'budget provavel', 'ticket'],
  stage: ['stage', 'etapa', 'touch', 'toque', 'step'],
  notes: ['notes', 'notas', 'observação', 'observacao', 'obs', 'context', 'contexto'],
  b2b2: ['b2b', 'b2b2', 'vende para empresa', 'sells to business'],
  web3PostMVP: ['post mvp', 'postmvp', 'web3 post-mvp', 'produto ao vivo', 'live'],
  web2Firm: ['web2 firm', 'fund', 'fundo', 'investment firm', 'family office'],
  decisorAcessivel: ['decisor', 'decisor acessível', 'decisor acessivel', 'decision maker', 'reachable'],
  expansaoParaMercadoAlvo: ['expansão', 'expansao', 'expansion', 'target market expansion'],
};

const TRUE_WORDS = new Set(['sim', 's', 'yes', 'y', 'true', 'verdadeiro', '1', 'x', '✓', 'ok']);
const FALSE_WORDS = new Set(['não', 'nao', 'n', 'no', 'false', 'falso', '0', '-', '']);

const BOOLEAN_FIELDS = ['b2b2', 'web3PostMVP', 'web2Firm', 'decisorAcessivel', 'expansaoParaMercadoAlvo'];
const NUMBER_FIELDS = ['headcount', 'budgetProvavel'];

const norm = (s) => String(s ?? '').trim().toLowerCase();

// Mapa alias → campo canônico, montado uma vez.
const ALIAS_TO_FIELD = new Map();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const a of aliases) ALIAS_TO_FIELD.set(norm(a), field);
}

export function fieldForHeader(header) {
  const key = norm(header).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return ALIAS_TO_FIELD.get(key) || null;
}

// ── CSV ───────────────────────────────────────────────────────────────────────
// Parser próprio (em vez de split por vírgula) porque planilha de verdade tem vírgula
// dentro de célula, aspas escapadas e quebra de linha no meio de um campo de texto.
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, ''); // BOM do Excel
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// ── coerção ───────────────────────────────────────────────────────────────────
export function coerceBoolean(value) {
  const v = norm(value);
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined; // desconhecido é diferente de falso, e o gate trata assim
}

// "6k" → 6000 · "$4,000/mo" → 4000 · "12" → 12 · "umas 20" → 20 · "muitos" → undefined
export function coerceNumber(value) {
  const raw = norm(value);
  if (!raw) return undefined;
  const m = raw.match(/(\d[\d.,]*)\s*(k|mil)?/);
  if (!m) return undefined;
  const digits = m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.');
  let n = Number(digits);
  if (!Number.isFinite(n)) return undefined;
  if (m[2]) n *= 1000;
  return n;
}

// ── normalização de uma linha ─────────────────────────────────────────────────
export function normalizeLead(raw, index = 0) {
  const lead = {};
  const extra = {};
  const warnings = [];

  for (const [header, value] of Object.entries(raw || {})) {
    const field = fieldForHeader(header);
    if (!field) {
      const key = String(header).trim();
      if (key) extra[key] = value;
      continue;
    }
    if (BOOLEAN_FIELDS.includes(field)) {
      const b = coerceBoolean(value);
      if (b === undefined) {
        if (norm(value)) warnings.push(`linha ${index + 1}: não entendi "${value}" na coluna ${header}, tratando como desconhecido`);
      } else lead[field] = b;
      continue;
    }
    if (NUMBER_FIELDS.includes(field)) {
      const n = coerceNumber(value);
      if (n === undefined) {
        if (norm(value)) warnings.push(`linha ${index + 1}: não entendi o número "${value}" na coluna ${header}`);
      } else lead[field] = n;
      continue;
    }
    const s = String(value ?? '').trim();
    if (s) lead[field] = s;
  }

  if (Object.keys(extra).length) lead.extra = extra;
  if (!lead.stage) lead.stage = 'MENSAGEM_INICIAL';
  if (!lead.company && !lead.name) {
    return { lead: null, warnings, error: `linha ${index + 1}: sem nome e sem empresa, não há como pesquisar nem escrever` };
  }
  return { lead, warnings, error: null };
}

// ── entrada ───────────────────────────────────────────────────────────────────
// readLeads({ text, format }) ou readLeadsFile(path). Devolve sempre a mesma forma:
// { leads, errors, warnings, source, columnsIgnored }
export function readLeads({ text, format = 'csv' } = {}) {
  const errors = [];
  const warnings = [];
  let records = [];

  if (format === 'json') {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed?.leads || []);
      if (!Array.isArray(arr)) errors.push('JSON não é uma lista de leads nem tem a chave "leads"');
      else records = arr;
    } catch (e) {
      errors.push(`JSON inválido: ${e.message}`);
    }
  } else {
    const rows = parseCsv(text);
    if (!rows.length) {
      errors.push('planilha vazia');
    } else {
      const header = rows[0];
      const known = header.filter((h) => fieldForHeader(h));
      if (!known.length) {
        errors.push(`não reconheci nenhuma coluna no cabeçalho (${header.join(', ')}). Esperado algo como: name, company, linkedin, country`);
      }
      for (const r of rows.slice(1)) {
        const obj = {};
        header.forEach((h, i) => { obj[h] = r[i] ?? ''; });
        records.push(obj);
      }
    }
  }

  const leads = [];
  records.forEach((rec, i) => {
    const { lead, warnings: w, error } = normalizeLead(rec, i + 1);
    warnings.push(...w);
    if (error) errors.push(error);
    else leads.push(lead);
  });

  const columnsIgnored = [...new Set(leads.flatMap((l) => Object.keys(l.extra || {})))];
  return { leads, errors, warnings, source: format, columnsIgnored };
}

export function readLeadsFile(path, opts = {}) {
  const format = opts.format || (extname(String(path)).toLowerCase() === '.json' ? 'json' : 'csv');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { leads: [], errors: [`não consegui abrir ${path}: ${e.code || e.message}`], warnings: [], source: format, columnsIgnored: [] };
  }
  return { ...readLeads({ text, format }), path };
}

// Modelo de planilha para a pessoa começar, com as colunas que rendem mais.
export const TEMPLATE_CSV = `name,company,role,linkedin,website,country,segment,headcount,budget,notes
Ana Ribeiro,NorthPay,Head of Marketing,https://linkedin.com/in/example,https://northpay.example,Singapore,payments,14,6k,met at the payments meetup
Sam Okafor,Truleaf,Founder,https://linkedin.com/in/example2,https://truleaf.example,United States,rwa,9,4k,shipped an audit last week
`;
