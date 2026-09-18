// theme.mjs — os tokens da marca, num lugar só.
//
// Tudo que tem interface no Roger lê daqui: hoje o painel, amanhã o que vier. A
// landing (useroger.io) carrega os mesmos valores do arquivo `tokens.css` dela — os
// dois são espelhos, e quando um muda o outro muda junto. Sem isso, a pessoa se
// encanta com a página, roda `npm run panel` e cai num produto de outra empresa.
//
// Nenhuma fonte é baixada: o painel roda offline, na máquina de quem usa, então a
// identidade vem das cores e do desenho — não de um webfont que pode não carregar.

export const TOKENS = `
:root {
  /* superfícies, do fundo para a frente */
  --ink:   #0a0912;
  --panel: #14111d;
  --panel2:#1b1726;
  --line:  #2c2739;

  /* texto */
  --text:  #f0ebe4;
  --muted: #a89fae;

  /* a marca: o vermelho é o cursor, e é sempre a ação principal */
  --red:     #ff2442;
  --ember:   #f2582a;
  --magenta: #e93cb0;
  --violet:  #7a3bf5;
  --azure:   #2e7cf6;
  --rainbow: linear-gradient(90deg, var(--red), var(--ember), var(--magenta), var(--violet), var(--azure));

  /* estado: tirado da mesma paleta, para nada parecer importado de outro lugar */
  --ok:      #28c840;   /* feito, enviado */
  --pending: var(--azure);
  --warn:    var(--ember);
  --stop:    var(--red);
  --weak:    var(--magenta);

  /* medidas: mudar aqui muda o ritmo da interface inteira */
  --ctl: 40px;
  --radius: 10px;
  --radius-lg: 12px;
  --gap-row: 16px;

  /* tipos: nada é baixado, o painel roda offline */
  --font-body: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
`.trim();

// A faixa rainbow no topo, que é a assinatura visual da marca em qualquer tela.
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
