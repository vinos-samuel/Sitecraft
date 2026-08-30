import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { SiteFacts, describeSiteFacts } from './site-audit';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'fake_key_to_allow_build',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScrapedLead {
  id: string;
  placeId?: string;               // Google Place ID — used to dedupe across scans
  name: string;
  rating: string;
  reviewsCount: string;
  phone: string;
  website: string;
  address: string;
  emails: string[];
  emailSource?: 'SCRAPED_MX_VERIFIED' | 'SCRAPED_NO_MX' | 'MANUAL' | null; // never a guess — see site-audit.ts
  socials: string[];
  painPoints: string[];          // business/customer-service issues, from review text
  websiteQualityScore: number;      // 1-5 triage score — design score when confident, else the performance bucket
  mobileScore: number | null;       // 0-100, PageSpeed performance score (mobile); null = test failed/not run
  desktopScore: number | null;      // 0-100, PageSpeed performance score (desktop); null = test failed/not run
  designScore?: number | null;      // 1-5, vision assessment of the actual rendered screenshot; null = couldn't judge
  designReasons?: string[];         // short concrete visual observations backing the design score
  websiteIssues: string[];       // concrete, verified reasons for the score
  siteFacts?: SiteFacts | null;     // multi-page crawl results — the grounding source for every claim
  lat: number;
  lng: number;
  outreachEmail?: string;
  landingPageHtml?: string;
}

// Directory / social URLs that Google often returns as "the website."
// These are listings, not a site we can redesign — treat as no website.
const NOT_A_REAL_SITE = [
  'facebook.com', 'fb.com', 'instagram.com', 'yelp.com', 'yellowpages.com',
  'tripadvisor.', 'bbb.org', 'google.com', 'goo.gl', 'maps.app.goo.gl',
  'linktr.ee', 'linktree.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'thumbtack.com', 'angi.com', 'nextdoor.com', 'foursquare.com',
  'hotfrog.',
];

export function isRealBusinessWebsite(url: string | null | undefined): boolean {
  if (!url) return false;
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  return !NOT_A_REAL_SITE.some((d) => host.includes(d));
}

function opportunityRank(lead: ScrapedLead): number {
  // Lower = more likely to need a site. Places ranks by prominence, which
  // surfaces chains with polished sites first — the opposite of this product.
  const reviews = Number.parseInt(lead.reviewsCount, 10) || 0;
  const noSite = !isRealBusinessWebsite(lead.website) ? 0 : 1;
  return noSite * 100000 + reviews;
}

// ─── Google Places API ────────────────────────────────────────────────────────

/**
 * Calls the Google Places Text Search (New) API to find real business listings.
 * Never invents businesses — a missing key or API error fails loudly so the
 * operator is not looking at "Elite Dentists of Austin" thinking they are real.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var.
 */
