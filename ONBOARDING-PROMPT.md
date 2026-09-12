# Onboarding prompt

Paste everything below into Claude Code (or ChatGPT with access to your terminal) from the
folder where you cloned Roger. It does the same trail as [SETUP.md](SETUP.md), asking you
one thing at a time instead of making you read.

---

```
You are helping me set up Roger, an open source AI SDR that writes outbound in my own
voice. I may not be a programmer. Be brief, ask one thing at a time, and never dump a
wall of text at me.

Ground rules you must follow:

1. Never print, echo or paste any API key, token or secret. Not even partially. If you
   need me to add one, tell me which line of .env to fill and let me do it myself.
2. Never send a message to anyone. Never mark anything as sent. Your job stops at
   "everything is ready" — pressing send is mine.
3. Do not write to my CRM during setup. Read-only is fine.
4. Before anything that costs money, tell me what it will cost and wait for my yes.
5. If a command fails, show me the actual error. Do not guess around it.

Now do this, in order, stopping whenever you need an answer from me:

1. Check my Node version is 22 or newer. If not, tell me how to fix it and stop.
2. Run `npm test` and tell me the pass/fail count in one line.
3. Run `npm run doctor` and translate the output into plain language: what is ready and
   what is missing. Do not show me the raw output.
4. Interview me for my voice. Run `npm run onboarding` and let me answer its questions
   directly — do not answer on my behalf, and do not invent my samples or my story. When
   it is done, ask whether to re-run with `--write` to save the files.
5. Once saved, tell me the two `export` lines I need (ROGER_OPERATOR and ROGER_CONTEXT)
   and offer to add them to my shell profile.
6. Ask where my leads live: a spreadsheet or a Kommo CRM. For a spreadsheet, show me the
   expected columns and check my file against them, reporting bad rows without fixing
   them silently. For Kommo, tell me which three values to put in .env — including my own
   user id, without which Roger refuses to touch the CRM — and then run the doctor again.
7. Ask if I want the optional research keys (Exa, Firecrawl). Say plainly that they cost
   money per lookup and that Roger works without them, with less context.
8. Read `rapport/operators/<me>/persona.md` back to me and ask one question: does this
   sound like you? If I say no, ask what is off and help me edit the file. This step
   matters more than all the others.
9. Explain in three sentences what happens next: I generate drafts, I read and approve
   them in the panel, and only then does anything go out. Mention that sending needs
   Playwright installed and me logging into LinkedIn by hand once.
10. Do NOT set up sending today. Tell me to come back for that when I have read a few
    drafts and trust them.

Finish with a short list: what is working, what is still missing, and the single next
command I should run.
```

---

If the assistant tries to send something, invent your writing samples, or print a key,
stop it. Those three are the whole point of the rules above.

Roger that.
