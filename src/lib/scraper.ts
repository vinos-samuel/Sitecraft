import OpenAI from 'openai';

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
  socials: string[];
  painPoints: string[];          // business/customer-service issues, from review text
  websiteQualityScore: number;      // 1-5 triage score, derived from real PageSpeed results
  mobileScore: number | null;       // 0-100, PageSpeed performance score (mobile); null = test failed/not run
  desktopScore: number | null;      // 0-100, PageSpeed performance score (desktop); null = test failed/not run
  websiteIssues: string[];       // concrete, verified reasons for the score
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

  onProgress(`Found ${places.length} businesses. Preparing for AI analysis...`, places);

  // ── Map Places API response → ScrapedLead shape ──────────────────────────────
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

  return leads;
}

// ─── AI Analysis (customer reviews only) ───────────────────────────────────────

/**
 * Uses OpenAI to read the business's customer reviews for operational pain
 * points (e.g. "patients complain about hold times") — separate from website
 * quality, which is assessed for real in assessWebsiteQuality() below.
 * If no API key, falls back to using the raw review snippets as-is.
 */
export async function analyzeWebsiteAndReviews(
  lead: ScrapedLead,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  onProgress(`[AI Agent] Reading customer reviews for ${lead.name}...`);

  if (!process.env.OPENAI_API_KEY) {
    lead.painPoints = lead.painPoints.length > 0
      ? lead.painPoints.slice(0, 2)           // use raw review snippets as placeholders
      : ['No review data available.'];
    if (lead.website) {
      lead.emails = [`contact@${lead.website.replace(/https?:\/\//, '').split('/')[0]}`];
    }
    onProgress(`[AI Agent] Heuristic review pass done for ${lead.name}.`);
    return lead;
  }

  try {
    const reviewContext = lead.painPoints.length > 0
      ? `Recent customer reviews:\n${lead.painPoints.map(r => `- "${r}"`).join('\n')}`
      : 'No review text available.';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: `You are a sales analyst. Read this business's customer reviews and respond in JSON.

Business: ${lead.name}
Website: ${lead.website || 'none'}
Rating: ${lead.rating} (${lead.reviewsCount} reviews)
${reviewContext}

Respond ONLY with JSON matching this exact shape:
{
  "painPoints": [<2-3 specific operational friction points inferred from the reviews (e.g. booking difficulty, response speed, appointment reminders) — phrase each as a respectful observation and business opportunity, NEVER as a criticism of staff, service quality, or an insult. This will be read by a stranger receiving cold outreach. NOT about the website.>],
  "inferredEmail": <best-guess contact email based on website domain, or "" if no website>
}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 250,
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    lead.painPoints = res.painPoints ?? lead.painPoints.slice(0, 2);
    if (res.inferredEmail) lead.emails = [res.inferredEmail];

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
  lead.websiteQualityScore = bucketTriageScore(mobilePct, desktopPct);
  lead.websiteIssues = issues.length > 0 ? issues.slice(0, 5) : ["No major issues detected — the site passed Google's core checks."];

  onProgress(`[PageSpeed] ${lead.name}: Mobile ${mobilePct ?? 'failed'}, Desktop ${desktopPct ?? 'failed'} → Score ${lead.websiteQualityScore}/5`);

  return lead;
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

    const prompt = `You are an expert sales engineer writing cold outreach to a stranger. Be respectful and helpful in tone — never insult the business, its staff, or its service quality, even indirectly. Only state things as fact that are explicitly marked verified below; otherwise speak in terms of opportunity, not accusation.

Lead: ${lead.name} (${lead.website})
Business Pain Points (from customer reviews): ${lead.painPoints.join(', ')}
${websiteIssuesContext}
My Offer: ${offer}
${calendarContext}

Generate a JSON response with exactly two keys:
"outreachEmail": A highly converting 3-paragraph cold email referencing their specific pain points and offering my service. Start with "Subject: " on the first line.
"landingPageHtml": A modern, responsive HTML/CSS landing page tailored for them with inline CSS. Include a section explicitly stating how my offer solves their exact pain points. Make it look premium. Output raw HTML string only.`;

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
