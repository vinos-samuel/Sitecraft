import type { DentalFill, DentalService } from './types';

/**
 * Marketing fluff is rewritten in place. The page is never regenerated
 * to "sound nicer" — layout stays locked.
 */
export const BANNED_PHRASE_TABLE: { pattern: RegExp; replace: string }[] = [
  { pattern: /\bsmile of your dreams\b/gi, replace: 'a planned result' },
  { pattern: /\bdream smile\b/gi, replace: 'a planned result' },
  { pattern: /\btransform your smile\b/gi, replace: 'planned dental work' },
  { pattern: /\byour smile deserves\b/gi, replace: 'this practice offers' },
  { pattern: /\bcommitted to excellence\b/gi, replace: 'careful work' },
  { pattern: /\bpassionate about\b/gi, replace: 'focused on' },
  { pattern: /\bstate-of-the-art\b/gi, replace: 'current' },
  { pattern: /\bcutting-edge\b/gi, replace: 'current' },
  { pattern: /\bworld-class\b/gi, replace: 'careful' },
  { pattern: /\bholistic smile\b/gi, replace: 'complete' },
  { pattern: /\bluxury dental\b/gi, replace: 'dental' },
  { pattern: /\bbespoke smile\b/gi, replace: 'planned' },
  { pattern: /\bdelightful experience\b/gi, replace: 'a clear visit' },
  { pattern: /\bexceptional care experience\b/gi, replace: 'clear care' },
  { pattern: /\bgame-changer\b/gi, replace: 'change' },
  { pattern: /\brevolutionize\b/gi, replace: 'change' },
  { pattern: /\bnext-level\b/gi, replace: 'further' },
  { pattern: /\bseamlessly\b/gi, replace: 'without extra steps' },
  { pattern: /\belevating\b/gi, replace: 'improving' },
  { pattern: /\belevated\b/gi, replace: 'improved' },
  { pattern: /\belevate\b/gi, replace: 'improve' },
  { pattern: /\bunlocking\b/gi, replace: 'opening' },
  { pattern: /\bunlock\b/gi, replace: 'open' },
  { pattern: /\bunleash\b/gi, replace: 'start' },
  { pattern: /\bempower\b/gi, replace: 'help' },
  { pattern: /\bjourney\b/gi, replace: 'care' },
];

export function rewriteBannedPhrases(text: string): string {
  if (!text) return '';
  let out = text;
  for (const { pattern, replace } of BANNED_PHRASE_TABLE) {
    out = out.replace(pattern, replace);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function serviceName(service: DentalService): string {
  return typeof service === 'string' ? service : service.name;
}

export function servicePrice(service: DentalService): string {
  return typeof service === 'string' ? '' : (service.price ?? '');
}

export function serviceCategory(service: DentalService): string {
  if (typeof service !== 'string' && service.category) return service.category;
  return categorizeService(serviceName(service));
}

const SERVICE_CATS: [RegExp, string][] = [
  [/implant/i, 'implants'],
  [/ortho|brace|aligner|invisalign/i, 'orthodontics'],
  [/whiten|veneer|cosmetic|smile design/i, 'cosmetic'],
  [/pedo|pediatric|child|\bkids\b/i, 'pediatric'],
  [/root canal|endo/i, 'endodontics'],
  [/perio|gum/i, 'periodontics'],
  [/extract|wisdom|oral surg/i, 'oral surgery'],
  [/crown|bridge/i, 'crowns'],
  [/filling|restor|cavity/i, 'restorative'],
  [/clean|hygiene|scale|checkup|check-up|check up|exam|consult/i, 'check-ups'],
  [/emergency|toothache/i, 'emergency'],
];

export function categorizeService(name: string): string {
  for (const [re, cat] of SERVICE_CATS) {
    if (re.test(name)) return cat;
  }
  const short = name.replace(/\s+/g, ' ').trim().toLowerCase();
  return short.length > 0 && short.length <= 28 ? short : '';
}

/** Headline is assembled from city + service cats. Never free-authored fluff. */
export function assembleHeadline(city: string, services: DentalService[]): string {
  const cityName = city.trim();
  const cats: string[] = [];
  const seen = new Set<string>();
  for (const s of services) {
    const cat = serviceCategory(s);
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    cats.push(cat);
  }
  if (cityName && cats.length >= 2) {
    return `${cityName} dentistry: ${cats.join(', ')}, in one building.`;
  }
  if (cityName) return `Dentistry in ${cityName}, planned before it is started.`;
  return 'Dentistry, planned before it is started.';
}

export function assembleRatingLine(rating: number | null, reviewCount: number | null): string {
  if (rating == null || !Number.isFinite(rating)) return '';
  const n = reviewCount != null && Number.isFinite(reviewCount) && reviewCount > 0
    ? reviewCount
    : null;
  if (n != null) return `${formatRating(rating)} from ${n} Google reviews`;
  return `${formatRating(rating)} on Google`;
}

export function formatRating(rating: number): string {
  return Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
}

export function buildDentalOutreachEmail(fill: DentalFill, offer: string, calendarLink?: string): string {
  const cityBit = fill.city ? ` in ${fill.city}` : '';
  const ratingBit = fill.rating_line ? `, ${fill.rating_line}` : '';
  const offerBit = offer.trim() ? `\n\n${offer.trim()}` : '';
  const close = calendarLink
    ? `If a short call is useful: ${calendarLink}`
    : 'Reply to this email if you want to look.';
  return [
    `Subject: A private page draft for ${fill.name}`,
    '',
    `${fill.name} — I drafted a one-page site from your public listing${cityBit}${ratingBit}.`,
    '',
    'The page uses your real details only. It does not invent treatments, fees, or a team.',
    offerBit,
    '',
    'A private draft is ready when you want to look.',
    '',
    close,
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}
