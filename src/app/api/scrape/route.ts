import { liveScrapeGoogleMaps, analyzeWebsiteAndReviews } from '@/lib/scraper';
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

        // 2. Analyse each lead (website score + pain points).
        // Outreach email + landing page are generated later, on demand per lead,
        // so the scan stays fast and OpenAI spend only goes to leads worth pitching.
        const enrichedLeads = [];
        for (const lead of leads) {
          const analyzed = await analyzeWebsiteAndReviews(lead, sendEvent);

          try {
            const saved = await prisma.lead.create({
              data: {
                name: analyzed.name,
                rating: analyzed.rating,
                reviewsCount: analyzed.reviewsCount,
                phone: analyzed.phone || "N/A",
                website: analyzed.website,
                address: analyzed.address,
                painPoints: JSON.stringify(analyzed.painPoints),
                websiteQualityScore: analyzed.websiteQualityScore,
                lat: analyzed.lat,
                lng: analyzed.lng,
                offer: offer || null,
                contactEmail: analyzed.emails?.[0] || null,
              }
            });
            // Use the DB id so the UI can generate/deploy/send for this lead immediately
            analyzed.id = saved.id;
          } catch(e) {
             console.error("DB Save err", e);
          }

          enrichedLeads.push(analyzed);

          // Send incremental update to show leads on map as they process
          sendEvent("incremental_lead", enrichedLeads);
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
