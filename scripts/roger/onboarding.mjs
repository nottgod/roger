#!/usr/bin/env node
// onboarding.mjs — the first contact with Roger (the seven screens).
//
//   1. Who I am           2. How this will work          3. Your voice
//   4. Your market        5. Where the leads come from   6. Research
//   7. Sending
//
// Screen 3 is the most important: the interview answer does not just become prose in the
// persona, it CONFIGURES the voice guard (toVoiceConfig → voice.json, read by lint-voz.mjs).
// Screen 4 does the same for the ICP: the answers become the `.M` tables of icp.md that
// score.mjs parses. Nobody's taste ever goes back into the code.
//
// Writing to disk is always the answerer's call: the interactive version ASKS at the end,
// and the non-interactive modes only write with --write. Zero dependencies (node:* only).
//
// usage:
//   node onboarding.mjs            the interactive interview (asks before saving)
//   node onboarding.mjs --write    saves without asking
//   node onboarding.mjs --demo     walks through it all with example answers, saving nothing
//   node onboarding.mjs --intro    screen 1 only

import { createInterface } from 'node:readline/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEY_SPECS } from './lib/config.mjs';
import { TEMPLATE_CSV } from './lib/leads-file.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;
const out = (s = '') => process.stdout.write(s + '\n');
const rule = () => out(D('─'.repeat(72)));

// ── Screen 1 ──────────────────────────────────────────────────────────────────
const INTRO = `
${B("I'm Roger.")}

A salesperson who couldn't code wrote me between calls, because the tools he
could buy all sounded like nobody. I'm not a product and nobody is selling me.
I'm the structure — the part that was never the hard part.

The hard part is your voice, your context and your judgment. Those aren't mine
to give you. So the next hour is me learning yours.

When we're done you'll have a message written the way you'd write it, to a lead
worth writing to, and you'll be the one who sends it.

${B('Build one better than me. That\'s the point.')}

${B('Roger that.')}
`;

// ── Screen 2 ──────────────────────────────────────────────────────────────────
// Not just "what comes next": this is the MODEL OF USE. Someone who does not grasp that
// the files are theirs, and that they feed them over time, uses it once and walks away.
const HOW = `
${B('How this works')}

I am not a form you fill in once. I am a handful of plain files that belong to you —
your voice, your market, your templates. This interview is just the fastest way to
write the first version of them.

${B('The loop, every day:')}

  1. you point me at a lead          ${D('a row in a spreadsheet, or your CRM')}
  2. I decide if it is worth writing ${D('your ICP tables, not mine')}
  3. I research what I can           ${D('needs your research keys')}
  4. I build the briefing            ${D('diagnosis, culture, wording, real facts')}
  5. ${B('your model writes it')}            ${D('Claude, ChatGPT, whichever you already pay for')}
  6. your voice guard checks it      ${D('the rules this interview is about to write')}
  7. you read it, fix it, approve it ${D('nothing goes out before this')}
  8. it gets sent                    ${D('a browser I drive, on your account')}

${B('Two things I do not provide, and will not:')}

  ${B('A Claude or a ChatGPT.')} Step 5 is yours. There is no model key in this repo and
  there will not be — yours is already paid for, and I am not going to make you buy a
  second one.

  ${B('Research keys')} (Exa, Firecrawl). Step 3 costs money, and the money is yours.
  Without them I write from whatever your spreadsheet has, and I tell you so instead of
  pretending I did the homework. The hook is what gets answered.

${B('And the part most people miss:')} I get better because ${B('you')} feed me. Every time a
message lands, or falls flat, you learn something about how you sell. Put it in the
files. Nobody else is editing them, which is why no two Rogers write alike.

${D('Today, the first version:')}

  ${B('1. Your voice')}     ~25 min   ${D('I interview you. Nothing works without this.')}
  ${B('2. Your market')}    ~20 min   ${D('Who is worth a message, and who is a pass.')}
  ${B('3. Your leads')}     ~10 min   ${D('A spreadsheet, or your CRM.')}
  ${B('4. Your stack')}      ~5 min   ${D('Where your model and your keys live.')}

${D('You can do the whole interview first and sort the keys out after. Nothing here needs them.')}
`;


