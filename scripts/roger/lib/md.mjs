// md.mjs — leitura de arquivo do context pack e parse de tabela markdown.
//
// Por que existe: o padrão "a regra mora no .md, o código só lê" já estava provado no
// gen.mjs, mas a função vivia lá dentro. Aqui ela fica compartilhada, para o score.mjs
// poder ler o ICP sem importar o gerador.
//
// CONTRATO: nunca lança. Arquivo ausente devolve '' e fica registrado em missing(),
// porque o problema nunca foi degradar — foi degradar em silêncio.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function activeContext(env = process.env) {
  // Sem ROGER_CONTEXT declarado, vale o pacote de exemplo — que existe só para mostrar o formato.
  return env.ROGER_CONTEXT || 'example';
}

export function contextDir(opts = {}) {
  return opts.packDir || join(ROOT, 'rapport', 'contexts', activeContext(opts.env));
}

const missingFiles = new Set();
export function missing() {
  return [...missingFiles];
}

export function readContextFile(relPath, opts = {}) {
  const dir = contextDir(opts);
  try {
    return readFileSync(join(dir, relPath), 'utf8');
  } catch {
    missingFiles.add(join(dir, relPath));
    return '';
  }
}

// Extrai linhas de tabela (| a | b |) que aparecem DEPOIS do header que casa headerRe.
// Ignora a linha separadora |---|. Para no primeiro bloco não-tabela depois de a tabela
// ter começado. Devolve array de arrays de células (trim).
export function parseTable(text, headerRe) {
  if (!text) return [];
  const section = headerRe ? (text.split(headerRe)[1] || '') : text;
  const rows = [];
  for (const line of section.split('\n')) {
    if (!/^\s*\|/.test(line)) { if (rows.length) break; else continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c) || c === '')) continue; // separador
    rows.push(cells);
  }
  return rows;
}

// Tabela de duas colunas (chave | valor) → objeto. Chave vazia é ignorada.
export function parseKeyValueTable(text, headerRe) {
  const out = {};
  for (const row of parseTable(text, headerRe)) {
    const key = (row[0] || '').replace(/`/g, '').trim();
    if (!key || /^key$|^chave$/i.test(key)) continue; // cabeçalho
    out[key] = (row[1] || '').trim();
  }
  return out;
}

export function splitList(s) {
  return String(s || '')
    .split(/[,·;]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}
