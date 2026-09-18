#!/usr/bin/env node
// draft.mjs — the bridge between what Roger knows and the model YOU pay for.
//
// Roger does not write the message. It decides whether the lead is worth writing to,
// researches what it can, and builds the briefing: diagnosis, culture, wording and the
// real facts. The writing is done by the model you already use — Claude, ChatGPT,
// whichever. This command hands you that briefing ready to paste, instruction first.
//
// Why no model is embedded here: it would cost you one more key, and it would pick the
// model for you. Yours is already paid for.
//
// usage:
//   npm run draft -- --lead '{"name":"Ana","company":"NorthPay","geo":"USA","role":"Head of Finance"}'
//   npm run draft -- --file leads.csv --n 2
//   npm run draft -- --file leads.csv --n 2 --stage FUP_2

import { buildGenerationBrief, renderBrief, CONTEXT, DEFAULT_OPERATOR } from './gen.mjs';
import { classify } from './score.mjs';
import { readLeadsFile } from './lib/leads-file.mjs';
import { loadConfig } from './lib/config.mjs';
import { loadVoice } from './lib/voice.mjs';

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const D = (s) => `\x1b[2m${s}\x1b[0m`;
const out = (s = '') => process.stdout.write(s + '\n');

// The instruction that goes in front of the briefing. Short on purpose: the briefing
// already says everything, and a long prompt makes the model write prompt, not message.
export function instruction(operator, stage) {
  return [
    `You are writing ONE outbound message as ${operator}, to be sent on LinkedIn.`,
    '',
    'Rules, in order of importance:',
    '1. Sound like the operator. The voice section below is not a style suggestion, it is',
    '   the constraint. Read the samples in the persona file it points at.',
    '2. Use ONLY the facts in "Real facts". A null field means unknown. Never invent a',
    '   number, a funding round, or a detail about the company.',
    '3. One open question. Not two.',
    '4. No greeting like "Hi/Hello/Dear" unless the voice says otherwise, no corporate',
    '   sign-off, no markdown, no em dashes unless the voice allows them.',
    `5. Respect the character target for stage ${stage}.`,
    '',
    'Output the message and nothing else. No preamble, no explanation, no options.',
  ].join('\n');
}

export function checkCommand(operator, stage) {
  return `printf '%s' "<paste the message here>" | node scripts/roger/lint-voz.mjs --stage ${stage} --operator ${operator}`;
}

function parseArgs(argv) {
  const flag = (name, dflt = null) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : dflt);
  return {
    leadJson: flag('--lead'),
    file: flag('--file'),
    n: Number(flag('--n', '1')),
    stage: flag('--stage', 'MENSAGEM_INICIAL'),
    operator: flag('--operator', process.env.ROGER_OPERATOR || DEFAULT_OPERATOR),
  };
}

// Resolves ONE lead: from --lead (JSON) or from row --n of --file.
export function resolveLead({ leadJson, file, n }, deps = {}) {
  const read = deps.readLeadsFile || readLeadsFile;
  if (leadJson) {
    try {
      return { lead: JSON.parse(leadJson), error: null };
    } catch (e) {
      return { lead: null, error: `--lead is not valid JSON: ${e.message}` };
    }
  }
  if (!file) return { lead: null, error: 'pass --lead <json>, or --file <leads.csv> --n <row>' };
  const r = read(file);
  if (r.errors.length) return { lead: null, error: r.errors.join(' · ') };
  const lead = r.leads[(n || 1) - 1];
  if (!lead) return { lead: null, error: `the file has ${r.leads.length} leads; there is no number ${n}` };
  return { lead, error: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { lead, error } = resolveLead(args);
  if (error) { console.error(error); process.exit(1); }

  const voz = loadVoice(args.operator);
  if (voz.source !== 'file') {
    console.error(`no voice on file for "${args.operator}". Run this first: npm run onboarding`);
    process.exit(1);
  }

  // Research: only if there is a key. Without one, Roger writes with what the spreadsheet
  // gave it, and says so — instead of pretending it did its homework.
  const { keys } = loadConfig();
  let intel = null;
  let pesquisou = false;
  if (keys.exaKey || keys.firecrawlKey || keys.fundableKey) {
    const { runIntel } = await import('./intel.mjs');
    intel = await runIntel(lead, keys);
    pesquisou = true;
  } else {
    const c = classify(lead);
    intel = {
      tier: c.tier, segment: lead.segment || null, angle: c.casoParecido, approach: c.abordagem,
      gap: { detected: c.gapSignals || [], needsJudgment: [], count: c.gap ?? 0 },
      timing: { detected: c.timingSignals || [], count: c.timing ?? 0 },
      sources: {}, raw: { website: lead.website || null, fundable: null, scraped: {}, painPoint: null },
      lead: { name: lead.name, company: lead.company },
    };
  }

  const brief = buildGenerationBrief({
    contact: { name: lead.name, role: lead.role, geo: lead.geo, linkedin: lead.linkedin },
    company: lead.company,
    stage: args.stage,
    mode: 'outbound',
    operator: args.operator,
    intel,
  });

  if (brief.go === false) {
    out(`${B('Not worth writing to this lead.')}`);
    out(`  ${brief.skipReason}`);
    out(D('\nThat is your icp.md deciding. If you disagree, the table is yours: edit it and run again.'));
    return;
  }

  out('');
  out(B('─'.repeat(72)));
  out(B(`  Paste everything below into your Claude or ChatGPT  ${D(`(context: ${CONTEXT} · voice: ${args.operator})`)}`));
  out(B('─'.repeat(72)));
  out('');
  out(instruction(args.operator, args.stage));
  out('');
  out(renderBrief(brief));
  out('');
  out(B('─'.repeat(72)));
  out(B('  End of what you paste.'));
  out('');
  if (!pesquisou) {
    out(`${D('No research key: this briefing has only what your file gave it. With EXA_KEY and')}`);
    out(`${D('FIRECRAWL_KEY in .env, it would read what the company published and the hook gets better.')}`);
    out('');
  }
  out('Once your model writes it, run the message through your voice guard:');
  out(`  ${D(checkCommand(args.operator, args.stage))}`);
  out('');
  out(D('Passed? Collect the approved ones and open the panel. Sending is the last step, and it is yours.'));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