// ── Screen 3: the voice interview ─────────────────────────────────────────────
const AXES = [
  {
    key: 'grammar',
    q: 'When you write to a lead, how correct is your grammar?',
    options: [
      ['impeccable', 'Always clean. Typos embarrass me.'],
      ['human', 'A little loose. A missing comma sounds more like me.'],
      ['mixed', 'Depends on who I am writing to.'],
    ],
  },
  {
    key: 'register',
    q: 'And how formal are you?',
    options: [
      ['oral', 'Like I talk. Contractions, short sentences.'],
      ['direct', 'Professional and direct, no small talk.'],
      ['formal', 'Formal. I am writing to senior people.'],
    ],
  },
  {
    key: 'length',
    q: 'How long is your first message, honestly?',
    options: [
      ['short', 'Three lines. They read it on the phone.'],
      ['medium', 'A short paragraph plus a question.'],
      ['long', 'It can breathe if I have something to say.'],
    ],
  },
  {
    key: 'emDash',
    q: 'Do you use em dashes (—)?',
    options: [['never', 'Never. It reads like a machine.'], ['yes', 'Yes, I write like that.']],
  },
  {
    key: 'emoji',
    q: 'Emoji in outreach?',
    options: [['never', 'No.'], ['yes', 'Sometimes, one.']],
  },
  {
    key: 'exclamation',
    q: 'Exclamation marks?',
    options: [['never', 'No.'], ['yes', 'Yes, that is how I sound.']],
  },
  {
    key: 'cta',
    q: 'How do you end a first message?',
    options: [
      ['question', 'A question they actually want to answer.'],
      ['invite', 'A direct invitation to talk.'],
    ],
  },
];

// The channel comes first because it changes the rest: in a DM almost nobody signs off, in
// an email almost everybody does, and the sending arm today only drives LinkedIn.
const CHANNEL = {
  key: 'channels',
  q: 'Where do you write to people?',
  options: [
    ['linkedin', 'LinkedIn, mostly.'],
    ['email', 'Email, mostly.'],
    ['both', 'Both, depending on the person.'],
  ],
};

// The sign-off question depends on the channel: on LinkedIn it hardly ever exists.
function freeQuestions(channels) {
  // A sign-off is the closing line with your name — "Best, Ana". It is NOT the last sentence
  // of the message: in the first real test someone wrote a whole closing sentence here, and
  // it became their "sign-off". That is why the question now shows what one is.
  const oQueE = 'A sign-off is the closing name line: "Best, Ana", "Sincerely, Ana",\n  "Cheers, Ana". It is not the last sentence of your message.';
  const assinatura = {
    linkedin: `${oQueE}\n  On LinkedIn almost nobody uses one. Do you? Press Enter for no, or paste yours`,
    email: `How do you sign off an email?\n  ${oQueE}\n  Paste yours, exactly as it goes out`,
    both: `How do you sign off on EMAIL?\n  ${oQueE}\n  On LinkedIn you probably do not, and that is fine.\n  Press Enter if you never sign`,
  }[channels] || `${oQueE}\n  Do you use one? Press Enter for no, or paste yours`;
  return FREE.map((f) => (f.key === 'signoff' ? { ...f, q: assinatura } : f));
}

const FREE = [
  {
    key: 'greeting',
    q: 'How do you open a message? Paste real openings, not a template.\n  More than one is better — separate them with a semicolon',
  },
  {
    key: 'signoff',
    q: 'Do you sign your messages? If you do, paste your sign-off.\n  Most people do not sign a DM — press Enter to skip',
  },
  {
    key: 'banned',
    q: 'Seller words you would never use. Not swearing — the vendor vocabulary that makes\n  a message sound like every other message. Examples: synergy, circle back, touch base,\n  leverage, at your earliest convenience. Comma-separated',
  },
  { key: 'language', q: 'What language do you sell in?' },
];

