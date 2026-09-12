// panel-core.mjs — a máquina de estados da APROVAÇÃO, pura e testável.
//
// Por que este módulo existe: o painel antigo não tinha aprovação. O texto era
// `readonly` e os botões só registravam, DEPOIS do fato, o que a pessoa já tinha
// enviado à mão. Agora que existe um braço que envia sozinho, "aprovação" deixa de ser
// um gesto e passa a ser um estado com invariante:
//
//   INVARIANTE: nada sai sem um humano ter aprovado. `sendable()` só devolve o que
//   está em 'approved', e 'approved' só se alcança por uma ação humana explícita.
//
// Tudo aqui é função pura: nenhuma rede, nenhum disco, nenhum Date.now() escondido
// (o relógio entra por parâmetro). O servidor e o braço de envio consomem isto.

// ── estados ───────────────────────────────────────────────────────────────────
// pending   nasceu assim, ninguém olhou
// approved  humano leu, talvez editou, e liberou  → é o ÚNICO que pode ser enviado
// rejected  humano leu e disse não
// sent      saiu de verdade (o braço confirmou)
// replied   o lead respondeu antes; a conversa é do humano, não se manda toque
// skipped   pulado por um motivo operacional (sem botão de mensagem, InMail pago...)
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

// O texto que vale: o editado pelo humano, se houver; senão o gerado.
export function finalText(lead, entry) {
  const edited = entry?.text;
  return (typeof edited === 'string' && edited.trim() !== '') ? edited : (lead?.msg || '');
}

// ── transições ────────────────────────────────────────────────────────────────
// applyAction devolve SEMPRE { state, entry, error } e nunca lança. Ação ilegal não
// muda nada e explica por quê — o servidor devolve isso para a tela.
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
      // Editar depois de aprovar REABRE a aprovação: o que o humano leu mudou.
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
      // O portão. Só o que um humano aprovou pode ser marcado como enviado.
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

// ── o que pode ser enviado ────────────────────────────────────────────────────
// A única porta para o braço de envio. Devolve o texto final já resolvido.
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

// ── guardas ───────────────────────────────────────────────────────────────────
// Dono obrigatório, para task E para lead. O painel antigo checava só a task, então
// a nota e o follow-up iam para o lead sem ninguém conferir de quem ele é.
export function assertOwned(entity, ownerId, label = 'entidade') {
  if (ownerId == null) return { ok: false, error: 'sem dono declarado: recuso operar num CRM sem saber quais registros são seus' };
  if (!entity) return { ok: false, error: `${label} não encontrada` };
  const owner = entity.responsible_user_id;
  if (owner !== ownerId) return { ok: false, error: `${label} pertence a outro usuário (${owner}) — recusado` };
  return { ok: true, error: null };
}

// Próximo passo da cadência, respeitando o fim de sequência (`next: null`).
export function nextStepFor(stage, cadencia) {
  const step = cadencia?.[stage];
  if (!step || !step.next) return null;
  return step;
}

// Escape para interpolar em HTML sem abrir buraco. O painel antigo escapava só `<`
// dentro de uma das interpolações; nome de empresa e cargo iam crus.
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
