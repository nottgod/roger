# Security

## Reporting something

Do not open a public issue for a vulnerability. Use
[GitHub's private advisory form](https://github.com/nottgod/roger/security/advisories/new),
or email `antonio@useroger.io` with `roger security` in the subject.

Tell me what you found, how to reproduce it, and what it lets someone do. You will get an
answer — this is one person's project, so expect days, not hours.

## What Roger holds that is worth protecting

Roger runs on your machine, and everything sensitive stays there. There is no server, no
account and no telemetry. What lives locally:

| | |
|---|---|
| `config.js`, `.env` | your API keys (Exa, Firecrawl, CRM). **Gitignored.** Never commit them. |
| `rapport/` | your voice and your market. Yours, and safe to version in a private fork. |
| your leads | third parties who did not agree to be in your repo. Keep them out of it. |
| `journal/`, `.roger/`, `batch-*.json`, `chrome-profile-*/` | run state and browser sessions. **Gitignored** — a browser profile is an authenticated session. |

## If a key leaks

Rotate it at the source first — Exa, Firecrawl, your CRM — and only then worry about the
history. A key removed from a commit but still valid is still leaked. Rewriting git history
does not un-publish anything a scraper already read.

## Two things that are security properties, not features

**A human approves every message.** The queue the sender reads contains only what you
approved, and editing an approved message reopens the approval. If you find a path that
sends something a human never read, that is a vulnerability — report it as one.

**Your leads only.** With a CRM connected, Roger is given your user id and refuses to read
or write records belonging to anyone else. It never moves a deal stage and never marks
anything lost. A path around that check is also a vulnerability.

Roger that.
