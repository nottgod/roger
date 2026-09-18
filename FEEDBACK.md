# Feedback

The code is young. 238 tests cover the parts that could do damage, and everything else
is a guess that needs your eyes. Three people used this before it was public and found
eighteen defects in the first hour — none of them in the engine, all of them in the part
where a human meets the thing. That is the part you can see and I cannot.

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

## If you record your screen

A recording is worth more than notes, because it catches the moments you would never
report — where you paused, re-read a question, or went looking for something that was
not there. If you can, record the whole first run.

**Two things to keep out of the video:**

- **Your API keys.** Put them in `.env` **before** you start recording, or pause while you
  paste. A key on video is a key that leaked.
- **Real people.** The leads in your spreadsheet are third parties who did not agree to
  be in a recording. Use two or three leads you are comfortable showing, or blur that
  part. Their names are not what we need to see — your face when the tool confuses you is.

Nothing else is sensitive: the interview answers, the briefing and the messages are all
yours, and seeing them is the whole point.

## How to send it

[Open an issue](https://github.com/nottgod/roger/issues/new/choose) — there is a form for
a bug and a form for "it did not sound like me", which is the one I care most about. If an
issue is more friction than it is worth, send it to Antonio directly. Rough notes are fine.
A voice message is fine.

**Please do not include:** your API keys, your `.env`, or the real name and message of a
lead who did not agree to appear in a bug report. Mask them (`Ana at <company>`), or
describe the shape of the problem instead of the content.

## Things I already know about

Not worth reporting, they are on the list:

- `rapport/contexts/example/` and `rapport/operators/example/` ship with a made-up company
  and a made-up person. They are there so you can read the shape of the files before the
  interview writes yours. Delete them whenever you like.
- There is no CRM adapter other than Kommo yet. The spreadsheet path is the intended one
  for now.
- The code comments and the test names are in Portuguese, while everything written for
  you is in English. It is the author's first language showing through. Real, known, and
  it does not affect anything you run.
- Sending needs Playwright installed separately and a manual LinkedIn login. That is
  deliberate, not an oversight.
- The sending arm has never run against the real LinkedIn — only against a fake browser in
  the tests. If you get there first, that is not a known issue, that is news: open one.

Roger that.