const SOUND = `
${B('Now the sound of your voice.')}

Paste 3 to 5 real things you wrote — LinkedIn messages, emails, posts. Real ones,
not what you think a good message looks like. Blank line when you are done.
`;

const SOUL = `
${B('And where that voice comes from.')}

Tell me how you ended up talking the way you talk. Where you grew up, what you
did before this, expressions that are yours, what makes you laugh. This is the
half that a questionnaire cannot reach — it is why your messages will not sound
like everyone else running the same tool.
`;

// ── Screen 4: the market (becomes the .M tables of icp.md) ────────────────────
const MARKET_INTRO = `
${B('Your market.')}

Now the other half of the judgment: who is worth a message. Your answers become a
file I read on every lead (${D('rapport/contexts/<you>/icp.md')}), so a bad fit gets
dropped before I waste your research budget on it. You can edit that file forever.
`;

const MARKET = [
  { key: 'contextName', q: 'A short name for what you sell, one word (e.g. acme). It becomes your context folder' },
  { key: 'whatYouSell', q: 'In one line, what do you sell and to whom?' },
  { key: 'geoAccept', q: 'Countries or regions worth selling to. Comma-separated' },
  { key: 'geoDiscard', q: 'Countries or regions you will not sell to. Comma-separated (blank if none)' },
  { key: 'sizeMin', q: 'Smallest company worth your time, in employees' },
  { key: 'sizeMax', q: 'And the largest (blank for no limit)' },
  { key: 'budgetFloor', q: 'Monthly budget below which it is not worth it, in USD (blank if you do not filter)' },
  { key: 'segments', q: 'The kinds of company you sell to, comma-separated (e.g. payments, marketplaces)' },
  {
    key: 'nonIcp',
    q: 'What makes you drop a lead without even looking?\n  The deal breakers. Examples: no budget, wrong country, too small, a competitor,\n  nobody there can decide. Comma-separated',
  },
  {
    key: 'dorCentral',
    q: 'In one line: what is broken for them BEFORE you show up?\n  Not what you sell, the pain. Example: "month close takes a week and nobody\n  trusts the number". Yours',
  },
  {
    key: 'vocab',
    q: 'Now the words your BUYERS use among themselves — the ones that prove you have been\n  in the room. An outsider would use the wrong one, or none at all.\n  If you sold to payments teams: settlement file, chargeback, payout window.\n  If you sold to crypto teams: TVL, restaking, tokenomics, DevRel.\n  Yours, comma-separated',
  },
];

// ── Screen 5: where the leads come from ───────────────────────────────────────
const LEADS_INTRO = `
${B('Where your leads come from.')}

Two ways, and the first one is not worse than the second.
`;

const LEADS_CHOICE = {
  key: 'leadSource',
  q: 'Which one is you?',
  options: [
    ['spreadsheet', 'A spreadsheet. I keep my list in Sheets, Notion, Airtable, or an export.'],
    ['crm', 'A CRM. Right now Roger speaks Kommo; other CRMs are a contract away.'],
  ],
};

const CRM_RULES = `
${B('Before I touch a CRM, three rules that are code, not promises:')}

  ${B('Your leads only.')}  You tell me your own user id, and I never read or write a
  record that belongs to a teammate. Without that id I refuse to run at all.

  ${B('I never move a deal stage and never mark anything lost.')}  A follow-up task and
  a note is all I write. Where a deal stands is your call, not a script's.

  ${B('The first run is read-only.')}  You watch me work before I am allowed to write.
`;

// ── Screen 7: sending ─────────────────────────────────────────────────────────
const SEND = `
${B('The send.')}

I draft, you read, and then a browser I drive types it and sends it. You log into
LinkedIn by hand once, in a window I open, and that session stays yours alone.

  ${B('Approval is the default.')}  You see the batch, you fix what is off, you approve.
  Nothing leaves before that. There is an --auto flag and it is yours to never use.

  ${B('The rhythm is not negotiable.')}  A random pause between messages, a daily cap per
  account, one touch per lead per day. Speed is not permission to send more.

  ${B('Today that browser drives LinkedIn.')}  If you sell by email too, everything up to
  the draft works the same — the sending part is still yours to do.

  ${B('I write down what I am about to do before I do it.')}  If the machine dies
  mid-send, the next run knows exactly what may have gone out.
`;

