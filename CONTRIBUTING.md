# Contributing

Roger is a structure around files that belong to you. That shapes what a good contribution
looks like here, so read this part before the mechanics:

**Most changes are not code.** If Roger writes badly for your market, the fix is almost
never in `scripts/roger/` — it is in `rapport/contexts/<you>/` and
`rapport/operators/<you>/`. Those are plain markdown, they are yours, and changing them
changes the behaviour. That is the whole design, not a limitation.

**Fork it.** If you want Roger to work differently — another CRM, another channel, another
language, another opinion about what a good first message is — a fork is a better answer
than a pull request that tries to make one repo serve both of us. I would rather see ten
Rogers that disagree than one that hedges.

## Before you open a pull request

```bash
npm test     # 238 tests, and none of them touch the network
```

If the tests need the network to pass, something is wrong with the test, not with your
connection. The core has zero dependencies on purpose — a PR that adds one to
`package.json` needs to say in the description why the standard library could not do it.

Commits in this repo say what changed and why it mattered, in one line, in the imperative.
Look at `git log` and match it.

## The one rule that is not about code

**No real people in this repo.** Not in a test fixture, not in an example, not in a bug
report. That means:

- no API keys, no `config.js`, no `.env` (all three are gitignored — keep it that way);
- no real lead's name, company, message or CRM id. Mask it (`Ana at <company>`) or invent
  someone, the way `rapport/contexts/example/` does;
- no screenshot with a live LinkedIn thread in it.

The CI runs gitleaks on every push and will fail the build, but do not lean on it — it
catches shapes it recognises, not judgment you skipped.

## What is most useful right now

1. **The sending arm has never touched the real LinkedIn.** `lib/linkedin-page.mjs` is the
   only module without tests and it has never met the site it was written for. Anyone who
   runs it for real and reports back is doing the highest-value thing available.
2. **A CRM adapter that is not Kommo.** The spreadsheet path works; the CRM path assumes
   Kommo. The seam is `kommo-config.mjs` and it is narrower than it looks.
3. **Comments and test names are in Portuguese** while everything written for the reader is
   in English. Translating them is dull and genuinely helps.

Roger that.
