# Roger

An open source AI SDR you build yourself. It researches the lead, writes in **your**
voice, and you are the one who sends.

Nobody is selling you a product here. The hard part of outbound was never the software —
it is your voice, your context and your judgment. Those live in plain files that belong
to you. This repo is the structure around them.

```bash
git clone https://github.com/nottgod/rogeralpha.git roger && cd roger
npm run onboarding
```

That interview is the whole idea: ~25 minutes of questions about how you actually write,
and it produces the two files that drive everything — your voice and your market.

**Status: private alpha.** It runs, it has 222 tests, and it has rough edges. You are
here because you were invited to find them. See [FEEDBACK.md](FEEDBACK.md).

---

## What it does

1. **Learns your voice.** An interview, not a form. Your answers become
   `rapport/operators/<you>/voice.json`, which configures a hard filter that blocks any
   message that does not sound like you.
2. **Learns your market.** Who is worth writing to and who is an automatic pass, as
   editable tables in `rapport/contexts/<you>/icp.md`.
3. **Reads before it writes.** Optional research keys (Exa, Firecrawl) look up the person
   and the company. Without them it still writes, and it tells you it had less context
   instead of pretending otherwise.
4. **Writes a draft, in three layers:** the diagnosis (what is missing for this lead),
   the culture (how people expect to be addressed where they are), and the wording.
5. **You read it, you fix it, you approve it.** Nothing is sendable before that.
6. **Then it sends** — a browser it drives types the message. Or you copy it and send it
   yourself. Both are first-class.
7. **It holds the cadence**, and the sequence *ends* instead of following up forever.

## What you need

| | |
|---|---|
| **Required** | Node 22 or newer. That's it — the core has zero dependencies. |
| **Your leads** | A CSV works (`name,company,country,...` — English or Portuguese headers). A Kommo CRM also works. |
| **Optional** | [Exa](https://dashboard.exa.ai) and [Firecrawl](https://firecrawl.dev) keys for research. They cost money, so they are yours to choose. |
| **To send** | `npm i playwright && npx playwright install chromium`, plus logging into LinkedIn by hand once, in a window Roger opens. |

```bash
npm run doctor      # tells you exactly what is missing
npm test            # 222 tests, no network
npm run onboarding  # the interview
npm run panel       # read, edit, approve
npm run arm         # send what you approved
```

## The two rules that are code, not promises

**A human approves every message.** The approval is a state, not a gesture: the queue the
sender reads only contains what you approved, and editing a message after approving it
reopens the approval, because what you read changed.

**Your leads only.** If you connect a CRM, you declare your own user id, and Roger refuses
to read or write anything that belongs to a teammate. It never moves a deal stage and
never marks anything lost.

## Where things live

```
scripts/roger/          the engine (Node, no dependencies)
  lib/voice.mjs         your voice, as data
  lib/send-gates.mjs    every reason to refuse a send, as pure functions
  lib/journal.mjs       what it is about to do, written down before it does it
rapport/
  operators/<you>/      your voice          ← the interview writes this
  contexts/<you>/       your market         ← the interview writes this
  cadencia-funil.md     your cadence, editable
docs/                   design and architecture notes
```

Change those markdown files and the behaviour changes. No code involved — that is the
point of the whole design.

## License

MIT. Take it, break it, adapt it to your company, build one better than this.

Roger that.