const DEMO = {
  grammar: 'human',
  register: 'oral',
  length: 'short',
  emDash: 'never',
  emoji: 'never',
  exclamation: 'never',
  cta: 'question',
  greeting: 'Hey Ana,',
  signoff: 'Best, Sam',
  banned: 'synergy, leverage, circle back, touch base',
  language: 'English',
  samples: ['saw you shipped the audit last week. how are you handling the reruns?'],
  story: 'Grew up in Naples, sold restaurant equipment before software. I talk fast.',
  channels: 'linkedin',
  slug: 'sam',
  contextName: 'ledgerline',
  dorCentral: 'Month close takes a week and nobody fully trusts the number',
  vocab: 'settlement file, chargeback, payout window, suspense account',
  whatYouSell: 'reconciliation software for fintech finance teams',
  geoAccept: 'United States, United Kingdom, Germany, Singapore',
  geoDiscard: 'Russia',
  sizeMin: '20',
  sizeMax: '400',
  budgetFloor: '1500',
  segments: 'payments, neobanks, marketplaces',
  nonIcp: 'crypto exchanges, consumer apps, agencies',
  leadSource: 'spreadsheet',
};

// ── From the interview to the voice guard configuration ───────────────────────
// How much fits in a message, per channel. A long DM is still short next to an email;
// treating both with the same cap had Roger allowing 900 characters on LinkedIn.
export const CAPS = {
  linkedin: { short: 300, medium: 450, long: 700, connection: 300 },
  email: { short: 600, medium: 900, long: 1400, connection: 300 },
  both: { short: 420, medium: 600, long: 900, connection: 300 },
};

export function toVoiceConfig(a) {
  const porCanal = CAPS[a.channels] || CAPS.linkedin;
  const maxChars = porCanal[a.length] ?? porCanal.medium;
  return {
    language: a.language,
    channels: a.channels || 'linkedin',
    maxChars,
    // The point of the design: the person's answer turns a rule on and off.
    allowHumanSlip: a.grammar !== 'impeccable',
    requireCleanGrammar: a.grammar === 'impeccable',
    banEmDash: a.emDash === 'never',
    banEmoji: a.emoji === 'never',
    banExclamation: a.exclamation === 'never',
    banConsultantJargon: a.register !== 'formal',
    banFormalGreeting: false,
    banVanityMetrics: false,
    caps: { default: maxChars, connection: porCanal.connection },
    maxQuestions: 1,
    ctaStyle: a.cta,
    greeting: splitSemi(a.greeting),
    signoff: ouNulo(a.signoff),
    bannedWords: splitList(a.banned),
    bannedPhrases: [],
    rules: voiceRulesFrom(a),
  };
}

function voiceRulesFrom(a) {
  const rules = [];
  rules.push({
    oral: 'oral, the way you talk. contractions, short sentences',
    direct: 'professional and direct, no small talk',
    formal: 'formal register, writing to senior people',
  }[a.register] || 'plain and direct');
  if (a.grammar === 'human') rules.push('one light human imperfection per message is fine, it sounds like you');
  if (a.grammar === 'impeccable') rules.push('clean grammar and punctuation, always');
  rules.push(a.cta === 'question' ? 'close with one open question worth answering' : 'close with a direct invitation to talk');
  rules.push('diagnostic tone: someone who noticed a detail, not a seller asking for time');
  return rules;
}

