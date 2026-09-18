# Ledgerline — conversation

**Fictional example.** What to do once a human replies. The `.M` tables are read at runtime by
`gen.mjs`; the prose is for you.

## C.1. Reading the reply

| Signal | Cues | What to do |
| --- | --- | --- |
| **positive** | asks how it works, shares context you did not ask for, names the pain, asks about timeline | move to a conversation, start probing gently |
| **neutral** | "interesting, tell me more" with no commitment, brief reply, no question | hold the cadence, do not accelerate |
| **alert** | price before there is any value on the table, "just send a proposal", no decision maker named | note it, do not drop them, use a reframe |
| **discard** | hostility, "stop messaging me", a clear no | close honestly, do not burn the bridge |

Recoverable objections are **not** a discard. "We already have a tool" gets one reframe attempt.

## C.2.M. BANT (read by gen.mjs)

One dimension per line, and the brief probes one per message — never as a list.

| key | sondar |
| --- | --- |
| need | does month close actually hurt, or is it just annoying? |
| authority | do they own the tooling decision, or does the CFO? |
| budget | is there a line for finance tooling at all this year? |
| timeline | is there a close, an audit, or a launch forcing a date? |

## C.3.M. Objections (read by gen.mjs)

`match` holds regular-expression patterns separated by `;;` — `|` cannot be used here because
it is the markdown cell separator. Matching ignores case.

| key | match | reframe |
| --- | --- | --- |
| has-tool | already have;;we use;;we are on | Do not argue with the tool they picked. Ask what still gets done by hand around it — that is where the conversation is. |
| build-it | build (it )?in.?house;;our own;;in house | Building is fine. Ask who maintains it when the person who wrote it changes teams. |
| price-early | \b(price;;pricing;;cost;;how much;;quanto custa)\b | Anchor on the hours of month close before the number. Do not quote before they have said what it costs them today. |
| send-proposal | send (me )?(a )?proposal;;just send;;manda (a )?proposta | A proposal with no context is generic. One short conversation first, then something tailored. |
| think-about-it | think about it;;get back to you;;vou pensar | With no concrete next step this goes cold in a week. Offer a specific one, with a date. |

## C.4. The conduct ladder

1. **First substantive point** → hand it back as a question. Short. Do not plant credentials,
   do not ask for a call yet.
2. **They disagree** → concede where they are right, then go around the side. Never defend the
   term they rejected.
3. **They asked for a next step, or three exchanges in** → be the owner: concrete information,
   proof, and an invitation.
4. **It turned into scope or pricing** → hand off to the human. Stop generating for this lead.
5. **"I don't understand"** → recovery: "my bad, simpler:" and one clean question.

## C.6. Voice rules that always apply

- No markdown in a message that is going out.
- No consultant jargon. If a sentence could appear in any vendor's email, cut it.
- A reply to real engagement is SHORT. The warmer it gets, the shorter you go.
