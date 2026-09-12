// send-gates.mjs — as recusas, decididas por FUNÇÃO PURA.
//
// O braço de envio tem duas metades: uma que dirige o navegador e uma que decide. Esta
// é a que decide, e ela não conhece Playwright: recebe um retrato da tela como dado
// simples e devolve "manda" ou "não manda, por este motivo". É o que permite provar
// cada recusa sem abrir navegador e sem tocar numa conta de LinkedIn.
//
// O retrato (snapshot):
// {
//   url, bannerText,          // só o que a PLATAFORMA controla (ver detectBlock)
//   hasMessageChannel: bool,  // existe caminho de mensagem no perfil
//   isInMailComposer: bool,   // compositor pago (o lead não é mais conexão direta)
//   recipientName,            // nome que a tela mostra como destinatário
//   bubbles: [{ fromMe, text }]  // conversa, em ordem cronológica
// }
//
// Nenhuma função aqui lança.

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const refuse = (code, reason) => ({ ok: false, code, reason });
const allow = () => ({ ok: true, code: null, reason: null });

// ── sinal de bloqueio da plataforma ───────────────────────────────────────────
// SÓ de região que a plataforma controla. A referência varria o texto inteiro da
// página, e o texto do lead está nesse corpo: um lead que escrevesse "captcha"
// derrubava a rodada inteira por falso positivo. Isso não se copia.
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

// ── destinatário ──────────────────────────────────────────────────────────────
// Casa nome completo, não só o primeiro. A referência abria a conversa pelo primeiro
// nome, o que manda para a pessoa errada quando há homônimo — e mandar para a pessoa
// errada é o erro caro. Sem confirmação, recusa (falha fechada).
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

// ── estado da conversa ────────────────────────────────────────────────────────
// Respondeu = existe mensagem dele DEPOIS do nosso primeiro toque. Não importa quem
// mandou a última: o operador pode ter respondido de volta.
export function alreadyReplied(bubbles = []) {
  const firstMine = bubbles.findIndex((b) => b?.fromMe);
  if (firstMine === -1) return false;
  return bubbles.slice(firstMine + 1).some((b) => b && !b.fromMe);
}

// Ele escreveu primeiro: a thread começa com mensagem dele. Mandar pitch aqui foi
// incidente real e determinístico — repetia todo dia até alguém notar.
export function wroteFirst(bubbles = []) {
  const first = bubbles.find((b) => b && (b.fromMe === true || b.fromMe === false));
  return !!first && first.fromMe === false;
}

// Idempotência por CONTEÚDO: este texto já está na thread?
export function isDuplicate(bubbles = [], text = '') {
  const t = norm(text);
  if (!t) return false;
  const short = t.slice(0, 80);
  return bubbles.some((b) => b && norm(b.text).includes(short));
}

// ── a decisão ─────────────────────────────────────────────────────────────────
// Ordem deliberada: o que é mais barato e mais grave primeiro.
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

// ── ritmo ─────────────────────────────────────────────────────────────────────
// A pausa é o anti-ban. O ganho do robô é de overhead, nunca de cadência: velocidade
// não é licença para subir volume.
export function pauseMs(rand = Math.random, { minMs = 30_000, maxMs = 120_000 } = {}) {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return Math.floor(lo + rand() * (hi - lo));
}

// Disjuntor: isolar lead a lead protege do defeito pontual, mas se o navegador morreu
// você gasta a fila inteira produzindo o mesmo erro.
export function createBreaker(limit = 3) {
  let streak = 0;
  return {
    ok() { streak = 0; },
    fail() { streak += 1; return streak >= limit; },
    get streak() { return streak; },
    get tripped() { return streak >= limit; },
  };
}
