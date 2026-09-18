# Roger

An open source AI SDR you build yourself. It researches the lead, writes in **your**
voice, and you are the one who sends.

Nobody is selling you a product here. The hard part of outbound was never the software —
it is your voice, your context and your judgment. Those live in plain files that belong
to you. This repo is the structure around them.

```bash
git clone https://github.com/nottgod/roger.git && cd roger
npm run onboarding
```

That interview is the whole idea: ~25 minutes of questions about how you actually write,
and it produces the two files that drive everything — your voice and your market.

**Status: public beta.** 231 tests, zero dependencies, and a handful of people who
already found the first eighteen rough edges. One thing you should know before you count
on it: the sending arm has never typed a message into the real LinkedIn. Everything around
it is tested against a fake browser. If you go there, you go first — and I want to hear
what happened. The rest is yours to break: see [FEEDBACK.md](FEEDBACK.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

I hope you fork me.

---

## How you use it

Roger is not a tool you configure once. It is a handful of plain files that belong to
you, and it gets better because **you** feed it: every time a message lands or falls
flat, you learn something about how you sell — put it in the files. Nobody else is
editing them, which is why no two Rogers write alike.

The loop: you point it at a lead → it decides whether the lead is worth writing to →
it researches what it can → it builds a briefing → **your model writes the message** →
your voice guard checks it → you approve it → it gets sent.

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
| **Node 22 or newer** | The core itself has zero dependencies. |
| **A Claude or a ChatGPT** | **Required.** Roger does not write the message: it decides who is worth writing to, researches them, and builds the briefing. Your model writes from it. There is no model key in this repo and there will not be — yours is already paid for, and you should not have to buy a second one. |
| **Research keys** | **Required in practice.** [Exa](https://dashboard.exa.ai) and [Firecrawl](https://firecrawl.dev), paid by you. Without them Roger writes from whatever is in your spreadsheet, and tells you so. The hook is the difference between a message that gets answered and one that does not. |
| **Your leads** | A CSV works (`name,company,country,...` — English or Portuguese headers). A Kommo CRM also works. |
| **To send** | Two ways. By hand: the panel has a copy button, and you paste it into LinkedIn yourself — nothing to install. Or the arm: `npm i playwright && npx playwright install chromium`, plus one manual LinkedIn login in a window Roger opens. The arm is what keeps the books (what went out, to whom, when) — by hand, that part is on you. |

```bash
npm run doctor      # tells you exactly what is missing
npm test            # 231 tests, no network
npm run onboarding  # the interview
npm run draft       # the briefing, ready to paste into your model
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
```

Change those markdown files and the behaviour changes. No code involved — that is the
point of the whole design.

## License

MIT. Take it, break it, adapt it to your company, build one better than this.

Roger that.
