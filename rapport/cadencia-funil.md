# Cadence — the single source of truth

> This is the **only** file that defines the cadence. `cadencia.mjs` parses it at runtime, so
> changing a number here changes the behaviour on the next run. No code involved.
>
> **To change the cadence:** edit the numbers in the table below.

---

## Follow-up cadence

Six touches over 28 days: close together at the start, spreading out as the lead goes cold.
The last touch is the honest break-up, and then the sequence **ends** — it does not follow up
forever.

Keep the labels in the first two columns exactly as they are: the parser matches on them.
Change the days.

| Follow-up just sent | Next task | Due in (days since the previous send) |
|---|---|---:|
| First message | FUP 1 | **D+2** |
| FUP 1 | FUP 2 | **D+3** |
| FUP 2 | FUP 3 | **D+4** |
| FUP 3 | FUP 4 | **D+5** |
| FUP 4 | FUP 5 | **D+5** |
| FUP 5 | FUP >5 | **D+6** |
| FUP >5 | end | — |

Accumulated: D+2 → D+5 → D+9 → D+14 → D+19 → D+25, and the sequence closes at D+28.

**The last row is what ends the sequence.** Write `end` (or `stop`, `none`, or the
Portuguese `encerrar`) in the second column and the engine stops chaining. Leave that row out and it also
stops — but writing it is clearer about your intent.

## Weekdays a task may land on

| Day | Valid? | Why |
|---|---|---|
| Monday | ✅ | |
| Tuesday | ✅ | |
| Wednesday | ✅ | |
| Thursday | ✅ | good day for a batch |
| Friday | ❌ | they are already in the weekend, the message disappears |
| Saturday | ❌ | silence |
| Sunday | ❌ | silence |

**Rule:** if D+N lands on a Friday, Saturday or Sunday, push it to the next Monday.

## Non-negotiables

1. **A message sent means the task is closed and the next one is created.** Always. Except when
   the lead replied — then nothing new is created.
2. **A lead who replied leaves the cadence.** The conversation belongs to a human now.
3. **No sending Friday through Sunday.**
4. **A stage is never moved by automation**, and nothing is ever marked lost by automation.
5. **A human approves every message before it goes out.**
