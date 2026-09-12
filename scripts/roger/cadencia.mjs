// Cadência de FUPs — lê rapport/cadencia-funil.md (fonte da verdade, editável por você).
// Se o parse falhar, cai no fallback hardcoded e avisa.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CADENCIA_MD = join(ROOT, 'rapport', 'cadencia-funil.md');

// fallback = Bloco 6 (6 FUPs/28d), reconciliado 2026-06-26 (incremental, dias desde o envio anterior).
// Acumulado: FUP1 D+2, FUP2 D+5, FUP3 D+9, FUP4 D+14, FUP5 D+19, FUP>5 D+25; encerramento D+28.
const FALLBACK = {
  MENSAGEM_INICIAL: { next: 'FUP_1', days: 2 },
  FUP_1: { next: 'FUP_2', days: 3 },
  FUP_2: { next: 'FUP_3', days: 4 },
  FUP_3: { next: 'FUP_4', days: 5 },
  FUP_4: { next: 'FUP_5', days: 5 },
  FUP_5: { next: 'FUP_MAIS', days: 6 },
  // FIM DA SEQUÊNCIA. Isto era `{ next: 'FUP_MAIS', days: 3 }` — um auto-encadeamento
  // que fazia o painel criar FUP para sempre, contra o encerramento D+28 declarado no
  // cadencia-funil.md. `next: null` é o sinal de "acabou": quem consome não cria nada.
  FUP_MAIS: { next: null, days: null },
};

// Rótulos que, na coluna "próxima task", significam encerrar em vez de encadear.
const END_LABELS = /encerr|fim|nenhuma|none|end|stop/i;

const LABEL_TO_KEY = {
  'mensagem inicial': 'MENSAGEM_INICIAL',
  'fup 1': 'FUP_1', 'fup 2': 'FUP_2', 'fup 3': 'FUP_3',
  'fup 4': 'FUP_4', 'fup 5': 'FUP_5',
  'fup >5': 'FUP_MAIS', 'fup >5 (1ª)': 'FUP_MAIS', 'fup >5 (2ª)': 'FUP_MAIS',
};

export function loadCadencia() {
  try {
    const md = readFileSync(CADENCIA_MD, 'utf8');
    const section = md.split(/##\s*Cadência de FUPs/i)[1] || '';
    const rows = section.split('\n').filter(l => /^\|/.test(l));
    const map = {};
    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim().toLowerCase());
      // | FUP atual enviada | Próxima task | Prazo ... |
      if (cells.length < 4) continue;
      const from = LABEL_TO_KEY[cells[1]];
      const to = LABEL_TO_KEY[cells[2]];
      const m = cells[3].match(/d\+(\d+)/);
      if (from && to && m) map[from] = { next: to, days: parseInt(m[1], 10) };
      // Linha de encerramento: o markdown passa a poder dizer onde a sequência ACABA.
      // Sem isto não havia como expressar o fim, e o fim virava um auto-encadeamento.
      else if (from && !to && END_LABELS.test(cells[2])) map[from] = { next: null, days: null };
    }
    // sanidade: precisa cobrir pelo menos MI e FUP_1..5
    const required = ['MENSAGEM_INICIAL', 'FUP_1', 'FUP_2', 'FUP_3', 'FUP_4', 'FUP_5'];
    if (required.every(k => map[k])) {
      // Sem linha para "fup >5" no markdown, a sequência ENCERRA aqui. Antes isto
      // injetava `{ next: 'FUP_MAIS', days: 3 }` e a cadência não terminava nunca.
      if (!map.FUP_MAIS) map.FUP_MAIS = { next: null, days: null };
      return { map, source: 'cadencia-funil.md' };
    }
    console.error('[cadencia] parse incompleto de cadencia-funil.md, usando fallback');
    return { map: FALLBACK, source: 'fallback' };
  } catch (e) {
    console.error('[cadencia] erro lendo cadencia-funil.md, usando fallback:', e.message);
    return { map: FALLBACK, source: 'fallback' };
  }
}

// Regra: sex/sáb/dom não recebem task — empurra pra próxima segunda.
export function nextValidDate(fromDate, days) {
  const d = new Date(fromDate.getTime() + days * 86400_000);
  // dia da semana em BRT (UTC-3)
  const brt = new Date(d.getTime() - 3 * 3600_000);
  const dow = brt.getUTCDay(); // 0=dom 1=seg ... 6=sáb
  let push = 0;
  if (dow === 5) push = 3;      // sex -> seg
  else if (dow === 6) push = 2; // sáb -> seg
  else if (dow === 0) push = 1; // dom -> seg
  return new Date(d.getTime() + push * 86400_000);
}

// Task all-day no Kommo = complete_till 23:59:59 BRT do dia alvo (02:59:59 UTC do dia seguinte)
export function endOfDayBRT(date) {
  return Math.floor(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 2, 59, 59
  ) / 1000);
}
