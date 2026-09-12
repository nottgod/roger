# Feedback

You are one of three people using this before anyone else. The code is young: 222 tests
cover the parts that could do damage, and everything else is a guess that needs your eyes.

What is worth your time to report, in order:

## 1. Did it sound like you?

This is the only question that really matters. Open
`rapport/operators/<you>/persona.md` and the first draft Roger wrote.

- If it sounded like you: which line convinced you?
- If it did not: paste the draft **and** what you would have written instead. That diff is
  worth more to this project than any bug report.

## 2. Where did you get stuck?

Any moment you had to stop and think "what now?" is a defect, even if nothing crashed.
Tell me the step number from [SETUP.md](SETUP.md) and what you expected to happen.

## 3. What did you try to do that did not exist?

You will reach for something that is not there. Write it down before you work around it —
that reflex is the roadmap.

## 4. Would you send it again tomorrow?

Honest answer only. "No, because…" is the most useful sentence in this file.

---

## How to send it

Open an issue, or send it to Antonio directly — whichever is less friction. Rough notes
are fine. A voice message is fine.

**Please do not include:** your API keys, your `.env`, or the real name and message of a
lead who did not agree to appear in a bug report. Mask them (`Ana at <company>`), or
describe the shape of the problem instead of the content.

## Things I already know about

Not worth reporting, they are on the list:

- `rapport/contexts/` ships with one real context that is not yours. Yours comes from the
  interview; the shipped one is a reference.
- There is no CRM adapter other than Kommo yet. The spreadsheet path is the intended one
  for now.
- The engine is documented in Portuguese in `docs/` and speaks English to you. That
  asymmetry is real and it is being fixed.
- Sending needs Playwright installed separately and a manual LinkedIn login. That is
  deliberate, not an oversight.

Roger that.
