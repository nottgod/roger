#!/usr/bin/env node
// draft.mjs — a ponte entre o que a Roger sabe e o modelo que VOCÊ paga.
//
// A Roger não escreve a mensagem. Ela decide se o lead vale, pesquisa o que dá para
// pesquisar, e monta o briefing: diagnóstico, cultura, redação e os fatos reais. Quem
// escreve é o modelo que você já usa — Claude, ChatGPT, o que for. Este comando entrega
// o briefing pronto para colar lá, com a instrução na frente.
//
// Por que não embutir um modelo aqui: seria cobrar de você uma chave a mais, e escolher
// por você qual modelo usar. O seu já está pago.
//
// uso:
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

// A instrução que vai na frente do briefing. Curta de propósito: o briefing já diz tudo,
// e prompt longo faz o modelo escrever prompt, não mensagem.
export function instruction(operator, stage) {
  return [
    `You are writing ONE outbound message as ${operator}, to be sent on LinkedIn.`,
    '',
    'Rules, in order of importance:',
    '1. Sound like the operator. The voice section below is not a style suggestion, it is',
    '   the constraint. Read the samples in the persona file it points at.',
    '2. Use ONLY the facts in "Fatos reais". A null field means unknown. Never invent a',
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

// Resolve UM lead: do --lead (JSON) ou da linha --n do --file.
export function resolveLead({ leadJson, file, n }, deps = {}) {
  const read = deps.readLeadsFile || readLeadsFile;
  if (leadJson) {
    try {
      return { lead: JSON.parse(leadJson), error: null };
    } catch (e) {
      return { lead: null, error: `--lead não é JSON válido: ${e.message}` };
    }
  }
  if (!file) return { lead: null, error: 'informe --lead <json> ou --file <planilha.csv> --n <linha>' };
  const r = read(file);
  if (r.errors.length) return { lead: null, error: r.errors.join(' · ') };
  const lead = r.leads[(n || 1) - 1];
  if (!lead) return { lead: null, error: `a planilha tem ${r.leads.length} leads; não existe o de número ${n}` };
  return { lead, error: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { lead, error } = resolveLead(args);
  if (error) { console.error(error); process.exit(1); }

  const voz = loadVoice(args.operator);
  if (voz.source !== 'file') {
    console.error(`sem voz declarada para "${args.operator}". Rode primeiro: npm run onboarding`);
    process.exit(1);
  }

  // Pesquisa: só se houver chave. Sem chave a Roger escreve com o que a planilha trouxe,
  // e diz isso — em vez de fingir que fez o dever de casa.
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
    out(`${B('Não vale escrever para este lead.')}`);
    out(`  ${brief.skipReason}`);
    out(D('\nIsto é o ICP do seu icp.md decidindo. Se discorda, a tabela é sua: edite e rode de novo.'));
    return;
  }

  out('');
  out(B('─'.repeat(72)));
  out(B(`  Cole tudo abaixo no seu Claude ou ChatGPT  ${D(`(contexto: ${CONTEXT} · voz: ${args.operator})`)}`));
  out(B('─'.repeat(72)));
  out('');
  out(instruction(args.operator, args.stage));
  out('');
  out(renderBrief(brief));
  out('');
  out(B('─'.repeat(72)));
  out(B('  Fim do que se cola.'));
  out('');
  if (!pesquisou) {
    out(`${D('Sem chave de pesquisa: o briefing tem só o que veio da sua planilha. Com EXA_KEY e')}`);
    out(`${D('FIRECRAWL_KEY no .env, ele traria o que a empresa publicou e o gancho sai melhor.')}`);
    out('');
  }
  out('Depois que o modelo escrever, passe a mensagem pela sua trava de voz:');
  out(`  ${D(checkCommand(args.operator, args.stage))}`);
  out('');
  out(D('Passou? Junte as aprovadas num batch e abra o painel. O envio é o último passo, e é seu.'));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
