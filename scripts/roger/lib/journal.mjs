// journal.mjs — the durable mark written BEFORE the irreversible act.
//
// Why this exists: sending a message cannot be undone. If the process dies between the
// send and the record, with no mark on disk nobody knows whether the message went out —
// and tomorrow's run sends it again. It has happened: three duplicate guards failed
// together and the lead got the same touch twice.
//
// Design rules:
//   1. Write the INTENT first, the outcome after. Intent with no outcome = it may have gone.
//   2. One line per event, written in a single call, with fsync. It survives kill -9 and
//      never comes out half written. A line truncated by a crash is skipped on read.
//   3. No network. The whole point is having the mark exactly when the CRM is down.
//   4. Four distinct outcomes, because collapsing opposite states into one label is the bug:
//        registered      the machine confirmed the record
//        register_failed it went out, but recording it failed
//        resolved        a human checked and closed it
//        reconciled      the machine closed it by comparing against the CRM
//        uncertain       it was clicked and no confirmation came — does NOT close
//   5. The daily cap comes from HERE, not from the task closed in the CRM: for a cap,
//      erring on the high side is the safe side.
//
// Append-only NDJSON, one file per day. ESM, no deps.

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

// Durable write: one line, one fsync. Slower, and deliberately so — the volume here is
// dozens of events a day, and what you buy is never losing the mark.
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

  // Reads one day (or all). An invalid or truncated line is skipped, not fatal.
  const read = (date = null) => {
    const files = date
      ? [fileFor(date)]
      : (existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith('send-') && f.endsWith('.ndjson')).sort().map((f) => join(dir, f)) : []);
    const events = [];
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* a line truncated by a crash */ }
      }
    }
    return events;
  };

  return {
    dir,
    fileFor,
    read,

    // BEFORE the send. Returns the id that closes this intent.
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
        // A preview, not the whole message: enough to reconcile later.
        preview: String(text || '').slice(0, 120),
        length: String(text || '').length,
        ...meta,
      });
      return declaredId;
    },

    // AFTER. `state` has to be one of CLOSERS, or UNCERTAIN (which does not close).
    close(id, state, detail = {}) {
      if (!CLOSERS.includes(state) && state !== UNCERTAIN) {
        throw new Error(`invalid closing state: ${state}`);
      }
      return write({ at: clock().toISOString(), event: state, id, ...detail });
    },

    // Intents with no outcome: they may have gone out. The next run drops these leads.
    pending() {
      const events = read();
      const declared = new Map();
      for (const e of events) {
        if (e.event === DECLARED) declared.set(e.id, e);
        else if (CLOSERS.includes(e.event)) declared.delete(e.id);
        // UNCERTAIN deliberately does NOT remove: it stays pending.
      }
      return [...declared.values()];
    },

    // Daily cap per sending IDENTITY (the account is what gets burned, not the card owner).
    countToday(identity, date = clock()) {
      return read(date).filter((e) => e.event === DECLARED && (!identity || e.identity === identity)).length;
    },

    capReached(identity, cap, date = clock()) {
      if (!cap) return false;
      return this.countToday(identity, date) >= cap;
    },
  };
}
