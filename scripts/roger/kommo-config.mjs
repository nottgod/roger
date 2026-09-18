// Central Kommo config. The credentials come from the single loader (lib/config.mjs),
// which reads process.env > .env > legacy config.js. NEVER hardcode a token here.
import { loadConfig } from './lib/config.mjs';

const _cfg = loadConfig();

export const TOKEN = _cfg.kommo.token || '';
export const SUBDOMAIN = _cfg.kommo.subdomain || '';
export const BASE = `https://${SUBDOMAIN}.kommo.com/api/v4`;
export const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// CRITICAL RULE: only ever operate on entities owned by THIS user. With no KOMMO_OWNER_ID
// declared this is null, and the owner guard refuses any read or write — on purpose. No
// id belonging to someone else is baked in here.
export const USER_ID = _cfg.kommo.ownerId;

// ── IDs from YOUR Kommo account ────────────────────────────────────────────────
// These numbers are per account: pipeline, stages, task types and custom fields. Fill in
// your own before using the Kommo adapter. If you are on the SPREADSHEET path (the
// recommended way to start), nothing here is used.
//
// How to find them: with the token configured,
//   node -e "import('./kommo-config.mjs').then(k=>k.kget('/leads/pipelines').then(r=>console.log(JSON.stringify(r,null,1))))"
export const PIPELINE_ID = null;
export const STATUS = {
  ENTRADA: null,
  PROSPECCAO: null,
  DESENVOLVIMENTO: null,
};

export const TASK_TYPE = {
  GENERIC: 1,   // 1 e 2 são padrão do Kommo em qualquer conta
  MEETING: 2,
  MENSAGEM_INICIAL: null,
  FUP_1: null,
  FUP_2: null,
  FUP_3: null,
  FUP_4: null,
  FUP_5: null,
  FUP_MAIS: null,
};

export const TASK_TYPE_NAME = Object.fromEntries(
  Object.entries(TASK_TYPE).map(([k, v]) => [v, k]),
);

// Custom fields, also per account.
export const CF_COMPANY = { WEB: null, LINKEDIN: null, COUNTRY: null, CITY: null, TEAM_SIZE: null };
export const CF_CONTACT = { LINKEDIN: null, POSITION_TEXT: null, COUNTRY: null, CITY: null };
export const CF_LEAD = { CAMPANHA: null };

// fetch handling the HTTP 204 gotcha (Kommo returns an empty body when a filter matches nothing)
export async function kget(path) {
  const r = await fetch(BASE + path, { headers: HEADERS });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function kpost(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.json();
}

export async function kpatch(path, body) {
  const r = await fetch(BASE + path, { method: 'PATCH', headers: HEADERS, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path} -> ${r.status} ${await r.text().catch(() => '')}`);
  return r.json();
}

export function cfValue(entity, fieldId) {
  const f = (entity?.custom_fields_values || []).find((x) => x.field_id === fieldId);
  return f?.values?.[0]?.value ?? null;
}
export function cfValues(entity, fieldId) {
  const f = (entity?.custom_fields_values || []).find((x) => x.field_id === fieldId);
  return (f?.values || []).map((v) => v.value);
}
