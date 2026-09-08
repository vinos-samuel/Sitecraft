import { resolvePrimaryCta, telHref, waHref } from './cta';
import { rewriteBannedPhrases, serviceName, servicePrice } from './copy';
import type { AccentName, DentalFill } from './types';
import { normalizeFill } from './fill';

const ACCENT: Record<AccentName, string> = {
  cyan: '#00A3E0',
  magenta: '#D5008F',
  green: '#2E7D4F',
  ochre: '#C48A2A',
};

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function css(accent: AccentName, designer: boolean): string {
  const accentHex = ACCENT[accent] ?? ACCENT.cyan;
  const designerCss = designer ? `
.ph{
  min-height:160px;border:1px dashed var(--magenta);
  color:var(--magenta);font-family:var(--mono);font-size:11px;
  letter-spacing:.1em;text-transform:uppercase;
  display:flex;align-items:center;justify-content:center;
}
.fill-footer{
  background:#1C1916;color:#F3EFE4;font-family:var(--mono);
  font-size:11px;letter-spacing:.04em;padding:14px 0 18px;
}
.fill-footer .pink{color:#FF8AD2}
` : '';
  return `
:root{
  --paper:#F3EFE4;--paper-2:#EBE6D8;--ink:#1C1916;--muted:#5E584F;--faint:#8A8378;
  --rule:rgba(28,25,22,.22);--rule-strong:#1C1916;
  --cyan:#00A3E0;--magenta:#D5008F;--green:#2E7D4F;--ochre:#C48A2A;
  --accent:${accentHex};
  --serif:Georgia,"Times New Roman",Times,serif;
  --mono:ui-monospace,"SF Mono",Consolas,Menlo,monospace;
}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{
  background:var(--paper);color:var(--ink);
  font-family:var(--serif);font-size:18px;line-height:1.45;
  -webkit-font-smoothing:antialiased;
}
a{color:inherit}
a:hover{color:var(--accent)}
a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.wrap{width:min(1080px,calc(100% - 40px));margin:0 auto}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.sticky{
  position:sticky;top:0;z-index:20;
  background:rgba(243,239,228,.94);
  border-bottom:1px solid var(--rule);
  backdrop-filter:blur(8px);
}
.sticky-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0}
.sticky-name{font-size:16px;letter-spacing:-.01em}
.cta{
  display:inline-block;background:var(--ink);color:var(--paper);
  text-decoration:none;font-family:var(--mono);font-size:12px;
  letter-spacing:.08em;text-transform:uppercase;
  padding:10px 16px;border:1px solid var(--ink);
}
.cta:hover{background:var(--accent);border-color:var(--accent);color:#fff}
.masthead{padding:28px 0 8px;border-bottom:1px solid var(--rule)}
.masthead-row{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.wordmark{font-size:clamp(22px,3vw,34px);letter-spacing:-.02em;line-height:1.1}
.hero{padding:48px 0 56px;border-bottom:1px solid var(--rule)}
.variant-full .hero{display:grid;grid-template-columns:1.35fr .75fr;gap:48px;align-items:end;padding:64px 0 72px}
.hero h1{font-size:clamp(32px,5.4vw,64px);line-height:.95;letter-spacing:-.03em;font-weight:400;margin:12px 0 0}
.hero-copy{max-width:22em;color:var(--muted);font-size:18px;margin-top:20px}
.cmyk{
  position:relative;min-height:180px;
  border-left:1px solid var(--rule);padding:8px 0 8px 28px;
}
.cmyk-marks{position:absolute;inset:0;pointer-events:none}
.cmyk-num{
  font-family:var(--mono);font-size:clamp(72px,11vw,132px);
  line-height:.8;letter-spacing:-.05em;color:var(--cyan);font-weight:500;
}
.cmyk-sub{margin-top:16px;font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--magenta)}
.proof{padding:20px 0;border-bottom:1px solid var(--rule);color:var(--muted)}
.section{padding:40px 0;border-bottom:1px solid var(--rule)}
.section h2{font-size:13px;font-family:var(--mono);letter-spacing:.14em;text-transform:uppercase;font-weight:400;margin:0 0 20px;color:var(--muted)}
.svc{list-style:none;margin:0;padding:0}
.svc li{display:flex;justify-content:space-between;gap:24px;align-items:baseline;padding:14px 0;border-top:1px solid var(--rule)}
.svc li:last-child{border-bottom:1px solid var(--rule)}
.svc-price{font-family:var(--mono);font-size:14px;color:var(--muted)}
.claims{display:flex;flex-wrap:wrap;gap:8px 20px;padding:16px 0 0}
.claim{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--green)}
.hours,.pay,.ins{max-width:36em}
.ins-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px 18px}
.team,.quotes,.faq{display:flex;flex-direction:column;gap:20px}
.quote{border-left:2px solid var(--cyan);padding:0 0 0 16px;margin:0}
.quote cite{display:block;margin-top:8px;font-style:normal;font-family:var(--mono);font-size:12px;color:var(--muted)}
.faq-item{border-top:1px solid var(--rule);padding:14px 0}
.faq-item dt{font-weight:600}
.faq-item dd{margin:6px 0 0;color:var(--muted)}
#visit{padding:48px 0 72px;border-top:2px solid var(--ink)}
.visit-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:32px}
.visit-addr{font-size:22px;line-height:1.35;max-width:18em}
.visit-meta{font-family:var(--mono);font-size:14px;line-height:1.7}
.visit-meta a{color:var(--accent);text-decoration:none}
.hero-photo{display:block;width:100%;height:auto;border:0}
.variant-quiet .hero{display:block;padding:40px 0 32px}
.variant-quiet .hero h1{max-width:16em}
.variant-quiet .cmyk{display:none}
@media (max-width:800px){
  .wrap{width:min(100% - 28px,1080px)}
  .variant-full .hero,.visit-grid{display:block}
  .cmyk{border-left:0;border-top:1px solid var(--rule);padding:24px 0 0;margin-top:28px}
  .sticky-name{font-size:14px}
}
${designerCss}`.replace(/\n\s*/g, '').trim();
}

