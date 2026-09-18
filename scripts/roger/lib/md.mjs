// md.mjs — reading a context pack file, and parsing a markdown table.
//
// Why it exists: the pattern "the rule lives in the .md, the code only reads it" was
// already proven in gen.mjs, but the function lived inside it. Here it is shared, so
// score.mjs can read the ICP without importing the generator.
//
// CONTRACT: it never throws. A missing file returns '' and is recorded in missing(),
// because the problem was never degrading — it was degrading in silence.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

export function activeContext(env = process.env) {
  // With no ROGER_CONTEXT declared, the example pack wins — it exists only to show the shape.
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

// Pulls table rows (| a | b |) that appear AFTER the header matching headerRe. Skips the
// separator row |---|. Stops at the first non-table block once the table has started.
// Returns an array of arrays of cells (trimmed).
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

// A two column table (key | value) becomes an object. An empty key is ignored.
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
