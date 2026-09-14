#!/usr/bin/env node
// onboarding.mjs — o primeiro contato da Roger (as sete telas do design de 11/09).
//
//   1. Quem eu sou        2. Como isto vai funcionar     3. Sua voz
//   4. Seu mercado        5. De onde vêm os leads        6. Pesquisa
//   7. O envio
//
// A tela 3 é a mais importante: a resposta da entrevista não vira só prosa na persona,
// ela CONFIGURA a trava de voz (toVoiceConfig → voice.json, lido por lint-voz.mjs).
// A tela 4 faz o mesmo com o ICP: as respostas viram as tabelas `.M` do icp.md que o
// score.mjs parseia. Nada de gosto de ninguém volta para dentro do código.
//
// Gravar em disco é sempre decisão de quem responde: a versão interativa PERGUNTA no
// fim, e os modos não interativos só gravam com --write. Zero dependências (só node:*).
//
// uso:
//   node onboarding.mjs            a entrevista interativa (pergunta se quer salvar no fim)
//   node onboarding.mjs --write    salva sem perguntar
//   node onboarding.mjs --demo     percorre tudo com respostas de exemplo, sem gravar
//   node onboarding.mjs --intro    só a tela 1

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

// ── Tela 1 ────────────────────────────────────────────────────────────────────
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

// ── Tela 2 ────────────────────────────────────────────────────────────────────
const HOW = `
${B('How this goes')}

  ${B('1. Your voice')}     ~25 min   I interview you. Nothing else works without this.
  ${B('2. Your market')}    ~20 min   Who is worth a message, and who is a pass.
  ${B('3. Your leads')}     ~10 min   A spreadsheet, or your CRM.
  ${B('4. Your research')}   ~5 min   Two optional keys. They cost money, so they are yours to choose.
  ${B('5. Your first one')}  ~5 min   A real lead, a real message, in your voice.

${D('Nothing is paid for and nothing is written to your CRM until all of it is done.')}
`;

// ── Tela 3: a entrevista de voz ───────────────────────────────────────────────
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
    q: 'And the register?',
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

const FREE = [
  { key: 'greeting', q: 'Type your real opening line, exactly as you write it (e.g. "Hey Ana,")' },
  { key: 'signoff', q: 'And how you sign off' },
  { key: 'banned', q: 'Words you would never say. Comma-separated' },
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

// ── Tela 4: o mercado (vira as tabelas .M do icp.md) ──────────────────────────
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
  { key: 'nonIcp', q: 'Automatic passes — what makes you drop a lead on sight? Comma-separated' },
];

// ── Tela 5: de onde vêm os leads ──────────────────────────────────────────────
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

// ── Tela 7: o envio ───────────────────────────────────────────────────────────
const SEND = `
${B('The send.')}

I draft, you read, and then a browser I drive types it and sends it. You log into
LinkedIn by hand once, in a window I open, and that session stays yours alone.

  ${B('Approval is the default.')}  You see the batch, you fix what is off, you approve.
  Nothing leaves before that. There is an --auto flag and it is yours to never use.

  ${B('The rhythm is not negotiable.')}  A random pause between messages, a daily cap per
  account, one touch per lead per day. Speed is not permission to send more.

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
  slug: 'sam',
  contextName: 'ledgerline',
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

// ── Da entrevista para a configuração da trava de voz ─────────────────────────
export function toVoiceConfig(a) {
  const maxChars = { short: 420, medium: 600, long: 900 }[a.length] ?? 600;
  return {
    language: a.language,
    maxChars,
    // O ponto do design: a resposta da pessoa liga e desliga regra.
    allowHumanSlip: a.grammar !== 'impeccable',
    requireCleanGrammar: a.grammar === 'impeccable',
    banEmDash: a.emDash === 'never',
    banEmoji: a.emoji === 'never',
    banExclamation: a.exclamation === 'never',
    banConsultantJargon: a.register !== 'formal',
    banFormalGreeting: false,
    banVanityMetrics: false,
    caps: { default: maxChars, connection: 300 },
    maxQuestions: 1,
    ctaStyle: a.cta,
    greeting: a.greeting,
    signoff: a.signoff,
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
- Grammar: ${label[a.grammar] ?? a.grammar}
- Register: ${a.register}
- First message: ${a.length}, up to ${cfg.maxChars} characters
- Opens with: ${a.greeting}
- Signs off: ${a.signoff}
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

// ── Da entrevista para as tabelas .M do icp.md ────────────────────────────────
function splitList(s) {
  return String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
}

const slugify = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Sinais genéricos, para a pessoa ter um ponto de partida que já funciona.
// Ela edita depois: são as duas listas que mais mudam de negócio para negócio.
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

// ── Condução ──────────────────────────────────────────────────────────────────
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
  for (const axis of AXES) a[axis.key] = await askChoice(rl, axis);
  await askFree(rl, FREE, a);
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

// ── Telas de saída ────────────────────────────────────────────────────────────
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

  // Salvar. A versão interativa PERGUNTA no fim, porque exigir a flag de antemão
  // significava refazer 25 minutos de entrevista para quem não sabia dela.
  let salvar = args.includes('--write');
  if (!salvar && !args.includes('--demo') && process.stdin.isTTY) {
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const resp = (await rl2.question(`\n${B('Save these to disk?')} ${D('[Y/n] ')}`)).trim().toLowerCase();
      salvar = resp === '' || resp === 'y' || resp === 'yes' || resp === 's' || resp === 'sim';
      if (!salvar) out(D('Nothing written. Run again with --write when you are ready.'));
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

    const written = [
      `rapport/operators/${answers.slug}/persona.md`,
      `rapport/operators/${answers.slug}/voice.json`,
      `rapport/contexts/${ctxName}/icp.md`,
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