function cropMarks(): string {
  return `<svg class="cmyk-marks" viewBox="0 0 200 160" aria-hidden="true">
    <line x1="8" y1="8" x2="28" y2="8" stroke="#00A3E0" stroke-width="1"/>
    <line x1="8" y1="8" x2="8" y2="28" stroke="#D5008F" stroke-width="1"/>
    <line x1="192" y1="8" x2="172" y2="8" stroke="#D5008F" stroke-width="1"/>
    <line x1="192" y1="8" x2="192" y2="28" stroke="#00A3E0" stroke-width="1"/>
    <line x1="8" y1="152" x2="28" y2="152" stroke="#C48A2A" stroke-width="1"/>
    <line x1="8" y1="152" x2="8" y2="132" stroke="#2E7D4F" stroke-width="1"/>
  </svg>`;
}

function emptyKeys(fill: DentalFill): string[] {
  const empty: string[] = [];
  if (!fill.phone) empty.push('phone');
  if (!fill.address) empty.push('address');
  if (!fill.whatsapp) empty.push('whatsapp');
  if (!fill.booking_url) empty.push('booking_url');
  if (!fill.hours) empty.push('hours');
  if (!fill.services.length) empty.push('services');
  if (!fill.insurance.length) empty.push('insurance');
  if (!fill.team.length) empty.push('team');
  if (!fill.reviews.length) empty.push('reviews');
  if (!fill.faq.length) empty.push('faq');
  if (!fill.hero_image) empty.push('hero_image');
  if (!fill.rating_line) empty.push('rating_line');
  return empty;
}

