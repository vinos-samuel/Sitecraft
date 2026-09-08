import { assembleHeadline, assembleRatingLine, rewriteBannedPhrases, serviceName } from './copy';
import { countryForPreset, defaultModules, emptyClaims, extractCity, filterInsurance, inferLocationPreset } from './presets';
import type {
  AccentName,
  DentalFill,
  DentalLeadInput,
  DentalService,
  FillFromLeadOptions,
  LocationPreset,
  ShellMode,
  ShellVariant,
} from './types';

const DENTAL_RE = /\b(dentist|dentists|dental|dentistry|odontolog|orthodont|periodont|endodont|oral\s+surgeon|oral surgery)\b/i;

const SERVICE_PAGE_HINT = /service|menu|price|pricing|treatment/i;
const NAV_HEADING = /^(home|about|contact|blog|news|privacy|login|book now|menu|hours|gallery|our story|testimonials?|welcome)$/i;

export function isDentalLead(lead: DentalLeadInput, businessType?: string): boolean {
  const headings = lead.siteFacts?.pagesFetched.flatMap((p) => [p.title, ...p.headings]) ?? [];
  const blob = [businessType, lead.name, lead.website, lead.offer, ...headings].filter(Boolean).join(' ');
  return DENTAL_RE.test(blob);
}

export function parseRating(raw?: string): number | null {
  if (!raw || raw === 'N/A') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 && n <= 5 ? n : null;
}

