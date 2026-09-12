// sources.test.mjs — testes da extração heurística da camada Intelligence (Roger v5, F2).
// REGRA: zero rede. Só exercita extractFromMarkdown (parsing puro).
// Rodar: node --test scripts/roger/sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromMarkdown } from './lib/sources.mjs';

const REAL = 'Acme builds custody infrastructure for tokenized real world assets and institutional settlement across multiple jurisdictions.';

test('extractFromMarkdown: pula banner de cookie e pega o parágrafo real', () => {
  const cookie = 'We use cookies to enhance your browsing experience, serve personalized ads and content, and analyze our traffic.';
  const r = extractFromMarkdown(`${cookie}\n\n${REAL}`);
  assert.match(r.description, /custody|tokenized/i);
  assert.doesNotMatch(r.description, /cookie/i);
});

test('extractFromMarkdown: pula lista de stack/tags e pega o parágrafo real', () => {
  const stack = 'blockchain, mongodb, terraform, postman, datadog, grpc, sql, typescript, ansible, salesforce';
  const r = extractFromMarkdown(`${stack}\n\n${REAL}`);
  assert.match(r.description, /custody|tokenized/i);
  assert.doesNotMatch(r.description, /mongodb|terraform/i);
});

test('extractFromMarkdown: regressão — primeiro parágrafo já real fica inalterado', () => {
  const r = extractFromMarkdown(`${REAL}\n\nSome secondary paragraph that is long enough to pass the length filter here.`);
  assert.match(r.description, /custody|tokenized/i);
});