export function renderPersona(a, cfg) {
  const label = { impeccable: 'impeccable', human: 'human, a little loose', mixed: 'varies by reader' };
  return `# Operator — ${a.slug}

## Voice
- Writes on: ${{ linkedin: 'LinkedIn', email: 'email', both: 'LinkedIn and email' }[a.channels] || 'LinkedIn'}
- Grammar: ${label[a.grammar] ?? a.grammar}
- Tone: ${{
    oral: 'like you talk — contractions, short sentences',
    direct: 'professional and direct, no small talk',
    formal: 'formal, writing to senior people',
  }[a.register] || a.register}
- First message: ${a.length}, up to ${cfg.maxChars} characters
- Opens with: ${[].concat(cfg.greeting || '(not recorded)').join(' · ')}
${cfg.signoff ? `- Signs off: ${cfg.signoff}` : '- Does not sign messages'}
- Closes with: ${a.cta === 'question' ? 'a question worth answering' : 'a direct invitation'}
- Language: ${a.language}

## Never
${cfg.bannedWords.map((w) => `- ${w}`).join('\n') || '- (nothing declared)'}
${cfg.banEmDash ? '- em dashes\n' : ''}${cfg.banEmoji ? '- emoji\n' : ''}${cfg.banExclamation ? '- exclamation marks\n' : ''}
## How you actually write
${(a.samples || []).map((s) => `> ${s}`).join('\n\n') || '> (no samples yet)'}

## Where the voice comes from
${a.story || '(not recorded yet)'}
`;
}

