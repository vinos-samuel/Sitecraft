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
  painPoints: string[];
  websiteQualityScore: number;
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
      lat: loc.latitude ?? cityLat + (Math.random() - 0.5) * 0.05,
      lng: loc.longitude ?? cityLng + (Math.random() - 0.5) * 0.05,
    };
  });

  return leads;
}

// ─── AI Analysis ─────────────────────────────────────────────────────────────

/**
 * Uses OpenAI to analyse the business's review text and website quality.
 * If no API key, falls back to a fast heuristic score.
 */
export async function analyzeWebsiteAndReviews(
  lead: ScrapedLead,
  onProgress: (msg: string, leadUpdate?: any) => void
): Promise<ScrapedLead> {
  onProgress(`[AI Agent] Analysing ${lead.name}...`);

  if (!process.env.OPENAI_API_KEY) {
    // Heuristic fallback: rate based on rating number
    const ratingNum = parseFloat(lead.rating) || 3;
    lead.websiteQualityScore = ratingNum < 3.5 ? 1 : ratingNum < 4.2 ? 2 : 3;
    lead.painPoints = lead.painPoints.length > 0
      ? lead.painPoints.slice(0, 2)           // use raw review snippets as placeholders
      : ['No review data available.'];
    if (lead.website) {
      lead.emails = [`contact@${lead.website.replace(/https?:\/\//, '').split('/')[0]}`];
    }
    onProgress(`[AI Agent] Heuristic analysis done for ${lead.name}. Score: ${lead.websiteQualityScore}/5`);
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
          content: `You are a sales analyst. Analyse this business and respond in JSON.

Business: ${lead.name}
Website: ${lead.website || 'none'}
Rating: ${lead.rating} (${lead.reviewsCount} reviews)
${reviewContext}

Respond ONLY with JSON matching this exact shape:
{
  "websiteQualityScore": <integer 1-5, where 1=very poor website/no online presence, 5=excellent>,
  "painPoints": [<2-3 specific pain points inferred from reviews or low rating, as actionable strings>],
  "inferredEmail": <best-guess contact email based on website domain, or "" if no website>
}`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    });

    const res = JSON.parse(completion.choices[0].message.content ?? '{}');
    lead.websiteQualityScore = res.websiteQualityScore ?? 2;
    lead.painPoints = res.painPoints ?? lead.painPoints.slice(0, 2);
    if (res.inferredEmail) lead.emails = [res.inferredEmail];

    onProgress(`[AI Agent] Analysis complete for ${lead.name}. Quality Score: ${lead.websiteQualityScore}/5`);
  } catch (err: any) {
    onProgress(`[AI Agent] Analysis error for ${lead.name}: ${err.message}. Using fallback.`);
    lead.websiteQualityScore = 2;
    if (lead.painPoints.length === 0) {
      lead.painPoints = ['Could not extract specific pain points.'];
    }
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
    const prompt = `You are an expert sales engineer.
Lead: ${lead.name} (${lead.website})
Pain Points: ${lead.painPoints.join(', ')}
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
      'Clients complain website is hard to navigate on mobile.',
      'Users mention they cannot find pricing information easily.',
    ],
    websiteQualityScore: Math.floor(Math.random() * 3) + 1,
    lat: cityLat + (Math.random() - 0.5) * 0.05,
    lng: cityLng + (Math.random() - 0.5) * 0.05,
  }));
}
