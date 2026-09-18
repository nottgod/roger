// send-gates.mjs — the refusals, decided by PURE FUNCTION.
//
// The sending arm has two halves: one that drives the browser and one that decides. This
// is the one that decides, and it knows nothing about Playwright: it takes a snapshot of
// the screen as plain data and answers "send" or "do not send, for this reason". That is
// what makes every refusal provable without opening a browser or touching a LinkedIn account.
//
// The snapshot:
// {
//   url, bannerText,          // only what the PLATFORM controls (see detectBlock)
//   hasMessageChannel: bool,  // there is a way to message from this profile
//   isInMailComposer: bool,   // the paid composer (the lead is no longer a direct connection)
//   recipientName,            // the name the screen shows as the recipient
//   bubbles: [{ fromMe, text }]  // the conversation, in chronological order
// }
//
// No function here throws.

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const refuse = (code, reason) => ({ ok: false, code, reason });
const allow = () => ({ ok: true, code: null, reason: null });

// ── platform block signal ─────────────────────────────────────────────────────
// ONLY from a region the platform controls. The reference implementation swept the whole
// page text, and the lead's own words are in that body: a lead who wrote "captcha" took
// down the entire run on a false positive. That is not worth copying.
const BLOCK_PATTERNS = [
  /\/checkpoint\//i,
  /\/authwall/i,
  /unusual activity/i,
  /verify (your )?identity/i,
  /you.?ve reached the (weekly|daily) (invitation )?limit/i,
  /temporarily restricted/i,
];

export function detectBlock({ url = '', bannerText = '' } = {}) {
  for (const re of BLOCK_PATTERNS) {
    if (re.test(String(url)) || re.test(String(bannerText))) {
      return refuse('blocked', 'a plataforma sinalizou bloqueio ou limite — a rodada encerra, ninguém tenta resolver isso');
    }
  }
  return allow();
}

// ── recipient ─────────────────────────────────────────────────────────────────
// Matches the full name, not just the first. The reference opened the thread by first
// name, which sends to the wrong person when two people share one — and sending to the
// wrong person is the expensive mistake. With no confirmation, it refuses (fails closed).
export function recipientMatches(expected, seen) {
  const e = norm(expected);
  const s = norm(seen);
  if (!e || !s) return false;
  if (e === s) return true;
  const parts = e.split(' ').filter((p) => p.length > 1);
  if (parts.length === 1) return s.includes(parts[0]);
  const first = parts[0];
  const last = parts[parts.length - 1];
  return s.includes(first) && s.includes(last);
}

// ── conversation state ────────────────────────────────────────────────────────
// They replied = there is a message from them AFTER our first touch. It does not matter
// who sent the last one: the operator may have written back.
export function alreadyReplied(bubbles = []) {
  const firstMine = bubbles.findIndex((b) => b?.fromMe);
  if (firstMine === -1) return false;
  return bubbles.slice(firstMine + 1).some((b) => b && !b.fromMe);
}

// They wrote first: the thread opens with a message from them. Pitching here was a real
// and deterministic incident — it repeated every day until someone noticed.
export function wroteFirst(bubbles = []) {
  const first = bubbles.find((b) => b && (b.fromMe === true || b.fromMe === false));
  return !!first && first.fromMe === false;
}

// Idempotency by CONTENT: is this exact text already in the thread?
export function isDuplicate(bubbles = [], text = '') {
  const t = norm(text);
  if (!t) return false;
  const short = t.slice(0, 80);
  return bubbles.some((b) => b && norm(b.text).includes(short));
}

// ── the decision ──────────────────────────────────────────────────────────────
// The order is deliberate: whatever is cheapest and most serious comes first.
export function decide(snapshot = {}, touch = {}, opts = {}) {
  const s = snapshot;

  const block = detectBlock(s);
  if (!block.ok) return block;

  if (opts.capReached) {
    return refuse('cap-reached', 'teto de envios da conta atingido hoje — a conta é o que se queima, e ela não se repõe');
  }
  if (opts.alreadyTouchedToday) {
    return refuse('same-day', 'este lead já recebeu um toque hoje');
  }
  if (opts.outsideWindow) {
    return refuse('window', 'toque planejado para mais tarde — atrasado sai, adiantado não');
  }

  if (s.hasMessageChannel === false) {
    return refuse('no-message-channel', 'não há caminho de mensagem neste perfil — é questão de conexão, não de conteúdo');
  }
  if (s.isInMailComposer === true) {
    return refuse('inmail', 'compositor pago: o lead não é mais conexão direta, e isto gastaria crédito achando que era mensagem normal');
  }
  if (touch.recipient && !recipientMatches(touch.recipient, s.recipientName)) {
    return refuse('recipient-mismatch', `não confirmei o destinatário (esperava "${touch.recipient}", a tela diz "${s.recipientName ?? '—'}")`);
  }
  if (!Array.isArray(s.bubbles)) {
    return refuse('unreadable-thread', 'não consegui ler a conversa — "não sei ler" nunca é "está vazia"');
  }
  if (wroteFirst(s.bubbles)) {
    return refuse('wrote-first', 'ele escreveu primeiro: isto é conversa, não outbound — vai para o humano');
  }
  if (alreadyReplied(s.bubbles)) {
    return refuse('already-replied', 'o lead já respondeu — responder pitch com pitch é o pior que se pode fazer aqui');
  }
  if (isDuplicate(s.bubbles, touch.text)) {
    return refuse('duplicate', 'este texto já está na conversa');
  }
  if (!String(touch.text || '').trim()) {
    return refuse('empty', 'sem texto para enviar');
  }
  if (touch.approved !== true) {
    return refuse('not-approved', 'este toque não foi aprovado por um humano');
  }

  return allow();
}

// ── pacing ────────────────────────────────────────────────────────────────────
// The pause is the anti-ban. What the robot buys you is overhead, never cadence: speed
// is not a licence to raise volume.
export function pauseMs(rand = Math.random, { minMs = 30_000, maxMs = 120_000 } = {}) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.floor(lo + rand() * (hi - lo));
}

// Circuit breaker: isolating lead by lead protects you from a one-off defect, but if the
// browser died you will burn the whole queue producing the same error.
export function createBreaker(limit = 3) {
  let streak = 0;
  return {
    ok() { streak = 0; },
    fail() { streak += 1; return streak >= limit; },
    get streak() { return streak; },
    get tripped() { return streak >= limit; },
  };
}
