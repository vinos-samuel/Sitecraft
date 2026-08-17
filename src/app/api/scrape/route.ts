import { liveScrapeGoogleMaps, analyzeWebsiteAndReviews, assessWebsiteQuality } from '@/lib/scraper';
import { prisma } from '@/lib/prisma';

// Scanning 10 leads + AI analysis takes a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = await request.json();
  const { businessType, city, offer } = body;

  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (msg: string, data?: any) => {
        const payload = JSON.stringify({ message: msg, data });
        controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      };

      try {
        sendEvent("Initializing scraping engine...");

        // 1. Scrape Google Maps
        const leads = await liveScrapeGoogleMaps(businessType, city, sendEvent);

        // 2. Analyse each lead: customer reviews (OpenAI) + real website quality
        // (Google PageSpeed, mobile + desktop) run in parallel per lead.
        // Outreach email + landing page are generated later, on demand per lead,
        // so the scan stays fast and OpenAI spend only goes to leads worth pitching.
        const enrichedLeads = [];
        for (const lead of leads) {
          await Promise.all([
            analyzeWebsiteAndReviews(lead, sendEvent),
            assessWebsiteQuality(lead, sendEvent),
          ]);

          try {
            // Dedupe by Google Place ID — re-scanning the same city/niche must not
            // create fresh duplicates of businesses already in the pipeline, and
            // must never overwrite an existing lead's CRM status/notes.
            const existing = lead.placeId
              ? await prisma.lead.findUnique({ where: { placeId: lead.placeId }, select: { id: true } })
              : null;

            if (existing) {
              lead.id = existing.id;
              sendEvent(`[Dedupe] ${lead.name} is already in your pipeline — skipped.`);
            } else {
              const saved = await prisma.lead.create({
                data: {
                  placeId: lead.placeId || null,
                  name: lead.name,
                  rating: lead.rating,
                  reviewsCount: lead.reviewsCount,
                  phone: lead.phone || "N/A",
                  website: lead.website,
                  address: lead.address,
                  painPoints: JSON.stringify(lead.painPoints),
                  websiteQualityScore: lead.websiteQualityScore,
                  mobileScore: lead.mobileScore,
                  desktopScore: lead.desktopScore,
                  websiteIssues: JSON.stringify(lead.websiteIssues),
                  lat: lead.lat,
                  lng: lead.lng,
                  offer: offer || null,
                  contactEmail: lead.emails?.[0] || null,
                }
              });
              // Use the DB id so the UI can generate/deploy/send for this lead immediately
              lead.id = saved.id;
            }
          } catch(e) {
             console.error("DB Save err", e);
          }

          enrichedLeads.push(lead);

          // Send incremental update to show leads on map as they process
          sendEvent("incremental_lead", enrichedLeads);
        }

        // Record the scan itself for the Overview tab / remote supervision.
        try {
          await prisma.activity.create({
            data: {
              type: 'SCAN',
              message: `Scanned "${businessType} in ${city}" — ${enrichedLeads.length} businesses found.`,
            },
          });
        } catch (e) {
          console.error('Activity log err', e);
        }

        sendEvent("DONE", enrichedLeads);
        controller.close();
      } catch (err: any) {
        sendEvent("ERROR", { error: err.message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
