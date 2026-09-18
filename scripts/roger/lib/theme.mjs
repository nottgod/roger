// theme.mjs — the brand tokens, in one place.
//
// Everything with an interface in Roger reads from here: today the panel, tomorrow
// whatever comes next. The landing (useroger.io) carries the same values in its own
// `tokens.css` — the two are mirrors, and when one changes the other changes with it.
// Without that, people fall for the page, run `npm run panel` and land in another product.
//
// No font is downloaded: the panel runs offline, on the machine of whoever uses it, so
// the identity comes from the colours and the layout — not from a webfont that may not load.

export const TOKENS = `
:root {
  /* surfaces, from the back forward */
  --ink:   #0a0912;
  --panel: #14111d;
  --panel2:#1b1726;
  --line:  #2c2739;

  /* text */
  --text:  #f0ebe4;
  --muted: #a89fae;

  /* the brand: the red is the cursor, and it is always the primary action */
  --red:     #ff2442;
  --ember:   #f2582a;
  --magenta: #e93cb0;
  --violet:  #7a3bf5;
  --azure:   #2e7cf6;
  --rainbow: linear-gradient(90deg, var(--red), var(--ember), var(--magenta), var(--violet), var(--azure));

  /* state: taken from the same palette, so nothing looks imported from elsewhere */
  --ok:      #28c840;   /* feito, enviado */
  --pending: var(--azure);
  --warn:    var(--ember);
  --stop:    var(--red);
  --weak:    var(--magenta);

  /* measurements: changing these changes the rhythm of the whole interface */
  --ctl: 40px;
  --radius: 10px;
  --radius-lg: 12px;
  --gap-row: 16px;

  /* type: nothing is downloaded, the panel runs offline */
  --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
`.trim();

// The rainbow bar at the top, which is the brand's signature on any screen.
export const BRAND_BAR = `
body::after {
  content: "";
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--rainbow);
  z-index: 50;
  pointer-events: none;
}
`.trim();
