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

// ─── Google Places API ────────────────────────────────────────────────────────

/**
 * Calls the Google Places Text Search (New) API to find real business listings.
 * Replaces the old Puppeteer-based scraper which was blocked by Google immediately.
 *
 * Requires: GOOGLE_PLACES_API_KEY env var.
 * Free tier: $200/month credit (~5,000–10,000 searches).
 */
export async function liveScrapeGoogleMaps(
  businessType: string,
  city: string,
  onProgress: (msg: string, data?: any) => void
): Promise<ScrapedLead[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  // ── Geocode the city for map centering ──────────────────────────────────────
  let cityLat = 1.3521;  // default: Singapore
  let cityLng = 103.8198;
  try {
    onProgress(`Geocoding coordinates for ${city}...`);
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`,
      { headers: { 'User-Agent': 'OmniLead-App/2.0 (local-dev)' } }
    );
    const geoData = await geoRes.json();
    if (geoData?.length > 0) {
      cityLat = parseFloat(geoData[0].lat);
      cityLng = parseFloat(geoData[0].lon);
      onProgress(`Coordinates found: ${cityLat.toFixed(3)}, ${cityLng.toFixed(3)}`);
    }
  } catch {
    onProgress(`Geocoding failed, using default coordinates.`);
  }

  // ── No API key → return a clearly-labelled demo set ─────────────────────────
  if (!apiKey) {
    onProgress(
      `⚠️  GOOGLE_PLACES_API_KEY not set. Returning demo data. Add the key to .env.local and restart.`
    );
    return buildDemoLeads(businessType, city, cityLat, cityLng);
  }

  // ── Live Google Places Text Search (New) ─────────────────────────────────────
  onProgress(`Calling Google Places API for "${businessType} in ${city}"...`);

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
      body: JSON.stringify({
        textQuery: `${businessType} in ${city}`,
        maxResultCount: 10,
        languageCode: 'en',
      }),
    }
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    onProgress(`Google Places API error (${searchRes.status}): ${errText}`);
    onProgress(`Falling back to demo data.`);
    return buildDemoLeads(businessType, city, cityLat, cityLng);
  }

  const searchData = await searchRes.json();
  const places: any[] = searchData.places ?? [];

  if (places.length === 0) {
    onProgress(`No results found for "${businessType} in ${city}". Try a different query.`);
    return [];
  }

  // ── Map Places API response → ScrapedLead shape ──────────────────────────────
  // Built before the progress event below fires — the client puts this
  // straight on the map, and a raw Places result has no top-level lat/lng
  // (it's nested under .location.latitude/.longitude), which crashed the
  // map with "Invalid LatLng object: (undefined, undefined)" the moment a
  // scan started, every time.
  const leads: ScrapedLead[] = places.map((place, i) => {
    const loc = place.location ?? {};
    // Extract review text for pain-point analysis later
    const reviewTexts: string[] = (place.reviews ?? [])
      .map((r: any) => r.originalText?.text ?? r.text?.text ?? '')
      .filter(Boolean)
      .slice(0, 5);

    return {
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
      // Store raw review text temporarily in painPoints; will be replaced by AI
      painPoints: reviewTexts.length > 0 ? reviewTexts : [],
      websiteQualityScore: 0,
      mobileScore: null,
      desktopScore: null,
      websiteIssues: [],
      lat: loc.latitude ?? cityLat + (Math.random() - 0.5) * 0.05,
      lng: loc.longitude ?? cityLng + (Math.random() - 0.5) * 0.05,
    };
  });

  onProgress(`Found ${leads.length} businesses. Preparing for AI analysis...`, leads);

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
  if (!lead.website) {
    lead.mobileScore = null;
    lead.desktopScore = null;
    lead.designScore = null;
    lead.designReasons = [];
    lead.websiteQualityScore = 1;
    lead.websiteIssues = ['No website found for this business — they are invisible to anyone searching online.'];
    onProgress(`[PageSpeed] ${lead.name} has no website. Score: 1/5.`);
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
  lead.websiteQualityScore = design.confident && design.designScore != null
    ? design.designScore
    : bucketTriageScore(mobilePct, desktopPct);
  lead.websiteIssues = issues.length > 0 ? issues.slice(0, 5) : ["No major issues detected — the site passed Google's core checks."];

  const scoreSource = design.confident ? 'design' : 'performance fallback';
  onProgress(`[PageSpeed] ${lead.name}: Mobile ${mobilePct ?? 'failed'}, Desktop ${desktopPct ?? 'failed'} → Score ${lead.websiteQualityScore}/5 (${scoreSource})`);

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

// ─── Outreach Generation ──────────────────────────────────────────────────────

export async function generateOutreachAssets(
  lead: ScrapedLead,
  offer: string,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  onProgress(`[AI Agent] Generating bespoke outreach for ${lead.name}...`);

  if (!process.env.OPENAI_API_KEY) {
    lead.outreachEmail = `Subject: Fixing ${lead.name}'s website issues\n\nHi team,\n\nI noticed your clients are frustrated based on Google Reviews — specifically around: ${lead.painPoints[0] ?? 'your online presence'}.\n\nWe specialize in exactly this. Worth a quick chat?\n\nBest,\nVinos`;
    lead.landingPageHtml = `<div style="font-family:sans-serif;padding:40px;text-align:center;background:#0a0a1a;color:#fff"><h1>Custom Preview for ${lead.name}</h1><p>We solve: ${lead.painPoints[0] ?? 'your key challenge'}.</p><p style="color:#8b5cf6">${offer}</p></div>`;
    return lead;
  }

  try {
    // null means the test genuinely failed/never ran — don't let the model assert
    // brokenness as fact to a real business owner off an unverified result.
    const hasVerifiedPsiData = !!lead.website && (lead.mobileScore != null || lead.desktopScore != null);
    const websiteIssuesContext = lead.websiteIssues?.length > 0
      ? hasVerifiedPsiData
        ? `Verified website problems (from Google's own PageSpeed test — cite these specifically, they are credible and checkable, not a guess):
- Mobile performance score: ${lead.mobileScore != null ? `${lead.mobileScore}/100` : 'test failed, not verified'}, Desktop: ${lead.desktopScore != null ? `${lead.desktopScore}/100` : 'test failed, not verified'}
${lead.websiteIssues.map((i) => `- ${i}`).join('\n')}`
        : lead.website
          ? `Note: their website could not be automatically tested. Do NOT claim their site is broken, slow, or bad — that is unverified. Lead with the business pain points instead, and only mention the website in passing if at all.`
          : `This business has no website at all — true and safe to mention directly.`
      : '';

    const calendarLink = process.env.CALENDAR_LINK;
    const calendarContext = calendarLink
      ? `Booking link: ${calendarLink} — end the email with a low-friction call to action to book a quick call using this link.`
      : `No booking link available — end with a simple "reply to this email" call to action instead.`;

    // Read their actual current site so the "redesign" is a genuine upgrade of
    // what they have, not a generic template with their name pasted in.
    let currentSiteContext = '';
    if (lead.website) {
      onProgress(`[AI Agent] Reading ${lead.name}'s current website...`);
      currentSiteContext = await fetchWebsiteContext(lead.website);
    }
    const currentSiteBlock = currentSiteContext
      ? `Their current website — use this as the real basis for the redesign (same business, same services, same real details, dramatically better execution — do not invent services they don't actually offer):\n${currentSiteContext}`
      : lead.website
        ? `Could not read their current website (blocked or unreachable) — design from the business category, pain points, and reviews below instead. Do not invent specific services or claim to know what's on their current site.`
        : `This business has no website at all — design a brand-new site from scratch using the category, pain points, and reviews below.`;

    const businessFacts = `Real business details (use these exact facts verbatim wherever the design calls for them — do not alter, invent, or guess a phone number, address, or rating):
- Name: ${lead.name}
- Phone: ${lead.phone || 'not available — omit phone number rather than inventing one'}
- Address: ${lead.address || 'not available — omit address rather than inventing one'}
- Rating: ${lead.rating !== 'N/A' ? `${lead.rating}★ from ${lead.reviewsCount} Google reviews — this is real, verified social proof, use it prominently` : 'not available'}`;

    const prompt = `You are an expert conversion-focused web designer and sales copywriter. The email and landing page you produce ARE the product being sold — a prospect's decision to reply hinges entirely on how good this is, so do the real work: be specific, be visually considered, and never generic-template it. Be respectful in tone — never insult the business, its staff, or its service quality, even indirectly. Only state things as fact that are explicitly marked verified below; everything else, speak in terms of opportunity, not accusation.

${businessFacts}

${currentSiteBlock}

Business pain points (from customer reviews): ${lead.painPoints.join(', ')}
${websiteIssuesContext}
My offer: ${offer}
${calendarContext}

Generate a JSON response with exactly two keys:

"outreachEmail": A highly specific 3-paragraph cold email. Reference at least one real, concrete detail from their actual current website or reviews (not a generic pain point) so it's obviously not a form letter. Reference the redesigned demo you're linking to. Start with "Subject: " on the first line.

"landingPageHtml": A complete, modern, responsive one-page HTML/CSS site with inline CSS (raw HTML string only, no markdown fencing). This is a redesign of THEIR site's actual content — same business, same real services/information (from the current-website context above), executed to a dramatically higher standard. Structure it as:
1. Hero — their real name, a headline addressing their real opportunity (from the pain points or website issues), no fabricated tagline that misrepresents their business
2. Services/offerings — pulled from their actual current site content if available, otherwise reasonably inferred from their business category — do not invent services
3. Social proof — their real rating and review count if available, styled prominently (this is genuine, verifiable proof, use it)
4. "What we'd upgrade" — a short section citing the verified website issues or pain points above, framed as opportunity not criticism
5. Add-on capability previews — read the pain points and website issues above and, for each one that genuinely maps to one of these capabilities, include a small labeled preview section for it (clearly marked as a preview of what a paid retainer adds on top of the base rebuild — NOT fully functional, a visual teaser only). Do NOT include a category that doesn't map to anything actually found above, and word each label specifically for THIS business's real situation, not a generic stock phrase:
   - Booking/scheduling friction, no online booking → a floating "📅 Book [Appointment/Session/Consultation — pick the word that fits their business]" calendar-style visual
   - Missed calls, slow response, no after-hours coverage, no live chat → a floating "💬 AI Assistant" chat bubble in the bottom-right corner, answers questions & books appointments 24/7
   - No client follow-up, re-engagement, or progress tracking mentioned → a "🔔" callout with a label written for their actual situation (e.g. a fitness trainer's clients want progress check-ins, not the same wording a dentist's missed-call follow-up would use — don't reuse one generic phrase for both)
   - No educational content, explanations, articles, or resources → a "📚 Resources" section previewing an article/blog area
6. Contact/footer — their real phone and address if available, no fabricated ones

Design rules:
- No <img> tags with invented or placeholder URLs — you cannot generate real photos, and a broken image icon kills the premium feel this is supposed to have. Use CSS-only visual treatment instead (gradients, shapes, color, typography) — a clean, image-free layout is a legitimate premium look on its own.
- Pick a color palette and tone that actually fits this business's industry — a dental clinic and a hair salon should not look the same.
- Fully self-contained: no external stylesheets, fonts, or scripts.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    lead.outreachEmail = res.outreachEmail ?? '';
    lead.landingPageHtml = res.landingPageHtml ?? '';
    onProgress(`[AI Agent] Generation complete for ${lead.name}!`);
  } catch (err) {
    onProgress(`[AI Agent Error] Failed to generate AI assets. Using mock fallbacks.`);
    lead.outreachEmail = `Subject: Optimisation for ${lead.name}`;
    lead.landingPageHtml = `<h1>Fallback HTML</h1>`;
  }

  return lead;
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

function buildDemoLeads(
  businessType: string,
  city: string,
  cityLat: number,
  cityLng: number
): ScrapedLead[] {
  const prefixes = ['Elite', 'Advanced', 'Premier', 'Local', 'City', 'Pinnacle'];
  return prefixes.slice(0, 4).map((prefix, i) => ({
    id: `demo_${i}`,
    name: `${prefix} ${businessType} of ${city}`,
    rating: (4 + Math.random()).toFixed(1),
    reviewsCount: Math.floor(Math.random() * 500 + 20).toString(),
    phone: `(555) ${Math.floor(100 + Math.random() * 899)}-${Math.floor(1000 + Math.random() * 8999)}`,
    website: `https://${prefix.toLowerCase()}${businessType.replace(/\s/g, '').toLowerCase()}.demo.com`,
    address: `Downtown ${city}`,
    emails: [],
    socials: [],
    painPoints: [
      'Customers mention long wait times for appointments.',
      'Reviews note staff are hard to reach by phone.',
    ],
    websiteQualityScore: 0,
    mobileScore: null,
    desktopScore: null,
    websiteIssues: [],
    lat: cityLat + (Math.random() - 0.5) * 0.05,
    lng: cityLng + (Math.random() - 0.5) * 0.05,
  }));
}