function claimLines(fill: DentalFill): string[] {
  const { claims } = fill.options;
  const lines: string[] = [];
  if (claims.newPatients) lines.push('New patients accepted');
  if (claims.sameDayEmergencies) lines.push('Same-day emergency visits');
  if (claims.invisalign) lines.push('Invisalign offered');
  if (claims.insuranceAccepted && fill.insurance.length && fill.options.locationPreset === 'US') {
    lines.push('Listed plans accepted');
  }
  if (claims.medisave && fill.medisave_note) lines.push(rewriteBannedPhrases(fill.medisave_note));
  if (claims.chas && fill.chas_note) lines.push(rewriteBannedPhrases(fill.chas_note));
  return lines;
}

export function renderDentalShell(input: DentalFill | (Partial<DentalFill> & { name: string })): string {
  const fill = normalizeFill(input);
  const { options } = fill;
  const cta = resolvePrimaryCta(fill, options.ctaPolicy);
  const claims = options.modules.claims ? claimLines(fill) : [];
  const designer = options.mode === 'designer';
  const showSticky = options.variant === 'full' && options.modules.sticky;
  const showHeroImage = !!fill.hero_image;
  const showHeroPlaceholder = designer && options.variant === 'full' && !fill.hero_image;
  const showCmyk = options.variant === 'full' && fill.rating != null;
  const showProof = options.modules.proof && !!fill.rating_line;
  const showServices = options.modules.services && fill.services.length > 0;
  const showHours = options.modules.hours && !!fill.hours;
  const showInsurance = options.modules.insurance && fill.insurance.length > 0;
  const showPayment = options.modules.payment && !!fill.payment_note;
  const showTeam = options.modules.team && fill.team.length > 0;
  const showReviews = options.modules.reviews && fill.reviews.length > 0;
  const showFaq = options.modules.faq && fill.faq.length > 0;
  const showVisit = options.modules.visit && (!!fill.address || !!fill.phone || !!fill.whatsapp || !!fill.hours);
  const showClaims = claims.length > 0;
  const wa = waHref(fill.whatsapp);
  const tel = telHref(fill.phone);

  const kicker = [fill.city || fill.country, 'Dentistry'].filter(Boolean).join(' · ');

  const sticky = showSticky ? `
<header class="sticky">
  <div class="wrap sticky-inner">
    <div class="sticky-name">${esc(fill.name)}</div>
    <a class="cta" href="${esc(cta.href)}">${esc(cta.label)}</a>
  </div>
</header>` : '';

  const masthead = `
<div class="masthead">
  <div class="wrap masthead-row">
    <div>
      <div class="kicker">${esc(kicker)}</div>
      <div class="wordmark">${esc(fill.name)}</div>
    </div>
    ${showSticky ? '' : `<a class="cta" href="${esc(cta.href)}">${esc(cta.label)}</a>`}
  </div>
</div>`;

  const photo = showHeroImage
    ? `<img class="hero-photo" src="${esc(fill.hero_image)}" alt="">`
    : showHeroPlaceholder
      ? `<div class="ph">Photo slot — empty</div>`
      : '';

  const cmyk = showCmyk ? `
<aside class="cmyk" aria-label="Rating">
  ${cropMarks()}
  <div class="cmyk-num">${esc(fill.rating!.toFixed(1).replace(/\.0$/, ''))}</div>
  <div class="cmyk-sub">${esc(fill.rating_line)}</div>
  ${photo}
</aside>` : photo ? `<aside class="cmyk">${photo}</aside>` : '';

  const hero = options.modules.hero ? `
<section class="hero wrap">
  <div>
    <p class="kicker">Practice</p>
    <h1>${esc(fill.headline)}</h1>
    ${fill.city ? `<p class="hero-copy">${esc(fill.city)}${fill.country ? `, ${esc(fill.country)}` : ''}.</p>` : ''}
    ${showClaims ? `<div class="claims">${claims.map((c) => `<span class="claim">${esc(c)}</span>`).join('')}</div>` : ''}
  </div>
  ${cmyk}
</section>` : '';

  const proof = showProof && options.variant === 'quiet' ? `
<section class="proof wrap">${esc(fill.rating_line)}</section>` : '';

  const services = showServices ? `
<section class="section wrap" id="services">
  <h2>Services</h2>
  <ul class="svc">
    ${fill.services.map((s) => {
      const price = servicePrice(s);
      return `<li><span>${esc(serviceName(s))}</span>${price ? `<span class="svc-price">${esc(price)}</span>` : ''}</li>`;
    }).join('')}
  </ul>
</section>` : '';

  const hours = showHours ? `
<section class="section wrap hours">
  <h2>Hours</h2>
  <p>${esc(fill.hours)}</p>
</section>` : '';

  const insurance = showInsurance ? `
<section class="section wrap ins">
  <h2>Insurance</h2>
  <ul class="ins-list">${fill.insurance.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
</section>` : '';

  const payment = showPayment ? `
<section class="section wrap pay">
  <h2>Payment</h2>
  <p>${esc(fill.payment_note)}</p>
</section>` : '';

  const team = showTeam ? `
<section class="section wrap">
  <h2>Team</h2>
  <div class="team">${fill.team.map((t) => `<p>${esc(t.name)}${t.role ? ` — ${esc(t.role)}` : ''}</p>`).join('')}</div>
</section>` : '';

  const reviews = showReviews ? `
<section class="section wrap">
  <h2>Reviews</h2>
  <div class="quotes">${fill.reviews.map((r) => `<blockquote class="quote">${esc(r.quote)}${r.attribution ? `<cite>${esc(r.attribution)}</cite>` : ''}</blockquote>`).join('')}</div>
</section>` : '';

  const faq = showFaq ? `
<section class="section wrap">
  <h2>Questions</h2>
  <dl class="faq">${fill.faq.map((f) => `<div class="faq-item"><dt>${esc(f.question)}</dt><dd>${esc(f.answer)}</dd></div>`).join('')}</dl>
</section>` : '';

  const visitBits: string[] = [];
  if (fill.phone && tel) visitBits.push(`<div><a href="${esc(tel)}">${esc(fill.phone)}</a></div>`);
  if (fill.whatsapp && wa) visitBits.push(`<div><a href="${esc(wa)}">WhatsApp</a></div>`);
  if (fill.hours) visitBits.push(`<div>${esc(fill.hours)}</div>`);
  if (cta.kind === 'booking') visitBits.push(`<div><a href="${esc(cta.href)}">Book online</a></div>`);

  const visit = showVisit ? `
<section id="visit">
  <div class="wrap visit-grid">
    <div>
      <p class="kicker">Visit</p>
      ${fill.address ? `<p class="visit-addr">${esc(fill.address)}</p>` : ''}
    </div>
    <div class="visit-meta">${visitBits.join('')}</div>
  </div>
</section>` : '';

  const missing = emptyKeys(fill);
  const footer = designer ? `
<footer class="fill-footer">
  <div class="wrap">
    <span class="pink">FILL</span>
    · ${esc(options.variant)} · ${esc(options.locationPreset)} · ${esc(options.mode)}
    ${missing.length ? ` · empty: <span class="pink">${esc(missing.join(', '))}</span>` : ''}
    ${options.designerNote ? `<div style="margin-top:8px">${esc(options.designerNote)}</div>` : ''}
  </div>
</footer>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fill.name)}</title>
<style>${css(fill.accent, designer)}</style>
</head>
<body class="shell variant-${options.variant} mode-${options.mode} preset-${options.locationPreset.toLowerCase()}">
${sticky}
${masthead}
<main>
${hero}
${proof}
${services}
${hours}
${insurance}
${payment}
${team}
${reviews}
${faq}
${visit}
</main>
${footer}
</body>
</html>`;
}
