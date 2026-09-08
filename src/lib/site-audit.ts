import * as cheerio from 'cheerio';
import { resolveMx } from 'dns/promises';

// ─── Types (PRD.md Phase 1, P1-3) ───────────────────────────────────────────

export type CapabilityStatus = 'VERIFIED_PRESENT' | 'VERIFIED_ABSENT' | 'UNKNOWN';

export interface SiteFacts {
  crawledAt: string;
  pagesFetched: { url: string; title: string; headings: string[]; text: string }[];
  pagesFailed: string[];
  capabilities: {
    onlineBooking: { status: CapabilityStatus; evidence: string };
    contactInfo: { status: CapabilityStatus; evidence: string };
    blog: { status: CapabilityStatus; evidence: string };
    liveChat: { status: CapabilityStatus; evidence: string };
    ecommerce: { status: CapabilityStatus; evidence: string };
  };
  emails: { address: string; source: 'MAILTO' | 'PAGE_TEXT'; mxVerified: boolean }[];
  phones: string[];
  socials: string[];
  copyrightYear: number | null;
  https: boolean;
}

// ─── Third-party service signals (P1-2) ─────────────────────────────────────
// Matched as plain substrings against raw (unstripped) page HTML — covers
// script/iframe/link src+href regardless of how the site embeds the widget.

const BOOKING_DOMAINS = [
  'mindbodyonline', 'fresha', 'calendly', 'squareup', 'square.site',
  'acuityscheduling', 'janeapp', 'vagaro', 'booksy', 'setmore',
  'gettimely', 'glofox', 'opentable', 'resy', 'momence', 'walla',
  'wellnessliving', 'zenoti', 'simplybook',
];
const CHAT_DOMAINS = ['intercom', 'tawk.to', 'crisp.chat', 'tidio', 'drift', 'livechat'];
const ECOMMERCE_DOMAINS = ['shopify', 'woocommerce', 'bigcommerce'];
const SOCIAL_DOMAINS = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com'];

const BOOKING_INTENT_TEXT = /\b(book now|book online|make an appointment|reserve (a|your) (table|spot|seat))\b/i;
const BLOG_WORD = /\bblog\b|\bnews\b/i;

// Subpage discovery: any same-domain link whose path looks like one of these.
const SUBPAGE_KEYWORDS = /book|appointment|schedule|reserv|contact|about|service|menu|price|pricing|blog|news|shop|store/i;
const BOOKING_PAGE_KEYWORDS = /book|appointment|schedule|reserv/i;
const CONTACT_PAGE_KEYWORDS = /contact|about/i;
const BLOG_PAGE_KEYWORDS = /blog|news/i;

const MAX_SUBPAGES = 5;
const HOME_TIMEOUT_MS = 10000;
const SUBPAGE_TIMEOUT_MS = 8000;
const DNS_TIMEOUT_MS = 5000;
const UA = 'Mozilla/5.0 (compatible; OmniLeadBot/1.0; +sales research)';

// ─── Low-level fetch ─────────────────────────────────────────────────────────

interface FetchedPage {
  url: string;
  ok: boolean;
  html: string;
}

async function fetchPage(url: string, timeoutMs: number): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) return { url, ok: false, html: '' };
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return { url, ok: false, html: '' };
    const html = (await res.text()).slice(0, 400000);
    return { url, ok: true, html };
  } catch {
    return { url, ok: false, html: '' };
  } finally {
    clearTimeout(timeout);
  }
}

function sameHost(a: string, b: string): boolean {
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return norm(a) === norm(b);
}

// ─── Subpage link discovery (P1-1) ──────────────────────────────────────────

interface SubLink {
  url: string;
  categories: ('booking' | 'contact' | 'blog')[];
}

function discoverSubpageLinks($: cheerio.CheerioAPI, baseUrl: string): SubLink[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: SubLink[] = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (!sameHost(abs.hostname, base.hostname)) return;
    abs.hash = '';
    if (abs.pathname === '/' || abs.pathname === '') return; // that's the homepage itself
    if (!SUBPAGE_KEYWORDS.test(abs.pathname)) return;

    const key = abs.toString();
    if (seen.has(key)) return;
    seen.add(key);

    const categories: SubLink['categories'] = [];
    if (BOOKING_PAGE_KEYWORDS.test(abs.pathname)) categories.push('booking');
    if (CONTACT_PAGE_KEYWORDS.test(abs.pathname)) categories.push('contact');
    if (BLOG_PAGE_KEYWORDS.test(abs.pathname)) categories.push('blog');
    links.push({ url: key, categories });
  });

  return links.slice(0, MAX_SUBPAGES);
}

