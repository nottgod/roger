// sources.test.mjs — tests for the heuristic extraction of the Intelligence layer.
// RULE: zero network. It only exercises extractFromMarkdown (pure parsing).
// Rodar: node --test scripts/roger/sources.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFromMarkdown } from './lib/sources.mjs';

const REAL = 'Acme builds custody infrastructure for tokenized real world assets and institutional settlement across multiple jurisdictions.';

test('extractFromMarkdown: skips the cookie banner and takes the real paragraph', () => {
  const cookie = 'We use cookies to enhance your browsing experience, serve personalized ads and content, and analyze our traffic.';
  const r = extractFromMarkdown(`${cookie}\n\n${REAL}`);
  assert.match(r.description, /custody|tokenized/i);
  assert.doesNotMatch(r.description, /cookie/i);
});

test('extractFromMarkdown: skips the stack and tag list and takes the real paragraph', () => {
  const stack = 'blockchain, mongodb, terraform, postman, datadog, grpc, sql, typescript, ansible, salesforce';
  const r = extractFromMarkdown(`${stack}\n\n${REAL}`);
  assert.match(r.description, /custody|tokenized/i);
  assert.doesNotMatch(r.description, /mongodb|terraform/i);
});

test('extractFromMarkdown: regression — a first paragraph that is already real stays untouched', () => {
  const r = extractFromMarkdown(`${REAL}\n\nSome secondary paragraph that is long enough to pass the length filter here.`);
  assert.match(r.description, /custody|tokenized/i);
});
