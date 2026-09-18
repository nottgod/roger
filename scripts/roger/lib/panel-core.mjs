// panel-core.mjs — the APPROVAL state machine, pure and testable.
//
// Why this module exists: the old panel had no approval. The text was `readonly` and the
// buttons only recorded, AFTER the fact, what the person had already sent by hand. Now
// that an arm can send on its own, "approval" stops being a gesture and becomes a state
// with an invariant:
//
//   INVARIANT: nothing goes out without a human having approved it. `sendable()` only
//   returns what is in 'approved', and 'approved' is only reachable by an explicit human act.
//
// Everything here is a pure function: no network, no disk, no hidden Date.now() (the clock
// comes in as a parameter). The server and the sending arm consume this.

// ── states ────────────────────────────────────────────────────────────────────
// pending   it was born this way, nobody looked
// approved  a human read it, maybe edited it, and released it → the ONLY sendable state
// rejected  a human read it and said no
// sent      it really went out (the arm confirmed)
// replied   the lead replied first; the conversation is the human's, no touch is sent
// skipped   skipped for an operational reason (no message button, paid InMail...)
export const STATUSES = ['pending', 'approved', 'rejected', 'sent', 'replied', 'skipped'];

const TERMINAL = new Set(['sent']);

export function createState(batch) {
  const state = {};
  for (const lead of (batch?.leads || [])) {
    state[lead.n] = { status: 'pending', text: null, reason: null, history: [] };
  }
  return state;
}

export function entryFor(state, n) {
  return state[n] || { status: 'pending', text: null, reason: null, history: [] };
}

// The text that counts: the one the human edited, if any; otherwise the generated one.
export function finalText(lead, entry) {
  const edited = entry?.text;
  return (typeof edited === 'string' && edited.trim() !== '') ? edited : (lead?.msg || '');
}

// ── transitions ───────────────────────────────────────────────────────────────
// applyAction ALWAYS returns { state, entry, error } and never throws. An illegal action
// changes nothing and explains why — the server hands that back to the screen.
export function applyAction(state, lead, action, opts = {}) {
  const now = opts.now || new Date();
  const n = lead?.n;
  if (n == null) return { state, entry: null, error: 'lead sem número' };

  const prev = entryFor(state, n);
  const fail = (error) => ({ state, entry: prev, error });

  if (TERMINAL.has(prev.status) && action !== 'undo') {
    return fail(`#${n} já foi enviada — não há o que mudar`);
  }

  let next;
  switch (action) {
    case 'approve': {
      const text = typeof opts.text === 'string' ? opts.text : prev.text;
      const resolved = finalText(lead, { text });
      if (!resolved.trim()) return fail(`#${n} sem texto: não se aprova mensagem vazia`);
      next = { ...prev, status: 'approved', text: text ?? prev.text, reason: null };
      break;
    }
    case 'edit': {
      if (typeof opts.text !== 'string') return fail(`#${n}: edição sem texto`);
      // Editing after approving REOPENS the approval: what the human read changed.
      const status = prev.status === 'approved' ? 'pending' : prev.status;
      next = { ...prev, status, text: opts.text };
      break;
    }
    case 'reject':
      next = { ...prev, status: 'rejected', reason: opts.reason || null };
      break;
    case 'skip':
      next = { ...prev, status: 'skipped', reason: opts.reason || null };
      break;
    case 'replied':
      next = { ...prev, status: 'replied', reason: opts.reason || null };
      break;
    case 'sent': {
      // The gate. Only what a human approved can be marked as sent.
      if (prev.status !== 'approved') {
        return fail(`#${n} não foi aprovada (está em "${prev.status}") — envio recusado`);
      }
      next = { ...prev, status: 'sent' };
      break;
    }
    case 'undo': {
      if (prev.status === 'sent' && !opts.force) {
        return fail(`#${n} já saiu; desfazer aqui não desfaz o envio — use force se quer só limpar o registro local`);
      }
      next = { ...prev, status: 'pending', reason: null };
      break;
    }
    default:
      return fail(`ação desconhecida: ${action}`);
  }

  next.history = [...(prev.history || []), { at: now.toISOString(), action, from: prev.status, to: next.status }];
  return { state: { ...state, [n]: next }, entry: next, error: null };
}

// ── what can be sent ──────────────────────────────────────────────────────────
// The only door to the sending arm. Returns the final text, already resolved.
export function sendable(batch, state) {
  return (batch?.leads || [])
    .filter((lead) => entryFor(state, lead.n).status === 'approved')
    .map((lead) => ({ ...lead, msg: finalText(lead, entryFor(state, lead.n)) }));
}

export function counters(batch, state) {
  const out = { total: (batch?.leads || []).length };
  for (const s of STATUSES) out[s] = 0;
  for (const lead of (batch?.leads || [])) out[entryFor(state, lead.n).status] += 1;
  return out;
}

// ── guards ────────────────────────────────────────────────────────────────────
// The owner is required, for the task AND for the lead. The old panel checked only the
// task, so the note and the follow-up went to a lead nobody had checked the owner of.
export function assertOwned(entity, ownerId, label = 'entidade') {
  if (ownerId == null) return { ok: false, error: 'sem dono declarado: recuso operar num CRM sem saber quais registros são seus' };
  if (!entity) return { ok: false, error: `${label} não encontrada` };
  const owner = entity.responsible_user_id;
  if (owner !== ownerId) return { ok: false, error: `${label} pertence a outro usuário (${owner}) — recusado` };
  return { ok: true, error: null };
}

// The next step in the cadence, respecting the end of the sequence (`next: null`).
export function nextStepFor(stage, cadencia) {
  const step = cadencia?.[stage];
  if (!step || !step.next) return null;
  return step;
}

// Escaping to interpolate into HTML without opening a hole. The old panel escaped only
// `<` inside one of the interpolations; company name and role went in raw.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