export async function liveScrapeGoogleMaps(
  businessType: string,
  city: string,
  onProgress: (msg: string, data?: any) => void
): Promise<ScrapedLead[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // ── Geocode the city so we can pin the search to that metro ──────────────
  let cityLat: number | null = null;
  let cityLng: number | null = null;
  try {
    onProgress(`Finding ${city} on the map...`);
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(city)}`,
      { headers: { 'User-Agent': 'OmniLead-App/2.0 (sales research)' } }
    );
    const geoData = await geoRes.json();
    if (geoData?.length > 0) {
      cityLat = parseFloat(geoData[0].lat);
      cityLng = parseFloat(geoData[0].lon);
      onProgress(`Searching near ${city} (${cityLat.toFixed(3)}, ${cityLng.toFixed(3)}).`);
    } else {
      onProgress(`Could not pin ${city} on the map — searching by name only. Add the state (e.g. "Austin, Texas") if results look wrong.`);
    }
  } catch {
    onProgress(`Could not pin ${city} on the map — searching by name only.`);
  }

  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not set. Add it in the environment and run the scan again — the app will not invent fake businesses.');
  }

  onProgress(`Asking Google for "${businessType}" near ${city}...`);

  const searchBody: Record<string, unknown> = {
    textQuery: `${businessType} in ${city}`,
    maxResultCount: 20,
    languageCode: 'en',
  };
  // Bias only when geocode worked — a Singapore default used to leak in when
  // geocoding failed, which is how a US city search could return the wrong metro.
  if (cityLat != null && cityLng != null) {
    searchBody.locationBias = {
      circle: { center: { latitude: cityLat, longitude: cityLng }, radius: 28000.0 },
    };
  }

  const searchRes = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.rating',
          'places.userRatingCount',
          'places.location',
          'places.reviews',
        ].join(','),
      },
      body: JSON.stringify(searchBody),
    }
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(
      `Google Places could not search (${searchRes.status}). Check GOOGLE_PLACES_API_KEY and that the Places API (New) is enabled. ${errText.slice(0, 220)}`
    );
  }

  const searchData = await searchRes.json();
  const places: any[] = searchData.places ?? [];

  if (places.length === 0) {
    onProgress(`Google found no "${businessType}" in ${city}. Try a shorter Maps category (e.g. "Dentists") or a more specific city ("Austin, Texas").`);
    return [];
  }

  const mapped: ScrapedLead[] = [];
  for (const [i, place] of places.entries()) {
    const loc = place.location ?? {};
    const lat = typeof loc.latitude === 'number' ? loc.latitude : cityLat;
    const lng = typeof loc.longitude === 'number' ? loc.longitude : cityLng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      onProgress(`Skipped ${place.displayName?.text ?? 'a listing'} — Google did not send a map location for it.`);
      continue;
    }

    const reviewTexts: string[] = (place.reviews ?? [])
      .map((r: any) => r.originalText?.text ?? r.text?.text ?? '')
      .filter(Boolean)
      .slice(0, 5);

    mapped.push({
      id: place.id ?? `places_${i}`,
      placeId: place.id ?? undefined,
      name: place.displayName?.text ?? 'Unknown Business',
      rating: String(place.rating ?? 'N/A'),
      reviewsCount: String(place.userRatingCount ?? 0),
      phone: place.internationalPhoneNumber ?? 'N/A',
      website: place.websiteUri ?? '',
      address: place.formattedAddress ?? city,
      emails: [],
      socials: [],
      painPoints: reviewTexts.length > 0 ? reviewTexts : [],
      websiteQualityScore: 0,
      mobileScore: null,
      desktopScore: null,
      websiteIssues: [],
      lat,
      lng,
    });
  }

  // Prominence ranking returns the famous/polished listings first. Re-rank for
  // this product: no real website, then smaller shops (fewer reviews).
  mapped.sort((a, b) => opportunityRank(a) - opportunityRank(b));
  const leads = mapped.slice(0, 10);

  const noSite = leads.filter((l) => !isRealBusinessWebsite(l.website)).length;
  onProgress(
    `Google returned ${mapped.length} listings. Kept the 10 most likely to need a site` +
      (noSite > 0 ? ` (${noSite} have no real website — Facebook/Yelp listings count as none)` : '') +
      '. Big polished chains are deprioritized.',
    leads
  );

  return leads;
}

// ─── AI Analysis (reviews + a real look at the current site) ──────────────────

/**
 * Uses OpenAI to find operational pain points (e.g. "patients complain about
 * hold times") from customer reviews — grounded against the business's real
 * current website (passed in as `siteFacts`, from a multi-page crawl — see
 * site-audit.ts) so it can't claim something is missing that's clearly there.
 * Website *technical* quality is a separate, PageSpeed-based signal — see
 * assessWebsiteQuality() below. Contact email is never touched here — real
 * email discovery happens deterministically from the crawl, not by guessing;
 * see crawlSite() in site-audit.ts and how scrape/route.ts wires it in.
 * If no API key, falls back to using the raw review snippets as-is.
 */
export async function analyzeWebsiteAndReviews(
  lead: ScrapedLead,
  siteFacts: SiteFacts | null,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  onProgress(`[AI Agent] Reading customer reviews for ${lead.name}...`);

  if (!process.env.OPENAI_API_KEY) {
    lead.painPoints = lead.painPoints.length > 0
      ? lead.painPoints.slice(0, 2)           // use raw review snippets as placeholders
      : ['No review data available.'];
    onProgress(`[AI Agent] Heuristic review pass done for ${lead.name}.`);
    return lead;
  }

  try {
    const reviewContext = lead.painPoints.length > 0
      ? `Recent customer reviews:\n${lead.painPoints.map(r => `- "${r}"`).join('\n')}`
      : 'No review text available.';

    const siteContext = describeSiteFacts(siteFacts);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `You are a sales analyst. Read this business's customer reviews AND the verified facts about their real current website below, then respond in JSON.

Business: ${lead.name}
Website: ${lead.website || 'none'}
Rating: ${lead.rating} (${lead.reviewsCount} reviews)
${reviewContext}

${siteContext}

Respond ONLY with JSON matching this exact shape:
{
  "painPoints": [<2-3 specific operational friction points inferred from the reviews (e.g. booking difficulty, response speed, appointment reminders) — phrase each as a respectful observation and business opportunity, NEVER as a criticism of staff, service quality, or an insult. This will be read by a stranger receiving cold outreach. NOT about the website's technical performance. CRITICAL: only reference a website capability as missing if the verified facts above mark it "confirmed absent". Never mention a capability marked "not checked" in either direction, and never contradict one marked "confirmed present" — that would be a factually wrong, easily-disproven claim to a real business owner. If reviews are uniformly positive and nothing above supports a real pain point, it is fine and expected to return an empty array rather than invent one.>]
}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    lead.painPoints = Array.isArray(res.painPoints) ? res.painPoints : lead.painPoints.slice(0, 2);

    onProgress(`[AI Agent] Review analysis complete for ${lead.name}.`);
  } catch (err: any) {
    onProgress(`[AI Agent] Review analysis error for ${lead.name}: ${err.message}.`);
    if (lead.painPoints.length === 0) {
      lead.painPoints = ['Could not extract specific pain points.'];
    }
  }

  return lead;
}