export function parseReviewCount(raw?: string): number | null {
  if (!raw || raw === 'N/A') return null;
  const n = Number.parseInt(raw.replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function cleanPhone(raw?: string): string {
  if (!raw || raw === 'N/A') return '';
  return raw.trim();
}

function extractServicesFromFacts(lead: DentalLeadInput): DentalService[] {
  const pages = lead.siteFacts?.pagesFetched ?? [];
  if (pages.length === 0) return [];
  const ordered = [...pages].sort((a, b) => {
    const aFirst = SERVICE_PAGE_HINT.test(a.url) ? 0 : 1;
    const bFirst = SERVICE_PAGE_HINT.test(b.url) ? 0 : 1;
    return aFirst - bFirst;
  });
  const seen = new Set<string>();
  const services: DentalService[] = [];
  for (const page of ordered) {
    for (const raw of page.headings) {
      const heading = rewriteBannedPhrases(raw.replace(/\s+/g, ' ').trim());
      const key = heading.toLowerCase();
      if (!heading || heading.length > 60 || NAV_HEADING.test(heading) || seen.has(key)) continue;
      seen.add(key);
      services.push(heading);
      if (services.length >= 8) return services;
    }
  }
  return services;
}

function extractHours(lead: DentalLeadInput): string {
  const blobs = (lead.siteFacts?.pagesFetched ?? []).map((p) => p.text).join('\n');
  const m = blobs.match(/(?:opening hours|clinic hours|hours)\s*[:\-–]\s*([^\n.]{8,90})/i);
  return m ? rewriteBannedPhrases(m[1].trim()) : '';
}

function extractWhatsApp(lead: DentalLeadInput): string {
  const socials = lead.siteFacts?.socials ?? [];
  const texts = (lead.siteFacts?.pagesFetched ?? []).map((p) => `${p.url} ${p.text}`);
  const blob = [...socials, ...texts].join(' ');
  const url = blob.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp\.com\/send)[^\s"'<>]*/i);
  if (url) return url[0];
  const me = blob.match(/wa\.me\/\+?\d+/i);
  if (me) return `https://${me[0].replace(/^https?:\/\//, '')}`;
  return '';
}

function extractBookingUrl(lead: DentalLeadInput): string {
  const facts = lead.siteFacts;
  if (!facts?.capabilities?.onlineBooking) return '';
  if (facts.capabilities.onlineBooking.status !== 'VERIFIED_PRESENT') return '';
  for (const p of facts.pagesFetched) {
    if (/book|appointment|schedule|reserv/i.test(p.url) && !/wa\.me|whatsapp/i.test(p.url)) {
      return p.url;
    }
  }
  return '';
}

export function normalizeFill(partial: Partial<DentalFill> & { name: string }): DentalFill {
  const variant: ShellVariant = partial.options?.variant ?? 'quiet';
  const locationPreset: LocationPreset = partial.options?.locationPreset ?? 'Generic';
  const mode: ShellMode = partial.options?.mode ?? 'prospect';
  const defaults = defaultModules(variant, locationPreset);
  const services = (partial.services ?? []).filter((s) => serviceName(s).trim());
  const city = (partial.city ?? '').trim();
  const rating = partial.rating ?? null;
  const reviewCount = partial.review_count ?? null;
  const headline = rewriteBannedPhrases(partial.headline || assembleHeadline(city, services));
  const ratingLine = rewriteBannedPhrases(partial.rating_line || assembleRatingLine(rating, reviewCount));
  const claims = { ...emptyClaims(), ...partial.options?.claims };
  const insurance = filterInsurance(partial.insurance ?? [], locationPreset);

  return {
    name: rewriteBannedPhrases(partial.name),
    headline,
    rating_line: ratingLine,
    phone: cleanPhone(partial.phone),
    address: (partial.address ?? '').trim(),
    city,
    whatsapp: (partial.whatsapp ?? '').trim(),
    country: partial.country ?? countryForPreset(locationPreset),
    accent: (partial.accent ?? 'cyan') as AccentName,
    services,
    rating,
    review_count: reviewCount,
    booking_url: (partial.booking_url ?? '').trim(),
    hours: (partial.hours ?? '').trim(),
    insurance,
    payment_note: rewriteBannedPhrases(partial.payment_note ?? ''),
    team: (partial.team ?? []).filter((t) => t.name?.trim()),
    reviews: (partial.reviews ?? []).filter((r) => r.quote?.trim()),
    faq: (partial.faq ?? []).filter((f) => f.question?.trim() && f.answer?.trim()),
    hero_image: (partial.hero_image ?? '').trim(),
    medisave_note: claims.medisave ? (partial.medisave_note ?? '').trim() : '',
    chas_note: claims.chas ? (partial.chas_note ?? '').trim() : '',
    options: {
      variant,
      locationPreset,
      modules: { ...defaults, ...partial.options?.modules },
      claims,
      ctaPolicy: partial.options?.ctaPolicy ?? 'auto',
      servicesMode: partial.options?.servicesMode ?? (services.length ? 'listed' : 'generic'),
      mode,
      designerNote: mode === 'designer' ? partial.options?.designerNote : undefined,
    },
  };
}

/**
 * Prospect FILL from stored facts only. Empty arrays stay empty —
 * the renderer omits those sections. Claims stay off.
 */
export function fillFromLead(lead: DentalLeadInput, opts: FillFromLeadOptions = {}): DentalFill {
  // No clinic-photo pipeline — Quiet is the prospect default (no-website / weak-photo leads).
  const variant = opts.variant ?? 'quiet';
  const locationPreset = opts.locationPreset
    ?? inferLocationPreset(`${lead.address ?? ''} ${lead.name}`, lead.phone ?? '');
  const services = extractServicesFromFacts(lead);
  const city = extractCity(lead.address ?? '', opts.cityHint);
  const rating = parseRating(lead.rating);
  const reviewCount = parseReviewCount(lead.reviewsCount);

  return normalizeFill({
    name: lead.name,
    phone: cleanPhone(lead.phone),
    address: lead.address ?? '',
    city,
    whatsapp: extractWhatsApp(lead),
    accent: opts.accent ?? 'cyan',
    services,
    rating,
    review_count: reviewCount,
    booking_url: extractBookingUrl(lead),
    hours: extractHours(lead),
    insurance: [],
    payment_note: '',
    team: [],
    reviews: [],
    faq: [],
    hero_image: '',
    medisave_note: '',
    chas_note: '',
    options: {
      variant,
      locationPreset,
      modules: { ...defaultModules(variant, locationPreset), ...opts.modules },
      claims: { ...emptyClaims(), ...opts.claims },
      ctaPolicy: opts.ctaPolicy ?? 'auto',
      servicesMode: opts.servicesMode ?? (services.length ? 'listed' : 'generic'),
      mode: opts.mode ?? 'prospect',
      designerNote: opts.designerNote,
    },
  });
}