// ── From the interview to the .M tables of icp.md ─────────────────────────────
function splitList(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// Openings: a person opens in several ways, and insisting on one loses information.
// One becomes a string; several become a list.
// A negative answer is a negative, not content. In the first real test someone answered
// "no" to the sign-off question and ended up with a sign-off that read "no".
const NEGATIVAS = new Set(['no', 'n', 'nao', 'não', 'nope', 'nenhuma', 'nenhum', 'none', '-', 'x']);
function ouNulo(s) {
  const v = String(s || '').trim();
  if (!v || NEGATIVAS.has(v.toLowerCase())) return null;
  return v;
}

function splitSemi(s) {
  const partes = String(s || '').split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
  if (!partes.length) return null;
  return partes.length === 1 ? partes[0] : partes;
}

const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Generic signals, so the person starts from something that already works.
// They edit them later: these are the two lists that change most from business to business.
const DEFAULT_TIMING = [
  ['recentFunding', 'Raised money in the last 12 months'],
  ['hiringForTheProblem', 'Hiring for the problem you solve'],
  ['newLaunch', 'Launched or is about to launch something'],
  ['pressCoverage', 'Got press or a big partnership recently'],
];

const DEFAULT_GAP = [
  ['noRecentActivity', 'Quiet in public for months'],
  ['genericMessaging', 'Messaging says nothing specific'],
  ['founderInvisible', 'Founder is invisible in the market'],
  ['inconsistentStory', 'Site and founder tell different stories'],
];

// The diagnosis: the pain every message opens with, and the vocabulary that sounds like an insider.
// Without this file the briefing opens with "core pain not declared", which reads as a bug.
// The templates. The briefing points at this file, so it has to exist — and with her own
// sentence inside it, not another company's.
export function renderTemplates(a) {
  const oQueVende = String(a.whatYouSell || '').trim() || '{what you do, in one sentence}';
  return `# ${a.contextName || 'your context'} — message templates

The engine reads the **first block quote** under each heading, so keep that shape.
These are skeletons. \`{Nome}\` becomes the lead's first name; anything else in braces is
a note to you, and the voice guard blocks it if it ever reaches a real message.

## M1 — handshake (campaign only, no pitch)

> Great to connect, {Nome}! I'll write to you shortly with some context on why I reached out.

## M2 — the pitch, same thread

> {Nome}, as promised, some context. ${oQueVende}. Worth a quick call this week?

## M2-direto — first touch, no campaign

> {Nome}, {one specific line about them}. ${oQueVende}. Open to a quick call this week?

## Notes

- One question per message. Two means neither gets answered.
- The hook has to prove you looked. No hook, no message.
- Never invent a number about them.
`;
}

export function renderDiagnosis(a) {
  const segments = splitList(a.segments);
  const vocab = String(a.vocab || '').trim() || '(not declared yet — the words an insider would use)';
  const dor = String(a.dorCentral || '').trim()
    || '(not declared yet — one line on what is broken for them before you show up)';
  const linhas = (segments.length ? segments : ['default']).map(
    (s) => `| **${s}** | ${dor} | ${vocab} |`,
  ).join('\n');

  return `# ${a.contextName || 'your context'} — diagnosis

The pain you fix, and the words that make you sound like an insider. Read at runtime by
the generator: the \`3.9.M\` table opens the diagnosis of every message, and \`3.12\` gives
the vocabulary for the segment.

## 3.9.M. The central pain (read by gen.mjs)

One line, no \`|\`.

| key | value |
| --- | --- |
| dor_central | ${dor} |

## 3.12. Vocabulary and narrative by segment

Start with one row per segment, all sharing what you told the interview. **Refine them
one at a time** — the narrative column is where the message stops sounding generic.

| Segment | Key narrative (one line) | Vocabulary that sounds like an insider |
| --- | --- | --- |
${linhas}
`;
}

export function renderIcp(a) {
  const accept = splitList(a.geoAccept);
  const discard = splitList(a.geoDiscard);
  const segments = splitList(a.segments);
  const nonIcp = splitList(a.nonIcp);
  const sizeMin = String(a.sizeMin || '').trim() || '1';
  const sizeMax = String(a.sizeMax || '').trim() || '100000';
  const budget = String(a.budgetFloor || '').trim() || '0';

  const geoRows = [
    ...accept.map((g) => `| ${slugify(g)} | accept | ${g.toLowerCase()} |`),
    ...discard.map((g) => `| ${slugify(g)} | discard | ${g.toLowerCase()} |`),
  ].join('\n') || '| anywhere | accept | anywhere |';

  const segRows = segments.map((s) => `| ${slugify(s)} | ${s} | Contextual |`).join('\n')
    || '| default | your customers | Contextual |';

  const nonIcpRows = nonIcp.map((s) => `| ${slugify(s)} | ${s} |`).join('\n')
    || '| no-decision-maker | Nobody reachable who can decide |';

  return `# ${a.contextName || 'your context'} — ICP

${a.whatYouSell ? `**What you sell:** ${a.whatYouSell}\n` : ''}
> **This file is read at runtime.** The sections marked \`.M\` are tables the scoring
> reads to decide who is worth a message. Edit a table and the behaviour changes — no
> code involved. Prose outside those tables is for you, not for the machine.
>
> Written by the voice interview on ${new Date().toISOString().slice(0, 10)}. It is a
> starting point: the two signal tables at the bottom are the ones worth editing first.

## 3.2.M. Numbers

| key | value |
| --- | --- |
| headcount_min | ${sizeMin} |
| headcount_max | ${sizeMax} |
| budget_floor_usd_month | ${budget} |
| gap_material_min | 2 |
| timing_forte_min | 1 |

## 3.3.M. Segment, cluster and approach

The cluster is the label of the "similar customer" a message can name. Keep the real
customer names in \`cases.md\`, not here.

| slug | cluster | approach |
| --- | --- | --- |
${segRows}

## 3.4.M. Geography

\`decision\` is \`accept\` or \`discard\`. \`aliases\` lets the same place match however it
shows up in your data.

| slug | decision | aliases |
| --- | --- | --- |
${geoRows}

## 3.6.M. Not your market

The \`slug\` is what arrives in \`lead.nonIcpFlags\`. Anything listed here is dropped on sight.

| slug | label |
| --- | --- |
${nonIcpRows}

## 3.7.M. Timing signals

Reasons this is a good week to write. \`timing_forte_min\` above says how many make the
timing strong.

| key | label |
| --- | --- |
${DEFAULT_TIMING.map(([k, l]) => `| ${k} | ${l} |`).join('\n')}

## 3.11.M. Gap signals

What is missing in the lead that you fix. \`gap_material_min\` says how many make the gap
material. **Edit this table first** — it is the most specific thing about your offer.

| key | label |
| --- | --- |
${DEFAULT_GAP.map(([k, l]) => `| ${k} | ${l} |`).join('\n')}
`;
}

// ── Flow ──────────────────────────────────────────────────────────────────────
async function askChoice(rl, axis) {
  out(`\n${B(axis.q)}`);
  axis.options.forEach(([, text], i) => out(`  ${i + 1}. ${text}`));
  for (;;) {
    const raw = (await rl.question(D('  > '))).trim();
    const i = Number(raw) - 1;
    if (axis.options[i]) return axis.options[i][0];
    out(D('  pick a number.'));
  }
}

async function askLines(rl) {
  const lines = [];
  for (;;) {
    const line = (await rl.question(D('  > '))).trim();
    if (!line) return lines;
    lines.push(line);
  }
}

async function askFree(rl, items, a) {
  for (const f of items) {
    out(`\n${B(f.q)}`);
    a[f.key] = (await rl.question(D('  > '))).trim();
  }
}

async function interview(rl) {
  const a = {};

  // tela 3
  a.channels = await askChoice(rl, CHANNEL);
  for (const axis of AXES) a[axis.key] = await askChoice(rl, axis);
  await askFree(rl, freeQuestions(a.channels), a);
  out(SOUND);
  a.samples = await askLines(rl);
  out(SOUL);
  a.story = (await rl.question(D('  > '))).trim();
  out(`\n${B('Last thing on your voice: a short name for your operator folder (e.g. sam)')}`);
  a.slug = slugify(await rl.question(D('  > '))) || 'me';

  // tela 4
  out(MARKET_INTRO);
  await askFree(rl, MARKET, a);
  a.contextName = slugify(a.contextName) || 'my-context';

  // tela 5
  out(LEADS_INTRO);
  a.leadSource = await askChoice(rl, LEADS_CHOICE);

  return a;
}

// ── Closing screens ───────────────────────────────────────────────────────────
function showVoice(a, cfg) {
  rule();
  out(B('This is what I heard.'));
  out(`\n${D(`rapport/operators/${a.slug}/persona.md`)}\n`);
  out(renderPersona(a, cfg));
  out(`${D('the voice guard your answers just configured')}\n`);
  out(JSON.stringify(cfg, null, 2));
  out(`\n${B('You got it right if:')} you read the block above and it sounds like you.`);
}

function showMarket(a) {
  out('');
  rule();
  out(B('And this is your market, as a file I can read.'));
  out(`\n${D(`rapport/contexts/${a.contextName}/icp.md`)}\n`);
  out(renderIcp(a));
  out(`${B('You got it right if:')} a lead you would never write to gets dropped by one of those tables.`);
}

function showLeads(a) {
  out('');
  rule();
  if (a.leadSource === 'crm') {
    out(CRM_RULES);
    out(D('Put these in .env (never in a file you commit):'));
    for (const spec of KEY_SPECS.filter((s) => s.group === 'crm')) {
      out(`  ${B(spec.name)}  ${D(spec.where)}`);
    }
    out(`\n${D('Then: npm run doctor')}`);
  } else {
    out(B('A spreadsheet it is.'));
    out(`
I read CSV with the columns you already have, in English or Portuguese: name and
nome, company and empresa, country and país. Anything I do not recognise I keep
anyway. A bad row becomes a warning, not a dead run.

${D('leads-template.csv')}
`);
    out(TEMPLATE_CSV);
    out(D('Fill it, keep it out of git, and point Roger at it.'));
  }
}

function showResearch() {
  out('');
  rule();
  out(B('Research. Optional, and it costs money, so it is yours to choose.'));
  out('');
  for (const spec of KEY_SPECS.filter((s) => s.group === 'research')) {
    out(`  ${B(spec.name)} ${D(`(${spec.cost})`)}`);
    out(`    ${spec.what}`);
    out(`    ${D(spec.where)}`);
  }
  out(`
${D('Without them I still write, and I tell you I wrote with less context instead of')}
${D('pretending I did the homework. Every run records what it spent in .roger/costs.jsonl.')}`);
}

function showSend() {
  out('');
  rule();
  out(SEND);
}

function showClose(a) {
  rule();
  out(`
${B('That is the setup.')} What comes next, in order:

  1. ${B('npm run doctor')}            ${D('tells you what is still missing')}
  2. ${B('research a lead')}           ${D('one real company from your list')}
  3. ${B('read the draft, fix it')}    ${D('it is yours, not mine')}
  4. ${B('send it yourself')}          ${D('that part never becomes automatic by accident')}

Your voice lives in ${D(`rapport/operators/${a.slug}/`)} and your market in ${D(`rapport/contexts/${a.contextName || 'my-context'}/`)}.
Both are plain files. Change them whenever you learn something about how you sell.

${D('Read yours back (there is also an example operator in that folder — this is the one that is yours):')}
  ${B(`cat rapport/operators/${a.slug}/persona.md`)}

${B('Roger that.')}
`);
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  out(INTRO);
  if (args.includes('--intro')) return;
  out(HOW);

  let answers;
  if (args.includes('--demo')) {
    out(D('(demo mode: canned answers, nothing is asked)'));
    answers = DEMO;
  } else if (!process.stdin.isTTY) {
    out(D('No terminal attached. Run with --demo to see the whole flow.'));
    return;
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      answers = await interview(rl);
    } finally {
      rl.close();
    }
  }

  const cfg = toVoiceConfig(answers);
  showVoice(answers, cfg);
  showMarket(answers);
  showLeads(answers);
  showResearch();
  showSend();
  showClose(answers);

  // Saving. The interactive version ASKS at the end, because requiring the flag up front
  // meant redoing 25 minutes of interview for anyone who did not know about it.
  let salvar = args.includes('--write');
  if (!salvar && !args.includes('--demo') && process.stdin.isTTY) {
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    try {
      // Keep asking until it is understood. An unrecognised answer can NEVER mean "discard":
      // in the first real test, anyone who answered something else lost 25 minutes of interview.
      const SIM = ['yes', 'y', 'sim', 's', ''];
      const NAO = ['no', 'n', 'nao', 'não'];
      for (;;) {
        const resp = (await rl2.question(`\n${B('Save all of this?')} ${D('type yes or no (Enter = yes): ')}`)).trim().toLowerCase();
        if (SIM.includes(resp)) { salvar = true; break; }
        if (NAO.includes(resp)) { salvar = false; break; }
        out(D(`  I did not understand "${resp}". Type yes or no.`));
      }
      if (!salvar) {
        out('');
        out(`${B('Nothing was written, and these answers are gone.')}`);
        out(D('To keep them next time, run: npm run onboarding -- --write'));
      }
    } finally {
      rl2.close();
    }
  }

  if (salvar) {
    const opDir = join(ROOT, 'rapport', 'operators', answers.slug);
    await mkdir(opDir, { recursive: true });
    await writeFile(join(opDir, 'persona.md'), renderPersona(answers, cfg));
    await writeFile(join(opDir, 'voice.json'), JSON.stringify(cfg, null, 2) + '\n');

    const ctxName = answers.contextName || 'my-context';
    const ctxDir = join(ROOT, 'rapport', 'contexts', ctxName);
    await mkdir(ctxDir, { recursive: true });
    await writeFile(join(ctxDir, 'icp.md'), renderIcp(answers));
    await writeFile(join(ctxDir, 'diagnosis.md'), renderDiagnosis(answers));
    await writeFile(join(ctxDir, 'mensagens.md'), renderTemplates(answers));

    const written = [
      `rapport/operators/${answers.slug}/persona.md`,
      `rapport/operators/${answers.slug}/voice.json`,
      `rapport/contexts/${ctxName}/icp.md`,
      `rapport/contexts/${ctxName}/diagnosis.md`,
      `rapport/contexts/${ctxName}/mensagens.md`,
    ];

    if (answers.leadSource !== 'crm') {
      await writeFile(join(ROOT, 'leads-template.csv'), TEMPLATE_CSV);
      written.push('leads-template.csv');
    }

    out(`${B('Written:')}`);
    for (const f of written) out(`  ${f}`);
    out(`\n${D('Point Roger at them:')}`);
    out(`  export ROGER_OPERATOR=${answers.slug}`);
    out(`  export ROGER_CONTEXT=${ctxName}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
