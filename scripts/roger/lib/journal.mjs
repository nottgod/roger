// journal.mjs — a marca durável escrita ANTES do ato irreversível.
//
// Por que isto existe: mandar mensagem é irreversível. Se o processo morre entre o
// envio e o registro, sem uma marca em disco ninguém sabe se a mensagem saiu — e a
// rodada de amanhã manda de novo. Já aconteceu: três proteções contra duplicata
// falharam juntas e o lead levou o mesmo toque duas vezes.
//
// Regras do desenho:
//   1. Grava a INTENÇÃO antes, o desfecho depois. Intenção sem desfecho = pode ter saído.
//   2. Uma linha por evento, escrita numa só chamada, com fsync. Sobrevive a kill -9 e
//      nunca sai pela metade. Linha truncada por queda é ignorada na leitura.
//   3. Sem rede. O ponto é ter a marca justamente quando o CRM está fora do ar.
//   4. Quatro desfechos distintos, porque juntar estados opostos num rótulo é o defeito:
//        registered      a máquina confirmou o registro
//        register_failed saiu, mas o registro falhou
//        resolved        um humano conferiu e fechou
//        reconciled      a máquina fechou comparando com o CRM
//        uncertain       clicou e a confirmação não veio — NÃO fecha
//   5. O teto do dia sai DAQUI, não da task concluída no CRM: para um teto, errar para
//      mais é o lado seguro.
//
// NDJSON append-only, um arquivo por dia. ESM, sem deps.

import { openSync, writeSync, fsyncSync, closeSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DECLARED = 'declared';
export const CLOSERS = ['registered', 'register_failed', 'resolved', 'reconciled'];
export const UNCERTAIN = 'uncertain';

const pad = (n) => String(n).padStart(2, '0');
export function dayKey(date = new Date(), tzOffsetHours = -3) {
  const shifted = new Date(date.getTime() + tzOffsetHours * 3600_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// Escrita durável: uma linha, um fsync. Mais lenta e é de propósito — o volume aqui é
// dezenas de eventos por dia, e o que se compra é não perder a marca.
function appendDurable(file, line) {
  const fd = openSync(file, 'a');
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createJournal(opts = {}) {
  const dir = opts.dir || join(process.cwd(), '.roger', 'journal');
  const clock = opts.clock || (() => new Date());
  const tz = opts.tz ?? -3;
  mkdirSync(dir, { recursive: true });

  const fileFor = (date) => join(dir, `send-${dayKey(date, tz)}.ndjson`);

  const write = (event) => {
    const line = JSON.stringify(event) + '\n';
    appendDurable(fileFor(new Date(event.at)), line);
    return event;
  };

  // Lê um dia (ou todos). Linha inválida/truncada é ignorada, não derruba a leitura.
  const read = (date = null) => {
    const files = date
      ? [fileFor(date)]
      : (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('send-') && f.endsWith('.ndjson')).sort().map((f) => join(dir, f)) : []);
    const events = [];
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* linha truncada por queda */ }
      }
    }
    return events;
  };

  return {
    dir,
    fileFor,
    read,

    // ANTES do envio. Devolve o id que fecha esta intenção.
    declare({ id, identity, leadId, step, text, meta = {} }) {
      const at = clock().toISOString();
      const declaredId = id || `${dayKey(new Date(at), tz)}:${identity || 'unknown'}:${leadId ?? 'x'}:${step || 'x'}:${Date.now()}`;
      write({
        at,
        event: DECLARED,
        id: declaredId,
        identity: identity || null,
        leadId: leadId ?? null,
        step: step || null,
        // Prévia, não a mensagem inteira: o suficiente para reconciliar depois.
        preview: String(text || '').slice(0, 120),
        length: String(text || '').length,
        ...meta,
      });
      return declaredId;
    },

    // DEPOIS. `state` tem de ser um dos CLOSERS, ou UNCERTAIN (que não fecha).
    close(id, state, detail = {}) {
      if (!CLOSERS.includes(state) && state !== UNCERTAIN) {
        throw new Error(`estado de fechamento inválido: ${state}`);
      }
      return write({ at: clock().toISOString(), event: state, id, ...detail });
    },

    // Intenções sem desfecho: podem ter saído. A rodada seguinte tira estes leads da fila.
    pending() {
      const events = read();
      const declared = new Map();
      for (const e of events) {
        if (e.event === DECLARED) declared.set(e.id, e);
        else if (CLOSERS.includes(e.event)) declared.delete(e.id);
        // UNCERTAIN de propósito NÃO remove: continua pendente.
      }
      return [...declared.values()];
    },

    // Teto do dia por IDENTIDADE que envia (a conta é o que se queima, não o dono do card).
    countToday(identity, date = clock()) {
      return read(date).filter((e) => e.event === DECLARED && (!identity || e.identity === identity)).length;
    },

    capReached(identity, cap, date = clock()) {
      if (!cap) return false;
      return this.countToday(identity, date) >= cap;
    },
  };
}
