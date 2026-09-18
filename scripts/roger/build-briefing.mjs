#!/usr/bin/env node
// Builds the SINGLE research briefing to paste into a chat assistant, from today's tasks.
// It is PASTE 1 of the flow: you paste the whole file in one go, and the assistant
// returns a single dump (PASTE 2) in the format asked for at the end of the briefing.
//
// Usage: node build-briefing.mjs            → writes briefing-cowork-YYYY-MM-DD.md at the root
//        node build-briefing.mjs --limit 15 → only the first 15 leads

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  kget, USER_ID, TASK_TYPE, TASK_TYPE_NAME, CF_CONTACT, CF_LEAD, STATUS, cfValue, cfValues,
} from './kommo-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

// the same window as the skill: today (Mon-Thu) or next Monday (Fri-Sun)
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

// full visibility: count by type, including the ones that do not make the briefing
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
lines.push(`# Research briefing — ${today}`);
lines.push('');
lines.push('Hi! I am organising my follow-ups and I need you to look at a few of my LinkedIn conversations while I deal with other things. For each person below:');
lines.push('');
lines.push('1. Find the person through the message compose autocomplete (NOT through the inbox search, which gives false negatives).');
lines.push('2. Tell me: is there already a thread with me? What is the connection degree (1st/2nd/3rd)?');
lines.push('3. If there is a thread: who sent the last message, on what date, and copy the text of the last 2-3 messages.');
lines.push('4. If the person left the company or the profile is gone, note that.');
lines.push('');
lines.push('At the end, give me EVERYTHING back in a single block, in the output format below. Thanks!');
lines.push('');
lines.push('---');
lines.push('');

let n = 0;
for (const b of blocks) {
  n++;
  const typeName = TASK_TYPE_NAME[b.task.task_type_id] || '?';
  lines.push(`## ${n}. ${b.lead.name} (lead ${b.lead.id} · task ${b.task.id} · ${typeName})`);
  if (b.campanha) lines.push(`- ⚠ ready-made campaign: "${b.campanha}" (do not write your own message)`);
  const taskText = (b.task.text || '').replace(/\s+/g, ' ').trim();
  if (taskText && taskText !== '.') lines.push(`- card instruction (the task text): "${taskText}"`);
  for (const c of b.contacts) {
    lines.push(`- ${c.main ? '★' : '·'} ${c.name} (${c.title}) ${c.linkedin || 'NO LINKEDIN URL'} [CRM says connected: ${c.connected}]`);
  }
  if (!b.contacts.length) lines.push('- (lead with no contact on file — just note it)');
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Output format (one block per person, exactly like this):');
lines.push('');
lines.push('```');
lines.push('LEAD: <lead name> | <lead id> | <task id>');
lines.push('PERSON: <contact name>');
lines.push('DEGREE: 1st | 2nd | 3rd | profile gone | left the company');
lines.push('THREAD: yes | no');
lines.push('LAST_MSG_FROM: me | them | n/a');
lines.push('LAST_MSG_DATE: YYYY-MM-DD | n/a');
lines.push('LAST_MSGS: <text of the last 2-3 messages, or n/a>');
lines.push('NOTES: <anything out of the ordinary>');
lines.push('```');
lines.push('');

const outPath = join(ROOT, `briefing-cowork-${today}.md`);
writeFileSync(outPath, lines.join('\n'));

console.log(`✓ briefing saved: ${outPath}`);
console.log(`  ${blocks.length} message leads included (out of ${msgTasks.length} message tasks up to the cutoff)`);
console.log('\nEvery task up to the cutoff (full visibility, nothing ignored in silence):');
for (const [name, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)} × ${name}`);
}
