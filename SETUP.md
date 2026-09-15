# Setup

**Time: 20 to 30 minutes**, plus the voice interview (~25 min), which is the part that
actually matters.

The common case: you sell, you do your own outbound, you have a list of leads somewhere,
and you have never touched this repo. You do not need to know how to program. If a step
fails, the failure is the bug — tell us (see [FEEDBACK.md](FEEDBACK.md)).

Prefer having it done for you? Paste [ONBOARDING-PROMPT.md](ONBOARDING-PROMPT.md) into
Claude or ChatGPT and it will walk you through this same trail.

---

## 1. Node 22 or newer

```bash
node --version
```

If it is missing or older: [nodejs.org](https://nodejs.org) (the LTS button), or
`brew install node` on a Mac.

**You got it right if:** the command prints `v22` or higher.

## 2. Get the code and check it

```bash
git clone https://github.com/nottgod/rogeralpha.git roger && cd roger
npm test
```

There is nothing to install — the core has zero dependencies, on purpose.

You will see a row of dots, one per test, and then a line saying they passed. Curious
what each one checks? `npm run test:verbose`.

**You got it right if:** the last line says the tests passed. If one fails it is named
right there, with the reason — send me that.

## 3. Ask Roger what is missing

```bash
npm run doctor
```

It never prints a key, only the last four characters, and it never buys anything.

**You got it right if:** you see a list of warnings about things you have not set up yet,
and `0 blocking`.

## 4. The voice interview

```bash
npm run onboarding
```

Answer honestly, not aspirationally. When it asks for real messages you wrote, paste real
ones — the mediocre ones too. That is the material.

At the end, add `--write` to save:

```bash
node scripts/roger/onboarding.mjs --write
```

**You got it right if:** `rapport/operators/<you>/persona.md` exists and reading it feels
like looking in a mirror. If it does not, run it again — nothing is lost.

## 5. Point Roger at yourself

```bash
export ROGER_OPERATOR=<your-slug>     # the folder name from step 4
export ROGER_CONTEXT=<your-context>   # same
```

Put those two lines in your shell profile so you do not repeat them.

**You got it right if:** `npm run doctor` now says `operator "<you>"` and
`context "<you>"` with a green ok.

## 6. Your leads

**From a spreadsheet (the simple path):** export a CSV. Headers can be in English or
Portuguese — `name`/`nome`, `company`/`empresa`, `country`/`país`. Extra columns are kept,
not thrown away. There is a `leads-template.csv` if you want a starting point.

**From Kommo:** copy `.env.example` to `.env` and fill `KOMMO_TOKEN`,
`KOMMO_SUBDOMAIN` and `KOMMO_OWNER_ID`. That last one is not optional: without knowing
which records are yours, Roger refuses to touch the CRM at all.

**You got it right if:** `npm run doctor` reports the CRM as reachable, or you have a CSV
you can point at.

## 7. Research keys (optional, and they cost money)

In `.env`:

```
EXA_KEY=
FIRECRAWL_KEY=
```

Skip this and Roger still writes — it just tells you it wrote with less context. Every run
records what it spent in `.roger/costs.jsonl`.

**You got it right if:** `npm run doctor` says both keys were accepted. It validates them
with a deliberately empty request, so checking costs nothing.

## 8. Read, edit, approve

```bash
npm run panel leads.csv
```

Opens on `127.0.0.1:4242` — your machine only, never the network. Point it at the same
spreadsheet: each lead becomes a card with an empty message, and you paste in what your
model wrote. Read each message, fix
what is off, and approve. Nothing is sendable before that, and editing after approving
sends it back to you for another look.

**You got it right if:** the header counts your approvals, and
`curl -s 127.0.0.1:4242/approved` shows exactly what you approved, with your edits.

## 9. Sending (do this last, and only when you mean it)

```bash
npm i playwright && npx playwright install chromium
ROGER_IDENTITY=<your-slug> node scripts/roger/send-arm.mjs --queue http://127.0.0.1:4242/approved --dry
```

`--dry` sends nothing. It opens your browser, walks the queue, and tells you which
messages would pass every gate and which would be refused and why.

**Run the dry pass first. Every time, for the first while.** The gates exist because each
one of them is a mistake somebody already made: sending to the wrong person, sending to
someone who already replied, sending twice, sending into a paid InMail, sending past the
daily cap.

The first real run opens a window for you to log into LinkedIn by hand. That session
belongs to you and lives only on your machine.

**You got it right if:** the dry run prints a verdict per lead and sends nothing.

---

## Read-only smoke test (free, writes nothing, sends nothing)

```bash
npm test && npm run doctor -- --offline
```

**Ready if:** tests pass and the doctor shows `0 blocking`.

Roger that.
