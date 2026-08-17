import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'fake_key_to_allow_build',
});

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScrapedLead {
  id: string;
  name: string;
  rating: string;
  reviewsCount: string;
  phone: string;
  website: string;
  address: string;
  emails: string[];
  socials: string[];
  painPoints: string[];          // business/customer-service issues, from review text
  websiteQualityScore: number;   // 1-5 triage score, derived from real PageSpeed results
  mobileScore: number;           // 0-100, PageSpeed performance score (mobile)
  desktopScore: number;          // 0-100, PageSpeed performance score (desktop)
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
      mobileScore: 0,
      desktopScore: 0,
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
  "painPoints": [<2-3 specific business/customer-service pain points inferred from the reviews, as actionable strings — about how the business runs, NOT about the website>],
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

  // PageSpeed can take 10-20s per call; don't let one slow site stall the whole scan.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`PageSpeed API error (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function scoreToInt(score: number | null | undefined): number {
  return score == null ? 0 : Math.round(score * 100);
}

// Mobile-weighted: most local-business searches happen on a phone.
function bucketTriageScore(mobilePct: number, desktopPct: number): number {
  const blended = mobilePct * 0.7 + desktopPct * 0.3;
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
    lead.mobileScore = 0;
    lead.desktopScore = 0;
    lead.websiteQualityScore = 1;
    lead.websiteIssues = ['No website found for this business — they are invisible to anyone searching online.'];
    onProgress(`[PageSpeed] ${lead.name} has no website. Score: 1/5.`);
    return lead;
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  onProgress(`[PageSpeed] Testing ${lead.name}'s website (mobile + desktop)...`);

  try {
    const [mobile, desktop] = await Promise.all([
      runPageSpeed(lead.website, 'mobile', apiKey),
      runPageSpeed(lead.website, 'desktop', apiKey),
    ]);

    const mobilePct = scoreToInt(mobile?.lighthouseResult?.categories?.performance?.score);
    const desktopPct = scoreToInt(desktop?.lighthouseResult?.categories?.performance?.score);

    // Merge issues from both runs, worst-first, deduped, capped at 5 bullets.
    const combined = [...extractIssues(mobile?.lighthouseResult), ...extractIssues(desktop?.lighthouseResult)]
      .sort((a, b) => a.score - b.score);
    const seen = new Set<string>();
    const issues: string[] = [];
    for (const item of combined) {
      if (seen.has(item.title)) continue;
      seen.add(item.title);
      issues.push(item.title);
      if (issues.length >= 5) break;
    }

    lead.mobileScore = mobilePct;
    lead.desktopScore = desktopPct;
    lead.websiteQualityScore = bucketTriageScore(mobilePct, desktopPct);
    lead.websiteIssues = issues.length > 0 ? issues : ["No major issues detected — the site passed Google's core checks."];

    onProgress(`[PageSpeed] ${lead.name}: Mobile ${mobilePct}/100, Desktop ${desktopPct}/100 → Score ${lead.websiteQualityScore}/5`);
  } catch (err: any) {
    // A site PageSpeed can't even reach is often itself a red flag (down, broken, blocking bots).
    onProgress(`[PageSpeed] Could not test ${lead.name}'s website (${err.message}).`);
    lead.mobileScore = 0;
    lead.desktopScore = 0;
    lead.websiteQualityScore = 2;
    lead.websiteIssues = ["Automated website test couldn't load the site — this itself may signal a broken or misconfigured website."];
  }

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
    const websiteIssuesContext = lead.websiteIssues?.length > 0
      ? `Verified website problems (from Google's own PageSpeed test — cite these specifically, they are credible and checkable, not a guess):
- Mobile performance score: ${lead.mobileScore}/100, Desktop: ${lead.desktopScore}/100
${lead.websiteIssues.map((i) => `- ${i}`).join('\n')}`
      : '';

    const prompt = `You are an expert sales engineer.
Lead: ${lead.name} (${lead.website})
Business Pain Points (from customer reviews): ${lead.painPoints.join(', ')}
${websiteIssuesContext}
My Offer: ${offer}

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
    mobileScore: 0,
    desktopScore: 0,
    websiteIssues: [],
    lat: cityLat + (Math.random() - 0.5) * 0.05,
    lng: cityLng + (Math.random() - 0.5) * 0.05,
  }));
}
