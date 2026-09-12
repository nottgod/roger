// linkedin-page.mjs — a camada que dirige o navegador. Fina de propósito.
//
// Esta é a ÚNICA parte do braço de envio que não tem teste unitário, porque precisa de
// um navegador e de uma sessão real. Por isso ela não decide nada: só olha a tela e
// devolve dado simples, e quem decide é lib/send-gates.mjs, que é pura e testada.
// Toda regra que puder descer para lá, desce.
//
// Duas coisas herdadas de código que já rodou nesta casa, e que valem ouro:
//   - ler `innerText` em vez de classe CSS. O LinkedIn troca os nomes de classe a cada
//     deploy; o texto visível é estável.
//   - digitar caractere por caractere com atraso aleatório, em vez de preencher o campo
//     de uma vez (preencher de uma vez não habilita o botão de envio).
//
// Playwright é dependência OPCIONAL: o core da Roger roda sem dependência nenhuma, e
// quem nunca vai enviar não deveria baixar um navegador. Se faltar, a mensagem diz o
// que fazer.

export const BOX_SEL = [
  '.msg-form__contenteditable[contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
  'div.msg-form__msg-content-container div[contenteditable="true"]',
].join(', ');

export const SEND_SEL = 'button[type="submit"].msg-form__send-button, button.msg-form__send-button';

const LOGIN_SIGNALS = [/\/login/i, /\/authwall/i, /\/checkpoint\//i];

export async function loadPlaywright(importer = (m) => import(m)) {
  try {
    const pw = await importer('playwright');
    return pw.chromium ? pw : pw.default;
  } catch {
    throw new Error(
      'o braço de envio precisa do Playwright, que não vem instalado de propósito '
      + '(o core da Roger é zero-dependência).\n  Instale com:  npm i playwright && npx playwright install chromium',
    );
  }
}

// Um diretório de perfil POR IDENTIDADE. Trocar de conta é trocar de diretório, e
// identidade declarada sem diretório é ERRO — cair num perfil compartilhado seria
// mandar mensagem pela conta de outra pessoa.
export function profileDirFor(identity, baseDir) {
  const slug = String(identity || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (!slug) throw new Error('sem identidade declarada: recuso abrir navegador sem saber qual conta vai falar');
  return `${baseDir.replace(/\/$/, '')}/chrome-profile-${slug}`;
}

export async function openBrowser({ identity, baseDir, headless = false, importer } = {}) {
  const { chromium } = await loadPlaywright(importer);
  const userDataDir = profileDirFor(identity, baseDir);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] || await context.newPage();
  return { context, page, userDataDir };
}

// Guarda de sessão ASSIMÉTRICA: só barra quando AFIRMA ter visto tela de login.
// DOM desconhecido, seletor sumido ou navegação falhada seguem — uma guarda que
// fecha por seletor obsoleto não protege identidade nenhuma, só para a operação.
export async function sessionLooksLoggedOut(page) {
  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    const url = page.url();
    if (LOGIN_SIGNALS.some((re) => re.test(url))) return true;
    const hasLoginField = await page.evaluate(
      () => !!document.querySelector('input#username, input[name="session_key"]'),
    ).catch(() => false);
    return !!hasLoginField;
  } catch {
    return false; // não conseguir afirmar não é o mesmo que estar deslogado
  }
}

// O retrato da tela, em dado simples: é isto que os portões recebem.
export async function snapshot(page, { limit = 30 } = {}) {
  const url = page.url();
  const data = await page.evaluate((n) => {
    const txt = (el) => el?.textContent?.trim() || '';
    const banner = [...document.querySelectorAll('[role="alert"], .artdeco-inline-feedback, .msg-s-event-listitem--banner')]
      .map((el) => txt(el)).join(' | ');
    const recipient = txt(document.querySelector('.msg-entity-lockup__entity-title, .msg-thread__link-to-profile, .msg-compose-form__recipient'))
      || txt(document.querySelector('a[href*="/in/"]'));
    const isInMail = !!document.querySelector('input[name="subject"], .msg-form__subject')
      || /inmail|credit/i.test(txt(document.querySelector('.msg-form__footer')));
    const bubbles = [...document.querySelectorAll('.msg-s-event-listitem')].slice(-n).map((m) => {
      const sender = txt(m.querySelector('.msg-s-message-group__name'));
      return { sender, text: txt(m.querySelector('.msg-s-event-listitem__body')) };
    }).filter((b) => b.text);
    const hasMessageChannel = !!document.querySelector(
      'a[href*="messaging/compose"], .msg-form__contenteditable, div[role="textbox"][contenteditable="true"]',
    );
    return { banner, recipient, isInMail, bubbles, hasMessageChannel };
  }, limit).catch(() => null);

  if (!data) {
    // Não conseguir ler a tela NÃO é tela vazia. `bubbles: null` faz o portão recusar.
    return { url, bannerText: '', recipientName: null, isInMailComposer: false, hasMessageChannel: null, bubbles: null };
  }

  // `sender` vazio = nossa mensagem (o LinkedIn só rotula a troca de autor).
  let lastFromMe = true;
  const bubbles = data.bubbles.map((b) => {
    if (b.sender) lastFromMe = false;
    return { fromMe: b.sender ? false : lastFromMe, text: b.text };
  });

  return {
    url,
    bannerText: data.banner,
    recipientName: data.recipient || null,
    isInMailComposer: !!data.isInMail,
    hasMessageChannel: data.hasMessageChannel,
    bubbles,
  };
}

// Digita e envia. Devolve FASE, que é a distinção que o journal precisa:
//   pre-click   com certeza nada saiu (dá para fechar a intenção)
//   post-click  pode ter saído; `confirmed` diz se a bolha apareceu
export async function typeAndSend(page, text, { rand = Math.random } = {}) {
  try {
    await page.waitForSelector(BOX_SEL, { timeout: 12000 });
  } catch {
    return { phase: 'pre-click', confirmed: false, why: 'campo de mensagem não apareceu' };
  }

  const box = page.locator(BOX_SEL).first();
  try {
    await box.click();
    await box.fill('');
    for (const char of text) {
      // Enter envia: quebra de linha tem de ser Shift+Enter.
      if (char === '\n') await page.keyboard.press('Shift+Enter');
      else await page.keyboard.type(char, { delay: Math.floor(rand() * 18) + 8 });
    }
  } catch (e) {
    return { phase: 'pre-click', confirmed: false, why: `falha ao digitar: ${e.message}` };
  }

  const btn = page.locator(SEND_SEL).first();
  const clickable = await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false);
  if (!clickable) {
    // Botão desabilitado é validação de graça: o rascunho não está válido.
    return { phase: 'pre-click', confirmed: false, why: 'botão de envio indisponível' };
  }

  try {
    await btn.click();
  } catch (e) {
    return { phase: 'pre-click', confirmed: false, why: `falha ao clicar: ${e.message}` };
  }

  // Daqui em diante a mensagem PODE ter saído. Confirmar é reler a thread.
  await page.waitForTimeout(1500 + Math.floor(rand() * 600));
  const after = await snapshot(page).catch(() => null);
  const confirmed = !!after && Array.isArray(after.bubbles)
    && after.bubbles.some((b) => b.fromMe && b.text && text.slice(0, 60).toLowerCase().includes(b.text.slice(0, 60).toLowerCase()));

  return { phase: 'post-click', confirmed, why: confirmed ? null : 'cliquei e a bolha não confirmou' };
}