// ─── Website Quality (Google PageSpeed Insights) ───────────────────────────────

const PSI_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

async function runPageSpeed(url: string, strategy: 'mobile' | 'desktop', apiKey?: string) {
  const params = new URLSearchParams({ url, strategy });
  PSI_CATEGORIES.forEach((c) => params.append('category', c));
  if (apiKey) params.set('key', apiKey);

  // Heavy marketing/portfolio sites can genuinely take 25-30s in Lighthouse;
  // give real room before giving up, without stalling the whole scan forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`API error ${res.status}${errBody ? `: ${errBody.slice(0, 150)}` : ''}`);
    }
    return await res.json();
  } catch (err: any) {
    if (err.name === 'AbortError') throw new Error('timed out after 35s');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function scoreToInt(score: number | null | undefined): number {
  return score == null ? 0 : Math.round(score * 100);
}

// Mobile-weighted: most local-business searches happen on a phone. Falls back
// to whichever strategy actually succeeded if the other one failed.
function bucketTriageScore(mobilePct: number | null, desktopPct: number | null): number {
  let blended: number;
  if (mobilePct != null && desktopPct != null) blended = mobilePct * 0.7 + desktopPct * 0.3;
  else if (mobilePct != null) blended = mobilePct;
  else if (desktopPct != null) blended = desktopPct;
  else return 2;

  if (blended >= 90) return 5;
  if (blended >= 75) return 4;
  if (blended >= 55) return 3;
  if (blended >= 35) return 2;
  return 1;
}

function extractIssues(lighthouseResult: any): { title: string; score: number }[] {
  const audits = lighthouseResult?.audits ?? {};
  return Object.values(audits)
    .filter((a: any) => typeof a.score === 'number' && a.score < 0.9 && a.title)
    .map((a: any) => ({ title: a.title as string, score: a.score as number }));
}

// ─── Design Quality (vision score on the real rendered screenshot) ─────────

/**
 * Scores what the site actually LOOKS like, using the screenshot PageSpeed
 * already captures while running Lighthouse — not a proxy like load speed.
 * This is the fix for the failure mode where a modern, professionally
 * designed site (busy with booking widgets, so it scores poorly on raw
 * performance) reads as a good pitch target, while a dated-but-fast site
 * gets auto-rejected as "already good." Judges visual design only — never
 * infers missing features from the screenshot; capability claims (booking,
 * blog, etc.) come exclusively from the verified crawl in site-audit.ts.
 */
async function assessDesign(
  screenshotDataUri: string
): Promise<{ designScore: number | null; reasons: string[]; confident: boolean }> {
  if (!process.env.OPENAI_API_KEY) {
    return { designScore: null, reasons: [], confident: false };
  }
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Rate this website's VISUAL DESIGN quality from this screenshot alone, on a 1-5 scale:
1 = broken or ancient (default system fonts, no real mobile layout, walls of unstyled text, looks abandoned)
2 = weak — dated template, poor spacing/hierarchy, amateur execution
3 = functional but visibly dated, cluttered, or generic — gets the job done, nothing more
4 = solid — modern, clean, professional, minor rough edges
5 = excellent — modern, clearly designed this decade, polished and considered

Judge ONLY what is visible in this screenshot — layout, typography, spacing, colors, how dated or current it looks. Do NOT guess at features you can't see (booking systems, blogs, contact forms) — that is handled separately from real verified data, not from this image.

If the screenshot is blank, corrupted, or too unclear to judge, set "confident": false and "designScore": null instead of guessing.

Respond ONLY with JSON: { "designScore": 1-5 or null, "reasons": ["<=3 short concrete visual observations that justify the score>"], "confident": true or false }`,
            },
            { type: 'image_url', image_url: { url: screenshotDataUri } },
          ] as any,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    const score = typeof res.designScore === 'number' && res.designScore >= 1 && res.designScore <= 5
      ? Math.round(res.designScore)
      : null;
    return {
      designScore: res.confident !== false ? score : null,
      reasons: Array.isArray(res.reasons) ? res.reasons.slice(0, 3) : [],
      confident: res.confident !== false && score != null,
    };
  } catch {
    return { designScore: null, reasons: [], confident: false };
  }
}

/**
 * Runs Google PageSpeed Insights (Lighthouse) against the lead's real website,
 * for both mobile and desktop. Produces a verifiable 1-5 triage score plus
 * concrete, named reasons — not an AI guess based on star ratings.
 *
 * Requires: GOOGLE_PLACES_API_KEY also works here (same Google Cloud project)
 * as long as "PageSpeed Insights API" is enabled on it.
 */
export async function assessWebsiteQuality(
  lead: ScrapedLead,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  if (!isRealBusinessWebsite(lead.website)) {
    lead.mobileScore = null;
    lead.desktopScore = null;
    lead.designScore = null;
    lead.designReasons = [];
    lead.websiteQualityScore = 1;
    lead.websiteIssues = lead.website
      ? [`Their Google listing points at ${lead.website} — a directory or social page, not a real website. Strongest kind of lead.`]
      : ['No website found for this business — they are invisible to anyone searching online.'];
    onProgress(`[PageSpeed] ${lead.name} has no real website. Score: 1/5.`);
    return lead;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  onProgress(`[PageSpeed] Testing ${lead.name}'s website (mobile + desktop)...`);

  // Mobile and desktop run independently — one strategy failing (timeout, rate
  // limit, a heavy page) must not discard a successful result from the other,
  // which is what a single Promise.all + one catch block used to do.
  const [mobileResult, desktopResult] = await Promise.allSettled([
    runPageSpeed(lead.website, 'mobile', apiKey),
    runPageSpeed(lead.website, 'desktop', apiKey),
  ]);

  const mobilePct = mobileResult.status === 'fulfilled'
    ? scoreToInt(mobileResult.value?.lighthouseResult?.categories?.performance?.score)
    : null;
  const desktopPct = desktopResult.status === 'fulfilled'
    ? scoreToInt(desktopResult.value?.lighthouseResult?.categories?.performance?.score)
    : null;

  // Real design quality, judged from the actual rendered screenshot Lighthouse
  // already captures — mobile preferred (matches how most prospects will see
  // it), falling back to desktop if only that run succeeded.
  const screenshot =
    (mobileResult.status === 'fulfilled' && mobileResult.value?.lighthouseResult?.audits?.['final-screenshot']?.details?.data) ||
    (desktopResult.status === 'fulfilled' && desktopResult.value?.lighthouseResult?.audits?.['final-screenshot']?.details?.data) ||
    null;
  const design = screenshot ? await assessDesign(screenshot) : { designScore: null, reasons: [], confident: false };
  lead.designScore = design.designScore;
  lead.designReasons = design.reasons;

  // Merge real issues from whichever runs succeeded, worst-first, deduped, capped at 5.
  const combined = [
    ...(mobileResult.status === 'fulfilled' ? extractIssues(mobileResult.value?.lighthouseResult) : []),
    ...(desktopResult.status === 'fulfilled' ? extractIssues(desktopResult.value?.lighthouseResult) : []),
  ].sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const item of combined) {
    if (seen.has(item.title)) continue;
    seen.add(item.title);
    issues.push(item.title);
    if (issues.length >= 5) break;
  }

  // A failed strategy isn't proof the site is broken — surface the real reason
  // (visible for debugging) but don't let it read as a confirmed site defect.
  if (mobileResult.status === 'rejected') {
    issues.unshift(`Mobile test failed (${mobileResult.reason?.message ?? 'unknown error'}) — not a confirmed site issue, just unverified.`);
  }
  if (desktopResult.status === 'rejected') {
    issues.unshift(`Desktop test failed (${desktopResult.reason?.message ?? 'unknown error'}) — not a confirmed site issue, just unverified.`);
  }

  lead.mobileScore = mobilePct;
  lead.desktopScore = desktopPct;
  // The triage score is what qualification acts on — design quality when we
  // have a confident read on it (this is the actual pitch: "your site looks
  // dated"), falling back to the performance bucket only when the vision
  // call couldn't judge the screenshot at all.
  if (design.confident && design.designScore != null) {
    lead.websiteQualityScore = design.designScore;
  } else if (mobilePct == null && desktopPct == null) {
    // 0 = UNTESTED. The old fallback stored 2, which the UI rendered as
    // "SITE 2/5 (perf)" — a real-looking judgment when we never saw the site.
    lead.websiteQualityScore = 0;
  } else {
    lead.websiteQualityScore = bucketTriageScore(mobilePct, desktopPct);
  }
  lead.websiteIssues = issues.length > 0 ? issues.slice(0, 5) : ["No major issues detected — the site passed Google's core checks."];

  const scoreSource = design.confident ? 'design' : (mobilePct == null && desktopPct == null) ? 'untested' : 'performance fallback';
  onProgress(
    scoreSource === 'untested'
      ? `[PageSpeed] ${lead.name}: could not test mobile or desktop — marked UNTESTED, not a quality score.`
      : `[PageSpeed] ${lead.name}: Mobile ${mobilePct ?? 'failed'}, Desktop ${desktopPct ?? 'failed'} → Score ${lead.websiteQualityScore}/5 (${scoreSource})`
  );

  return lead;
}