// ─── Capability resolution ───────────────────────────────────────────────────

function domainSignal(rawHtml: string, domains: string[]): string | null {
  const lower = rawHtml.toLowerCase();
  for (const d of domains) {
    if (lower.includes(d)) return d;
  }
  return null;
}

function resolveCapability(opts: {
  present: boolean;
  presentEvidence: string;
  homeOk: boolean;
  category: 'booking' | 'contact' | 'blog' | null; // null = sitewide widget check, no dedicated subpage
  attempted: Set<string>;
  succeeded: Set<string>;
}): { status: CapabilityStatus; evidence: string } {
  if (opts.present) return { status: 'VERIFIED_PRESENT', evidence: opts.presentEvidence };
  if (!opts.homeOk) return { status: 'UNKNOWN', evidence: 'homepage could not be fetched' };

  if (opts.category && opts.attempted.has(opts.category) && !opts.succeeded.has(opts.category)) {
    return { status: 'UNKNOWN', evidence: `found a likely ${opts.category} page but it could not be loaded` };
  }
  if (opts.category && opts.attempted.has(opts.category)) {
    return { status: 'VERIFIED_ABSENT', evidence: `checked home + ${opts.category} page — no signal found` };
  }
  return { status: 'VERIFIED_ABSENT', evidence: 'checked home — no signal found, no dedicated page linked either' };
}

// ─── Email / phone extraction (P1-4 — real discovery, no guessing) ─────────

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_JUNK = ['.png@', '.jpg@', '.jpeg@', '.gif@', '.svg@', '.webp@', 'example.', 'sentry', 'wixpress', 'godaddy', 'schema.org'];

function isJunkEmail(addr: string): boolean {
  const lower = addr.toLowerCase();
  return EMAIL_JUNK.some((j) => lower.includes(j));
}

async function verifyMx(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), DNS_TIMEOUT_MS)),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

function emptyCapabilities(evidence: string): SiteFacts['capabilities'] {
  const unknown = { status: 'UNKNOWN' as const, evidence };
  return {
    onlineBooking: unknown,
    contactInfo: unknown,
    blog: unknown,
    liveChat: unknown,
    ecommerce: unknown,
  };
}

/**
 * Crawls a business's real website (homepage + up to 5 relevant subpages) and
 * returns verifiable facts about what it does and doesn't have. This is the
 * grounding source for every claim the app makes about a prospect's site —
 * a capability may only be described as "missing" downstream if it comes
 * back VERIFIED_ABSENT here. UNKNOWN must never be reported as absent.
 */
