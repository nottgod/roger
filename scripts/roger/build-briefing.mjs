#!/usr/bin/env node
// Gera o BRIEFING ÚNICO de coleta pro Cowork (Claude App) a partir das tasks do dia.
// É a COLAGEM 1 do fluxo: você cola o arquivo inteiro de uma vez,
// e o Cowork devolve um dump único (COLAGEM 2) no formato pedido no fim do briefing.
//
// Uso: node build-briefing.mjs            → escreve briefing-cowork-YYYY-MM-DD.md na raiz
//      node build-briefing.mjs --limit 15 → só os primeiros 15 leads

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  kget, USER_ID, TASK_TYPE, TASK_TYPE_NAME, CF_CONTACT, CF_LEAD, STATUS, cfValue, cfValues,
} from './kommo-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

// mesma janela da skill: hoje (seg-qui) ou próxima segunda (sex-dom)
function endOfDayBRT(date) {
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 2, 59, 59) / 1000);
}
function nextCutoffBRT() {
  const brtNow = new Date(Date.now() - 3 * 3600 * 1000);
  const dow = brtNow.getUTCDay();
  let target = new Date(brtNow);
  if (dow === 0) target.setUTCDate(brtNow.getUTCDate() + 1);
  else if (dow === 5) target.setUTCDate(brtNow.getUTCDate() + 3);
  else if (dow === 6) target.setUTCDate(brtNow.getUTCDate() + 2);
  return endOfDayBRT(target);
}

const MSG_TYPES = new Set([
  TASK_TYPE.GENERIC, TASK_TYPE.MENSAGEM_INICIAL,
  TASK_TYPE.FUP_1, TASK_TYPE.FUP_2, TASK_TYPE.FUP_3, TASK_TYPE.FUP_4, TASK_TYPE.FUP_5, TASK_TYPE.FUP_MAIS,
]);

const todayEnd = nextCutoffBRT();
let tasks = [], page = 1;
while (true) {
  const d = await kget(`/tasks?filter[responsible_user_id]=${USER_ID}&filter[is_completed]=0&filter[complete_till][to]=${todayEnd}&limit=250&page=${page}`);
  const batch = d?._embedded?.tasks || [];
  tasks = tasks.concat(batch);
  if (batch.length < 250) break;
  page++;
}

// visibilidade total: contar por tipo, inclusive os que não entram no briefing
const byType = {};
for (const t of tasks) {
  const name = TASK_TYPE_NAME[t.task_type_id] || `tipo_${t.task_type_id}`;
  byType[name] = (byType[name] || 0) + 1;
}

const msgTasks = tasks.filter(t => MSG_TYPES.has(t.task_type_id) && t.entity_type === 'leads');

const blocks = [];
let included = 0;
for (const task of msgTasks) {
  if (included >= LIMIT) break;
  const lead = await kget(`/leads/${task.entity_id}?with=contacts`);
  if (!lead || lead.name?.includes('[CONSENSUS]')) continue;
  if (lead.status_id === STATUS.DESENVOLVIMENTO) continue; // fluxo manual seu
  const campanha = cfValue(lead, CF_LEAD.CAMPANHA);

  const contactRefs = lead?._embedded?.contacts || [];
  const contacts = [];
  for (const ref of contactRefs) {
    const c = await kget(`/contacts/${ref.id}?with=custom_fields_values`);
    if (!c) continue;
    contacts.push({
      id: c.id,
      name: c.name,
      main: !!ref.is_main,
      title: cfValue(c, CF_CONTACT.POSITION_TEXT) || cfValues(c, CF_CONTACT.POSITION_ENUM)[0] || '?',
      linkedin: cfValue(c, CF_CONTACT.LINKEDIN) || null,
      connected: cfValue(c, CF_CONTACT.CONNECTED_LI) || '?',
    });
  }

  blocks.push({ task, lead, contacts, campanha });
  included++;
}

const today = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const lines = [];
lines.push(`# Briefing de coleta — ${today}`);
lines.push('');
lines.push('Oi! Estou organizando meus follow-ups e preciso que você olhe algumas conversas minhas no LinkedIn enquanto resolvo outras coisas. Pra cada pessoa abaixo:');
lines.push('');
lines.push('1. Busca a pessoa pelo compose/autocomplete de mensagem (NÃO pela busca do inbox, que dá falso negativo).');
lines.push('2. Me diz: já existe thread comigo? Qual o grau de conexão (1st/2nd/3rd)?');
lines.push('3. Se existe thread: quem mandou a última mensagem, em que data, e copia o texto das últimas 2-3 mensagens.');
lines.push('4. Se a pessoa saiu da empresa ou o perfil sumiu, anota isso.');
lines.push('');
lines.push('No final, me devolve TUDO num bloco só, no formato de saída lá embaixo. Valeu!');
lines.push('');
lines.push('---');
lines.push('');

let n = 0;
for (const b of blocks) {
  n++;
  const typeName = TASK_TYPE_NAME[b.task.task_type_id] || '?';
  lines.push(`## ${n}. ${b.lead.name} (lead ${b.lead.id} · task ${b.task.id} · ${typeName})`);
  if (b.campanha) lines.push(`- ⚠ campanha pré-pronta: "${b.campanha}" (não gerar msg própria)`);
  const taskText = (b.task.text || '').replace(/\s+/g, ' ').trim();
  if (taskText && taskText !== '.') lines.push(`- instrução do card (texto da task): "${taskText}"`);
  for (const c of b.contacts) {
    lines.push(`- ${c.main ? '★' : '·'} ${c.name} (${c.title}) ${c.linkedin || 'SEM LINKEDIN URL'} [Kommo diz conectado: ${c.connected}]`);
  }
  if (!b.contacts.length) lines.push('- (lead sem contato cadastrado — só anotar)');
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Formato de saída (um bloco por pessoa, exatamente assim):');
lines.push('');
lines.push('```');
lines.push('LEAD: <nome do lead> | <lead id> | <task id>');
lines.push('PESSOA: <nome do contato>');
lines.push('DEGREE: 1st | 2nd | 3rd | perfil sumiu | saiu da empresa');
lines.push('THREAD: sim | não');
lines.push('ULTIMA_MSG_DE: eu | lead | n/a');
lines.push('ULTIMA_MSG_DATA: YYYY-MM-DD | n/a');
lines.push('ULTIMAS_MSGS: <texto das últimas 2-3 mensagens, ou n/a>');
lines.push('OBS: <qualquer coisa fora do padrão>');
lines.push('```');
lines.push('');

const outPath = join(ROOT, `briefing-cowork-${today}.md`);
writeFileSync(outPath, lines.join('\n'));

console.log(`✓ briefing salvo: ${outPath}`);
console.log(`  ${blocks.length} leads de mensagem incluídos (de ${msgTasks.length} tasks de msg até o cutoff)`);
console.log('\nPanorama de TODAS as tasks até o cutoff (visibilidade, nada ignorado em silêncio):');
for (const [name, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)} × ${name}`);
}
