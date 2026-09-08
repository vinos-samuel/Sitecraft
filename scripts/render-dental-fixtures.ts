/**
 * Render the three Broadsheet dental fixtures and assert honesty / SG rules.
 * Usage: npx --yes tsx scripts/render-dental-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import {
  DENTAL_FIXTURES,
  SINGAPORE_JURONG,
  assembleHeadline,
  fillFromLead,
  inferLocationPreset,
  isDentalLead,
  renderDentalShell,
  resolvePrimaryCta,
  rewriteBannedPhrases,
} from '../src/lib/shells/dental/index';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../src/lib/shells/dental/previews');
mkdirSync(outDir, { recursive: true });

let failed = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${label}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${label}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

console.log('Rendering fixtures…');
for (const fixture of DENTAL_FIXTURES) {
  const html = renderDentalShell(fixture.fill);
  const dest = join(outDir, `${fixture.id}.html`);
  writeFileSync(dest, html, 'utf8');
  console.log(`  wrote ${dest} (${html.length} bytes)`);
}

const us = renderDentalShell(DENTAL_FIXTURES[0].fill);
const india = renderDentalShell(DENTAL_FIXTURES[1].fill);
const sg = renderDentalShell(DENTAL_FIXTURES[2].fill);

console.log('\nAssertions…');

check('all three share Broadsheet tokens (paper, cyan, magenta, serif)', () => {
  for (const html of [us, india, sg]) {
    assert.match(html, /--paper:#F3EFE4/);
    assert.match(html, /--cyan:#00A3E0/);
    assert.match(html, /--magenta:#D5008F/);
    assert.match(html, /Georgia/);
    assert.doesNotMatch(html, /bootstrap/i);
    assert.doesNotMatch(html, /unpkg\.com/);
  }
});

check('US Full has sticky bar + CMYK numeral + Book online (booking_url set)', () => {
  assert.match(us, /class="sticky"/);
  assert.match(us, /class="cmyk-num"/);
  assert.match(us, />Book online</);
  assert.match(us, /Delta Dental/);
  assert.match(us, /New patients accepted/);
});

check('India Quiet has no sticky, no US insurance, no claims', () => {
  assert.doesNotMatch(india, /class="sticky"/);
  assert.doesNotMatch(india, /Delta|Cigna|Aetna/);
  assert.doesNotMatch(india, /New patients accepted|MediSave|CHAS|Invisalign/);
  assert.match(india, /Hadapsar/);
});

check('Singapore: same shell, WhatsApp CTA, no US insurance, no invented schemes/fees', () => {
  assert.match(sg, /--paper:#F3EFE4/);
  assert.doesNotMatch(sg, /class="sticky"/);
  assert.match(sg, /WhatsApp/);
  assert.match(sg, /wa\.me\/6565614400/);
  assert.doesNotMatch(sg, />Book online</);
  assert.doesNotMatch(sg, /Delta|Cigna|Aetna/);
  assert.doesNotMatch(sg, /MediSave|CHAS/);
  assert.doesNotMatch(sg, /\$\d|SGD/);
  assert.match(sg, /Jurong East/);
  assert.match(sg, /Singapore 600135/);
  assert.match(sg, /\+65 6561 4400/);
  assert.match(sg, /Designer fixture/);
});

check('Singapore prospect clone: no pink tokens / fill footer / photo placeholder', () => {
  const prospect = renderDentalShell({
    ...SINGAPORE_JURONG,
    options: { ...SINGAPORE_JURONG.options, mode: 'prospect', designerNote: undefined },
  });
  assert.doesNotMatch(prospect, /fill-footer|class="pink"|class="ph"|#FF8AD2/);
  assert.doesNotMatch(prospect, /Designer fixture/);
  assert.match(prospect, /WhatsApp/);
  assert.doesNotMatch(prospect, /Delta|Cigna|Aetna|MediSave|CHAS/);
});

check('empty arrays omit sections (no team / reviews / faq / insurance in SG)', () => {
  assert.doesNotMatch(sg, />Team</);
  assert.doesNotMatch(sg, />Reviews</);
  assert.doesNotMatch(sg, />Questions</);
  assert.doesNotMatch(sg, />Insurance</);
});

check('headline assembler is deterministic', () => {
  assert.equal(
    assembleHeadline('Jurong East', ['Check-ups', 'Fillings']),
    'Jurong East dentistry: check-ups, restorative, in one building.',
  );
  assert.equal(
    assembleHeadline('Ridgeway', ['Hygiene']),
    'Dentistry in Ridgeway, planned before it is started.',
  );
});

check('banned phrases rewrite; page is not regenerated', () => {
  const cleaned = rewriteBannedPhrases('seamlessly elevate and unlock your smile of your dreams journey');
  assert.doesNotMatch(cleaned, /seamlessly|elevate|unlock|smile of your dreams|\bjourney\b/i);
});

check('CTA order: booking → WhatsApp → tel → #visit', () => {
  assert.equal(resolvePrimaryCta({ booking_url: 'https://x/book', whatsapp: '+65 1', phone: '+65 1' }, 'auto').kind, 'booking');
  assert.equal(resolvePrimaryCta({ booking_url: '', whatsapp: '+65 65614400', phone: '+65 65614400' }, 'auto').kind, 'whatsapp');
  assert.equal(resolvePrimaryCta({ booking_url: '', whatsapp: '', phone: '+65 6561 4400' }, 'auto').kind, 'phone');
  assert.equal(resolvePrimaryCta({ booking_url: '', whatsapp: '', phone: '' }, 'auto').href, '#visit');
});

check('location inference includes Singapore from +65 / postal', () => {
  assert.equal(inferLocationPreset('Blk 1 Jurong East, Singapore 600135', '+65 6561 4400'), 'Singapore');
  assert.equal(inferLocationPreset('Hadapsar, Pune, Maharashtra 411028', '+91 20 4123 5600'), 'India');
  assert.equal(inferLocationPreset('214 Main Street, Ridgeway, VA 24148', '(276) 555-0148'), 'US');
});

check('fillFromLead does not invent team, reviews, FAQ, insurance, or fees', () => {
  const fill = fillFromLead({
    name: 'Jurong East Dental Practice',
    rating: '4.5',
    reviewsCount: '64',
    phone: '+65 6561 4400',
    address: 'Jurong East, Singapore 600135',
    siteFacts: null,
  });
  assert.equal(fill.options.locationPreset, 'Singapore');
  assert.equal(fill.options.variant, 'quiet');
  assert.equal(fill.options.mode, 'prospect');
  assert.deepEqual(fill.team, []);
  assert.deepEqual(fill.reviews, []);
  assert.deepEqual(fill.faq, []);
  assert.deepEqual(fill.insurance, []);
  assert.equal(fill.booking_url, '');
  const html = renderDentalShell(fill);
  assert.doesNotMatch(html, />Team<|>Reviews<|>Insurance<|>Book online</);
  assert.doesNotMatch(html, /fill-footer|class="ph"|#FF8AD2/);
  assert.match(html, /\+65 6561 4400/);
});

check('isDentalLead matches Dentists category and dental names, not salons', () => {
  assert.equal(isDentalLead({ name: 'Acme Cuts' }, 'Dentists'), true);
  assert.equal(isDentalLead({ name: 'Ridgeway Family Dental' }), true);
  assert.equal(isDentalLead({ name: 'Acme Cuts' }, 'Hair Salons'), false);
});

check('isDentalLead prefers stored businessType over name/heading heuristics', () => {
  assert.equal(isDentalLead({ name: 'Acme Family Care' }, 'Dentists'), true);
  assert.equal(isDentalLead({ name: 'Acme Family Care', businessType: 'Dentists' }), true);
  assert.equal(isDentalLead({ name: 'Ridgeway Family Dental' }, 'Hair Salons'), false);
  assert.equal(isDentalLead({ name: 'Acme Family Care' }), false);
});

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll dental-shell fixture checks passed.');
