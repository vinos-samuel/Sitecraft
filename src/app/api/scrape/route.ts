import { NextResponse } from 'next/server';
import { liveScrapeGoogleMaps, analyzeWebsiteAndReviews, generateOutreachAssets } from '@/lib/scraper';
import { prisma } from '@/lib/prisma';

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
        
        // 2. Perform deep analysis and generation on each found lead
        const enrichedLeads = [];
        for (const lead of leads) {
          const analyzed = await analyzeWebsiteAndReviews(lead, sendEvent);
          const finalLead = await generateOutreachAssets(analyzed, offer, sendEvent);
          
          try {
            await prisma.lead.create({
              data: {
                name: finalLead.name,
                rating: finalLead.rating,
                reviewsCount: finalLead.reviewsCount,
                phone: finalLead.phone || "N/A",
                website: finalLead.website,
                address: finalLead.address,
                painPoints: JSON.stringify(finalLead.painPoints),
                websiteQualityScore: finalLead.websiteQualityScore,
                lat: finalLead.lat,
                lng: finalLead.lng,
                outreachEmail: finalLead.outreachEmail,
                landingPageHtml: finalLead.landingPageHtml,
              }
            });
          } catch(e) {
             console.error("DB Save err", e); 
          }

          enrichedLeads.push(finalLead);
          
          // Send incremental update to show leads on map as they process
          sendEvent("incremental_lead", [finalLead]);
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