// ─── Current Website Content ────────────────────────────────────────────────

/**
 * Fetches and reads the lead's actual current website so the "redesign" is
 * genuinely a redesign of what they have — same services, same real details,
 * dramatically better execution — instead of a generic template that happens
 * to mention their name. Best-effort: many sites block bots, time out, or
 * aren't fetchable at all; any failure here just means less context, never
 * a crash.
 */
async function fetchWebsiteContext(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OmniLeadBot/1.0; +sales research)' },
    });
    if (!res.ok) return '';
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return '';

    // Cap how much we read — a redesign needs a sense of the site, not the whole thing.
    const html = (await res.text()).slice(0, 300000);
    const $ = cheerio.load(html);
    $('script, style, noscript, svg').remove();

    const title = $('title').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? '';
    const themeColor = $('meta[name="theme-color"]').attr('content')?.trim() ?? '';
    const headings = $('h1, h2, h3').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 15);
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000);

    if (!title && !bodyText) return '';

    return [
      title && `Page title: ${title}`,
      metaDescription && `Meta description: ${metaDescription}`,
      themeColor && `Brand color hint: ${themeColor}`,
      headings.length > 0 && `Headings on the page: ${headings.join(' | ')}`,
      bodyText && `Visible text (truncated): ${bodyText}`,
    ].filter(Boolean).join('\n');
  } catch {
    return ''; // blocked, timed out, or unreachable — proceed without it
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Site brief (PRD Phase 3, P3-1) — deterministic, no LLM ───────────────

const SERVICE_PAGE_HINT = /service|menu|price|pricing/i;
const NAV_HEADING = /^(home|about|contact|blog|news|privacy|login|book now|menu|hours|gallery|our story|testimonials?)$/i;

export const QA_WARNING_PREFIX = 'OMNILEAD_QA_WARNING:';

export function readQaWarning(html: string | null | undefined): string | null {
  if (!html) return null;
  const m = html.match(/<!--\s*OMNILEAD_QA_WARNING:\s*([\s\S]*?)\s*-->/);
  return m ? m[1].trim() : null;
}

function withQaWarning(html: string, warning: string | null): string {
  const stripped = html.replace(/<!--\s*OMNILEAD_QA_WARNING:[\s\S]*?-->\s*/g, '');
  if (!warning) return stripped;
  return `<!-- ${QA_WARNING_PREFIX} ${warning.replace(/-->/g, '')} -->\n${stripped}`;
}

function extractServices(siteFacts: SiteFacts | null): string[] {
  if (!siteFacts || siteFacts.pagesFetched.length === 0) return [];
  const ordered = [...siteFacts.pagesFetched].sort((a, b) => {
    const aFirst = SERVICE_PAGE_HINT.test(a.url) ? 0 : 1;
    const bFirst = SERVICE_PAGE_HINT.test(b.url) ? 0 : 1;
    return aFirst - bFirst;
  });
  const seen = new Set<string>();
  const services: string[] = [];
  for (const page of ordered) {
    for (const raw of page.headings) {
      const heading = raw.replace(/\s+/g, ' ').trim();
      const key = heading.toLowerCase();
      if (!heading || heading.length > 60 || NAV_HEADING.test(heading) || seen.has(key)) continue;
      seen.add(key);
      services.push(heading);
      if (services.length >= 8) return services;
    }
  }
  return services;
}

interface SiteBrief {
  name: string;
  phone: string;
  address: string;
  ratingLine: string;
  services: string[];
  gaps: { label: string; evidence: string }[];
  painPoints: string[];
  offer: string;
  siteContext: string;
}

function buildSiteBrief(lead: ScrapedLead, offer: string, siteContext: string, hasCrawl: boolean): SiteBrief {
  const services = hasCrawl ? extractServices(lead.siteFacts ?? null) : [];
  const gaps: SiteBrief['gaps'] = [];
  if (hasCrawl && lead.siteFacts) {
    const caps = lead.siteFacts.capabilities;
    if (caps.onlineBooking.status === 'VERIFIED_ABSENT') {
      gaps.push({ label: 'online booking', evidence: caps.onlineBooking.evidence });
    }
    if (caps.liveChat.status === 'VERIFIED_ABSENT') {
      gaps.push({ label: 'live chat', evidence: caps.liveChat.evidence });
    }
    if (caps.blog.status === 'VERIFIED_ABSENT') {
      gaps.push({ label: 'blog / resources', evidence: caps.blog.evidence });
    }
  }
  return {
    name: lead.name,
    phone: lead.phone && lead.phone !== 'N/A' ? lead.phone : '',
    address: lead.address || '',
    ratingLine: lead.rating !== 'N/A' ? `${lead.rating}★ from ${lead.reviewsCount} Google reviews` : '',
    services,
    gaps,
    painPoints: lead.painPoints ?? [],
    offer,
    siteContext,
  };
}

function serializeBrief(brief: SiteBrief): string {
  return [
    'SITE BRIEF (typed facts — do not invent anything that is blank or listed as none):',
    `- Name: ${brief.name}`,
    `- Phone: ${brief.phone || 'none — omit rather than invent'}`,
    `- Address: ${brief.address || 'none — omit rather than invent'}`,
    `- Rating: ${brief.ratingLine || 'none — omit rather than invent'}`,
    `- Services (use ONLY these names; if none, use a generic category line — never invent named services): ${brief.services.length ? brief.services.join(' · ') : 'none extracted'}`,
    `- Capability gaps (the ONLY things you may describe as missing or tease as an add-on): ${brief.gaps.length ? brief.gaps.map((g) => `${g.label} (${g.evidence})`).join(' · ') : 'none — do not add booking/chat/blog teasers'}`,
    `- Review pain points (opportunity language only, not accusations): ${brief.painPoints.length ? brief.painPoints.join(' · ') : 'none'}`,
    `- Offer: ${brief.offer}`,
    '',
    brief.siteContext,
  ].join('\n');
}

type QaViolation = {
  type: 'FABRICATED_FACT' | 'FORBIDDEN_CLAIM' | 'BROKEN_STRUCTURE' | 'MISSING_REAL_FACT';
  detail: string;
};

async function qaLandingPage(html: string, brief: SiteBrief): Promise<QaViolation[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{
      role: 'user',
      content: `You are a fact-checker for a sales demo page. Compare the HTML to the brief. Return JSON only: { "violations": [ { "type": "FABRICATED_FACT" | "FORBIDDEN_CLAIM" | "BROKEN_STRUCTURE" | "MISSING_REAL_FACT", "detail": "..." } ] }.

Flag:
- FABRICATED_FACT: any phone, address, or rating that does not match the brief verbatim (invented numbers/addresses/stars)
- FORBIDDEN_CLAIM: any "missing / no X" claim or add-on teaser whose capability is not in the brief's gap list
- BROKEN_STRUCTURE: unclosed tags, raw markdown fences (\`\`\`), placeholder images, "lorem ipsum"
- MISSING_REAL_FACT: a phone/address/rating that IS in the brief but does not appear in the footer/contact area

If the page is clean, return { "violations": [] }.

BRIEF:
${serializeBrief(brief)}

HTML:
${html.slice(0, 24000)}`,
    }],
    response_format: { type: 'json_object' },
    max_tokens: 800,
  });
  const res = JSON.parse(completion.choices[0].message.content ?? '{}');
  return Array.isArray(res.violations) ? res.violations : [];
}