export async function crawlSite(url: string): Promise<SiteFacts> {
  const crawledAt = new Date().toISOString();
  const https = url.startsWith('https://');

  const home = await fetchPage(url, HOME_TIMEOUT_MS);
  if (!home.ok) {
    return {
      crawledAt,
      pagesFetched: [],
      pagesFailed: [url],
      capabilities: emptyCapabilities('homepage could not be fetched — blocked, timed out, or unreachable'),
      emails: [],
      phones: [],
      socials: [],
      copyrightYear: null,
      https,
    };
  }

  const $home = cheerio.load(home.html);
  const subLinks = discoverSubpageLinks($home, home.url);
  const subFetches = await Promise.allSettled(subLinks.map((l) => fetchPage(l.url, SUBPAGE_TIMEOUT_MS)));

  const pagesFailed: string[] = [];
  const attempted = new Set<string>();
  const succeeded = new Set<string>();
  const successPages: { link: SubLink | null; fetched: FetchedPage }[] = [{ link: null, fetched: home }];

  subLinks.forEach((link, i) => {
    link.categories.forEach((c) => attempted.add(c));
    const result = subFetches[i];
    const fetched = result.status === 'fulfilled' ? result.value : { url: link.url, ok: false, html: '' };
    if (fetched.ok) {
      successPages.push({ link, fetched });
      link.categories.forEach((c) => succeeded.add(c));
    } else {
      pagesFailed.push(link.url);
    }
  });

  // Per-page extraction: widget/domain signals must be read from RAW html
  // before we strip <script>/<style> for readable text (P1-2).
  const pagesFetched: SiteFacts['pagesFetched'] = [];
  const rawHtmlBlobs: string[] = [];
  const telSet = new Set<string>();
  const mailtoSet = new Set<string>();
  const socialSet = new Set<string>();
  const textBlobs: string[] = [];

  let bookingDomain: string | null = null;
  let bookingIntent = false;
  let chatDomain: string | null = null;
  let ecommDomain: string | null = null;
  let blogSignal = false;

  for (const { fetched } of successPages) {
    rawHtmlBlobs.push(fetched.html);
    if (!bookingDomain) bookingDomain = domainSignal(fetched.html, BOOKING_DOMAINS);
    if (!bookingIntent && BOOKING_INTENT_TEXT.test(fetched.html)) bookingIntent = true;
    if (!chatDomain) chatDomain = domainSignal(fetched.html, CHAT_DOMAINS);
    if (!ecommDomain) ecommDomain = domainSignal(fetched.html, ECOMMERCE_DOMAINS);

    const $p = cheerio.load(fetched.html);

    $p('a[href^="tel:"]').each((_, el) => {
      const v = $p(el).attr('href')?.replace(/^tel:/, '').trim();
      if (v) telSet.add(v);
    });
    $p('a[href^="mailto:"]').each((_, el) => {
      const v = $p(el).attr('href')?.replace(/^mailto:/, '').split('?')[0].trim().toLowerCase();
      if (v && v.includes('@')) mailtoSet.add(v);
    });
    $p('a[href]').each((_, el) => {
      const href = ($p(el).attr('href') ?? '').trim();
      const lower = href.toLowerCase();
      if (SOCIAL_DOMAINS.some((d) => lower.includes(d))) socialSet.add(href);
      if (lower.includes('wa.me') || lower.includes('whatsapp.com/send') || lower.includes('api.whatsapp.com')) {
        socialSet.add(href);
      }
    });
    const waInHtml = fetched.html.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp\.com\/send)[^\s"'<>]*/i);
    if (waInHtml) socialSet.add(waInHtml[0]);

    if (!blogSignal && BLOG_WORD.test(fetched.html)) blogSignal = true;

    $p('script, style, noscript, svg').remove();
    const title = $p('title').first().text().trim();
    const headings = $p('h1, h2, h3').map((_, el) => $p(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 15);
    const bodyText = $p('body').text().replace(/\s+/g, ' ').trim().slice(0, 2500);
    textBlobs.push(bodyText);
    pagesFetched.push({ url: fetched.url, title, headings, text: bodyText });
  }

  // ── Emails ──────────────────────────────────────────────────────────────
  const siteDomain = new URL(home.url).hostname.replace(/^www\./, '');
  const pageTextEmails = new Set<string>();
  for (const blob of textBlobs) {
    const matches = blob.match(EMAIL_REGEX) ?? [];
    matches.forEach((m) => pageTextEmails.add(m.toLowerCase()));
  }

  const candidates: { address: string; source: 'MAILTO' | 'PAGE_TEXT' }[] = [
    ...Array.from(mailtoSet).map((address) => ({ address, source: 'MAILTO' as const })),
    ...Array.from(pageTextEmails)
      .filter((a) => !mailtoSet.has(a))
      .map((address) => ({ address, source: 'PAGE_TEXT' as const })),
  ].filter((c) => !isJunkEmail(c.address));

  const sameDomainCandidates = candidates.filter((c) => c.address.split('@')[1]?.replace(/^www\./, '') === siteDomain);
  const finalCandidates = (sameDomainCandidates.length > 0 ? sameDomainCandidates : candidates).slice(0, 5);

  const mxCache = new Map<string, boolean>();
  const emails: SiteFacts['emails'] = [];
  for (const c of finalCandidates) {
    const domain = c.address.split('@')[1];
    if (!domain) continue;
    if (!mxCache.has(domain)) mxCache.set(domain, await verifyMx(domain));
    emails.push({ address: c.address, source: c.source, mxVerified: mxCache.get(domain) ?? false });
  }
  // MAILTO first, then MX-verified before unverified — best candidate is emails[0].
  emails.sort((a, b) => {
    if (a.source !== b.source) return a.source === 'MAILTO' ? -1 : 1;
    if (a.mxVerified !== b.mxVerified) return a.mxVerified ? -1 : 1;
    return 0;
  });

  // ── Copyright year ─────────────────────────────────────────────────────
  let copyrightYear: number | null = null;
  for (const blob of textBlobs) {
    const m = blob.match(/(?:©|copyright)\D{0,10}(19\d{2}|20\d{2})/i);
    if (m) { copyrightYear = parseInt(m[1], 10); break; }
  }

  // ── Capabilities ────────────────────────────────────────────────────────
  const homeOk = true; // we returned early above if home failed
  const phones = Array.from(telSet).slice(0, 3);

  const capabilities: SiteFacts['capabilities'] = {
    onlineBooking: resolveCapability({
      present: !!bookingDomain || bookingIntent,
      presentEvidence: bookingDomain ? `${bookingDomain} booking widget found` : 'a "book now" style call-to-action found on the site',
      homeOk, category: 'booking', attempted, succeeded,
    }),
    contactInfo: resolveCapability({
      present: emails.length > 0 || phones.length > 0,
      presentEvidence: emails.length > 0 && phones.length > 0
        ? 'phone number and email address found'
        : emails.length > 0 ? 'email address found' : 'phone number found',
      homeOk, category: 'contact', attempted, succeeded,
    }),
    blog: resolveCapability({
      present: succeeded.has('blog') || blogSignal,
      presentEvidence: 'a blog/news section or link found on the site',
      homeOk, category: 'blog', attempted, succeeded,
    }),
    liveChat: resolveCapability({
      present: !!chatDomain,
      presentEvidence: `${chatDomain} chat widget found`,
      homeOk, category: null, attempted, succeeded,
    }),
    ecommerce: resolveCapability({
      present: !!ecommDomain,
      presentEvidence: `${ecommDomain} store detected`,
      homeOk, category: null, attempted, succeeded,
    }),
  };

  return {
    crawledAt,
    pagesFetched,
    pagesFailed,
    capabilities,
    emails,
    phones,
    socials: Array.from(socialSet).slice(0, 5),
    copyrightYear,
    https,
  };
}

// ─── Prompt rendering helper ──────────────────────────────────────────────

/**
 * Renders SiteFacts into prompt text for the pain-point/outreach models. The
 * one rule that matters: only a "confirmed absent" line may be described as
 * missing downstream — "not checked" must never be turned into a claim.
 */
export function describeSiteFacts(siteFacts: SiteFacts | null): string {
  if (!siteFacts) {
    return 'This business has no website at all.';
  }
  if (siteFacts.pagesFetched.length === 0) {
    return "Could not read their current website (blocked or unreachable) — do not assume it lacks anything, just don't claim to know what it does or doesn't have.";
  }

  const labels: Record<keyof SiteFacts['capabilities'], string> = {
    onlineBooking: 'Online booking',
    contactInfo: 'Contact info',
    blog: 'Blog/articles',
    liveChat: 'Live chat',
    ecommerce: 'Online store',
  };

  const capLines = (Object.keys(siteFacts.capabilities) as (keyof SiteFacts['capabilities'])[]).map((key) => {
    const cap = siteFacts.capabilities[key];
    const verdict = cap.status === 'VERIFIED_PRESENT' ? 'confirmed present'
      : cap.status === 'VERIFIED_ABSENT' ? 'confirmed absent'
      : 'not checked — do not mention this one either way';
    return `- ${labels[key]}: ${verdict} — ${cap.evidence}`;
  });

  const pageLines = siteFacts.pagesFetched
    .slice(0, 6)
    .map((p) => `[${p.url}] ${p.title ? `Title: ${p.title} | ` : ''}${p.headings.length > 0 ? `Headings: ${p.headings.join(' | ')}` : ''}`);

  return [
    `Their real website was crawled (${siteFacts.pagesFetched.length} page(s) checked, ${siteFacts.pagesFailed.length} could not be loaded). Verified facts below — only describe something as missing if it says "confirmed absent"; if it says "not checked", say nothing about it either way:`,
    ...capLines,
    '',
    'Page content found:',
    ...pageLines,
  ].join('\n');
}
