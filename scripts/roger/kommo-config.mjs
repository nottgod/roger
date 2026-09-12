// Config central do Kommo. As credenciais vêm do carregador único (lib/config.mjs),
// que lê process.env > .env > config.js legado. NUNCA hardcodar token aqui.
import { loadConfig } from './lib/config.mjs';

const _cfg = loadConfig();

export const TOKEN = _cfg.kommo.token || '';
export const SUBDOMAIN = _cfg.kommo.subdomain || '';
export const BASE = `https://${SUBDOMAIN}.kommo.com/api/v4`;
export const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

// REGRA CRÍTICA: só operar entidades DESTE usuário. Sem KOMMO_OWNER_ID declarado isto é
// null, e a guarda de dono recusa qualquer leitura ou escrita — de propósito. Nenhum id
// de outra pessoa vem embutido aqui.
export const USER_ID = _cfg.kommo.ownerId;

// ── IDs da SUA conta Kommo ─────────────────────────────────────────────────────
// Estes números são de cada conta: pipeline, etapas, tipos de task e campos custom.
// Preencha com os seus antes de usar o adaptador de Kommo. Se você está no caminho da
// PLANILHA (o recomendado para começar), nada aqui é usado.
//
// Como descobrir: com o token configurado,
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

// Campos custom, também por conta.
export const CF_COMPANY = { WEB: null, LINKEDIN: null, COUNTRY: null, CITY: null, TEAM_SIZE: null };
export const CF_CONTACT = { LINKEDIN: null, POSITION_TEXT: null, COUNTRY: null, CITY: null };
export const CF_LEAD = { CAMPANHA: null };

// fetch com tratamento do gotcha HTTP 204 (Kommo devolve corpo vazio quando filtro não casa)
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