// ─── Outreach Generation ──────────────────────────────────────────────────────

export async function generateOutreachAssets(
  lead: ScrapedLead,
  offer: string,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  onProgress(`[AI Agent] Building a real demo for ${lead.name}...`);

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it to the environment and try Generate again — the app will not invent a fake demo.');
  }

  const hasVerifiedPsiData = !!lead.website && (lead.mobileScore != null || lead.desktopScore != null);
  const websiteIssuesContext = lead.websiteIssues?.length > 0
    ? hasVerifiedPsiData
      ? `Verified website problems (from Google's own PageSpeed test — cite these specifically):
- Mobile: ${lead.mobileScore != null ? `${lead.mobileScore}/100` : 'test failed'}, Desktop: ${lead.desktopScore != null ? `${lead.desktopScore}/100` : 'test failed'}
${lead.websiteIssues.map((i) => `- ${i}`).join('\n')}`
      : lead.website
        ? `Their website could not be automatically tested. Do NOT claim it is broken, slow, or bad.`
        : `This business has no real website — true and safe to mention.`
    : '';

  const calendarLink = process.env.CALENDAR_LINK;
  const calendarContext = calendarLink
    ? `Booking link: ${calendarLink} — end the email with a low-friction CTA to book using this link.`
    : `No booking link — end with "reply to this email."`;

  const hasCrawl = !!lead.siteFacts && lead.siteFacts.pagesFetched.length > 0;
  let siteContext: string;
  if (hasCrawl) {
    siteContext = describeSiteFacts(lead.siteFacts!) + '\n\nCrawled page excerpts (services/menu/pricing first):\n' +
      [...lead.siteFacts!.pagesFetched]
        .sort((a, b) => (SERVICE_PAGE_HINT.test(a.url) ? 0 : 1) - (SERVICE_PAGE_HINT.test(b.url) ? 0 : 1))
        .slice(0, 6)
        .map((p) => `[${p.url}]\n${p.title ? `Title: ${p.title}\n` : ''}${p.headings.length ? `Headings: ${p.headings.join(' | ')}\n` : ''}${p.text ? `Text: ${p.text.slice(0, 900)}` : ''}`)
        .join('\n\n');
  } else if (isRealBusinessWebsite(lead.website)) {
    onProgress(`[AI Agent] Reading ${lead.name}'s current website...`);
    const fetched = await fetchWebsiteContext(lead.website);
    siteContext = fetched
      ? `Could not use a stored crawl — homepage only:\n${fetched}`
      : `Could not read their current website (blocked or unreachable). Do not invent specific services or claim to know what is on the site.`;
  } else {
    siteContext = 'This business has no real website (none, or only a Facebook/Yelp listing). Design a brand-new site from the brief. Do not invent named services.';
  }

  const brief = buildSiteBrief(lead, offer, siteContext, hasCrawl);
  const gapInstruction = brief.gaps.length > 0
    ? `Add-on teasers — ONLY for these confirmed-absent gaps, as labeled visual previews (not functional widgets), using inline SVG not emoji:\n${brief.gaps.map((g) => `- ${g.label}: ${g.evidence}`).join('\n')}`
    : `Add-on teasers — do NOT include this section. No capability was confirmed absent.`;

  const prompt = `You are a senior brand designer and sales copywriter. The landing page you produce IS the product being sold — a prospect decides whether to reply based on how premium this feels. Do not emit a generic startup template, a purple-on-black block, or three identical cards.

Be respectful. Never insult the business, staff, or service. Only state facts that appear in the brief. Opportunity language for everything else.

${serializeBrief(brief)}
${websiteIssuesContext}
${calendarContext}

Return JSON with exactly two keys:

"outreachEmail": A 3-paragraph cold email. Open with one concrete detail from the brief (a real service name, a real review theme, or the lack of a real website). Mention that a private redesign demo is ready. Start with "Subject: " on line 1. Do not attach or embed any HTML.

"landingPageHtml": A complete one-page HTML document with a <style> block (raw HTML, no markdown fences). Redesign THEIR business — same name, same real services, much higher execution.

Required structure:
1. Top nav with the real business name + a single text CTA
2. Hero — full-bleed, distinctive (geometric inline SVG, split layout, or editorial type). Headline from a real opportunity in the brief. Their real name visible. No fabricated tagline that misrepresents them.
3. Services — one section. If the brief lists services, use those names only. If none, one short generic line for their category. Never invent named treatments/packages.
4. Social proof — only if the brief has a rating line; quote it verbatim
5. "What we'd upgrade" — short, from verified issues / pain points, framed as opportunity
6. ${gapInstruction}
7. Footer/contact — real phone and address from the brief, verbatim, or omit if none

Visual quality floor (all required):
- Distinct hero. Not a colored rectangle with a centered h1.
- Spacing scale via CSS variables: 8 / 16 / 24 / 40 / 64. Consistent, not cramped.
- One accent color family that fits THIS industry (a dental clinic and a hair salon must not share a palette). No default purple-on-dark.
- :hover and :focus-visible on every link and button
- Inline SVG for decorative shapes and icons. No emoji icons. No <img>. No stock-photo URLs.
- Type scale with clamp() so it holds on mobile. System font stack only (no Google Fonts, no external CSS/JS).
- A real mobile @media query (stack the hero, readable tap targets)
- Fully self-contained`;

  try {
    onProgress(`[AI Agent] Designing the demo page (this can take a minute)...`);
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 16000,
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    let html = typeof res.landingPageHtml === 'string' ? res.landingPageHtml : '';
    let email = typeof res.outreachEmail === 'string' ? res.outreachEmail : '';

    if (html.startsWith('```')) {
      html = html.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '');
    }

    onProgress(`[AI Agent] Fact-checking the demo against the real business...`);
    let violations = await qaLandingPage(html, brief);
    if (violations.length > 0) {
      onProgress(`[AI Agent] QA found ${violations.length} issue(s) — repairing once...`);
      const repair = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: `${prompt}

The previous HTML failed QA. Return the same JSON shape, with landingPageHtml corrected for every violation. Do not add new claims.

Violations:
${violations.map((v) => `- ${v.type}: ${v.detail}`).join('\n')}

Previous HTML:
${html.slice(0, 20000)}`,
        }],
        response_format: { type: 'json_object' },
        max_tokens: 16000,
      });
      const repaired = JSON.parse(repair.choices[0].message.content ?? '{}');
      if (typeof repaired.landingPageHtml === 'string' && repaired.landingPageHtml.trim()) {
        html = repaired.landingPageHtml.replace(/^```(?:html)?\n?/i, '').replace(/\n?```$/i, '');
      }
      if (typeof repaired.outreachEmail === 'string' && repaired.outreachEmail.trim()) {
        email = repaired.outreachEmail;
      }
      violations = await qaLandingPage(html, brief);
    }

    const warning = violations.length > 0
      ? `QA found issues — review before deploying: ${violations.map((v) => v.detail).join('; ')}`
      : null;

    lead.outreachEmail = email;
    lead.landingPageHtml = withQaWarning(html, warning);
    onProgress(warning ? `[AI Agent] Demo saved with a QA warning for ${lead.name}.` : `[AI Agent] Demo ready for ${lead.name}.`);
  } catch (err: any) {
    throw new Error(err?.message || 'Could not generate the demo. Try again in a minute.');
  }

  return lead;
}
