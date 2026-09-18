// linkedin-page.mjs — the layer that drives the browser. Thin on purpose.
//
// This is the ONLY part of the sending arm without a unit test, because it needs a real
// browser and a real session. That is why it decides nothing: it only looks at the screen
// and returns plain data, and the deciding is done by lib/send-gates.mjs, which is pure
// and tested. Any rule that can move down there, moves.
//
// Two things inherited from code that has actually run, and that are worth gold:
//   - read `innerText` instead of a CSS class. LinkedIn changes class names on every
//     deploy; the visible text is stable.
//   - type character by character with a random delay, instead of filling the field in
//     one go (filling it at once does not enable the send button).
//
// Playwright is an OPTIONAL dependency: the Roger core runs with no dependencies at all,
// and someone who will never send should not have to download a browser. If it is
// missing, the message says what to do.

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
      'the sending arm needs Playwright, which is deliberately not installed '
      + '(the Roger core has zero dependencies).\n  Install it with:  npm i playwright && npx playwright install chromium',
    );
  }
}

// One profile directory PER IDENTITY. Switching accounts is switching directories, and a
// declared identity with no directory is an ERROR — falling into a shared profile would
// mean sending a message from someone else's account.
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

// ASYMMETRIC session guard: it only blocks when it AFFIRMS having seen a login screen.
// An unknown DOM, a missing selector or a failed navigation carry on — a guard that fails
// closed on a stale selector protects no identity, it just stops the operation.
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
    return false; // failing to affirm is not the same as being logged out
  }
}

// The snapshot of the screen, as plain data: this is what the gates receive.
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
    // Failing to read the screen is NOT an empty screen. `bubbles: null` makes the gate refuse.
    return { url, bannerText: '', recipientName: null, isInMailComposer: false, hasMessageChannel: null, bubbles: null };
  }

  // An empty `sender` = our own message (LinkedIn only labels the change of author).
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

// Types and sends. Returns the PHASE, which is the distinction the journal needs:
//   pre-click   nothing went out, for certain (the intent can be closed)
//   post-click  it may have gone out; `confirmed` says whether the bubble appeared
export async function typeAndSend(page, text, { rand = Math.random } = {}) {
  try {
    await page.waitForSelector(BOX_SEL, { timeout: 12000 });
  } catch {
    return { phase: 'pre-click', confirmed: false, why: 'the message field did not appear' };
  }

  const box = page.locator(BOX_SEL).first();
  try {
    await box.click();
    await box.fill('');
    for (const char of text) {
      // Enter sends: a line break has to be Shift+Enter.
      if (char === '\n') await page.keyboard.press('Shift+Enter');
      else await page.keyboard.type(char, { delay: Math.floor(rand() * 18) + 8 });
    }
  } catch (e) {
    return { phase: 'pre-click', confirmed: false, why: `falha ao digitar: ${e.message}` };
  }

  const btn = page.locator(SEND_SEL).first();
  const clickable = await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false);
  if (!clickable) {
    // A disabled button is free validation: the draft is not valid.
    return { phase: 'pre-click', confirmed: false, why: 'the send button was unavailable' };
  }

  try {
    await btn.click();
  } catch (e) {
    return { phase: 'pre-click', confirmed: false, why: `falha ao clicar: ${e.message}` };
  }

  // From here on the message MAY have gone out. Confirming means re-reading the thread.
  await page.waitForTimeout(1500 + Math.floor(rand() * 600));
  const after = await snapshot(page).catch(() => null);
  const confirmed = !!after && Array.isArray(after.bubbles)
    && after.bubbles.some((b) => b.fromMe && b.text && text.slice(0, 60).toLowerCase().includes(b.text.slice(0, 60).toLowerCase()));

  return { phase: 'post-click', confirmed, why: confirmed ? null : 'clicked, and the bubble did not confirm' };
}
