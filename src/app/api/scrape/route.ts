import { liveScrapeGoogleMaps, analyzeWebsiteAndReviews, assessWebsiteQuality, ScrapedLead } from '@/lib/scraper';
import { crawlSite } from '@/lib/site-audit';
import { prisma } from '@/lib/prisma';

// Scanning 10 leads + AI analysis takes a while; allow up to 5 minutes on Vercel.
export const maxDuration = 300;

// A lead with no real chance of being a good fit for "we'll rebuild your
// broken site" doesn't need a human to reject it manually every time.
// (A business with NO website at all is the opposite — the strongest,
// clearest opportunity — so this deliberately never touches that case.)
const AUTO_REJECT_MIN_GOOD_DESIGN = 4;

function blendedPerformance(mobilePct: number | null, desktopPct: number | null): number | null {
  if (mobilePct != null && desktopPct != null) return mobilePct * 0.7 + desktopPct * 0.3;
  if (mobilePct != null) return mobilePct;
  if (desktopPct != null) return desktopPct;
  return null;
}

function autoRejectReason(lead: ScrapedLead): string | null {
  if (!lead.website) return null;

  // Untestable: both the PageSpeed test AND the crawl came back with nothing
  // at all — no signal of any kind to build a pitch on. (PSI alone failing
  // isn't enough to reject on anymore — the crawl frequently still succeeds
  // and gives real design/capability signal even when Lighthouse can't run.)
  const psiFailed = lead.mobileScore == null && lead.desktopScore == null;
  const crawlFetchedNothing = !lead.siteFacts || lead.siteFacts.pagesFetched.length === 0;
  if (psiFailed && crawlFetchedNothing) {
    return 'Auto-rejected: could not test or read the site at all — no verified signal to build a pitch on.';
  }

  // Already good: a confident design read of 4-5/5 is enough on its own —
  // real testing showed genuinely well-designed SMB sites routinely score
  // mediocre on raw performance (a booking widget, live chat, or heavy CMS
  // dragging Lighthouse down), so requiring strong performance too made
  // this filter almost never fire on exactly the sites it exists to catch.
  // The pitch is "your site looks dated," not "your site loads slowly" —
  // design is the signal that actually matters here.
  const blended = blendedPerformance(lead.mobileScore, lead.desktopScore);
  if (lead.designScore != null && lead.designScore >= AUTO_REJECT_MIN_GOOD_DESIGN) {
    const perfNote = blended != null ? `, performance ${Math.round(blended)}/100` : '';
    return `Auto-rejected: website already looks modern (design ${lead.designScore}/5${perfNote}) — not a strong fit for a rebuild pitch.`;
  }

  return null;
}

// Strips the bulky crawled-site content before sending leads over the wire —
// see the "incremental update" comment below for why.
function forWire(leads: ScrapedLead[]) {
  return leads.map(({ siteFacts, ...rest }) => rest);
}

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

        // 2. Analyse each lead: real website quality (Google PageSpeed) runs
        // alongside a multi-page crawl of the lead's actual site; the review
        // pain-point pass then runs against the crawl's verified facts, so it
        // can't claim something is missing that's clearly there. Outreach
        // email + landing page are generated later, on demand per lead, so
        // the scan stays fast and OpenAI spend only goes to leads worth pitching.
        const enrichedLeads: ScrapedLead[] = [];
        let autoRejectedCount = 0;

        const processOneLead = async (lead: ScrapedLead) => {
          // Crawl runs alongside the PSI test; the pain-point pass needs the
          // crawl's verified facts before it can start, so it's sequenced
          // after — the PSI test keeps running concurrently regardless.
          const psiTask = assessWebsiteQuality(lead, sendEvent);
          const siteFacts = lead.website ? await crawlSite(lead.website) : null;
          lead.siteFacts = siteFacts;

          // Real email discovery — deterministic, from the crawl itself.
          // Never a guess: if nothing verifiable was found, the field stays empty.
          if (siteFacts && siteFacts.emails.length > 0) {
            const best = siteFacts.emails[0];
            lead.emails = [best.address];
            lead.emailSource = best.mxVerified ? 'SCRAPED_MX_VERIFIED' : 'SCRAPED_NO_MX';
          }

          await analyzeWebsiteAndReviews(lead, siteFacts, sendEvent);
          await psiTask;

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
              const rejectReason = autoRejectReason(lead);
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
                  designScore: lead.designScore ?? null,
                  designReasons: lead.designReasons ? JSON.stringify(lead.designReasons) : null,
                  websiteIssues: JSON.stringify(lead.websiteIssues),
                  siteFacts: lead.siteFacts ? JSON.stringify(lead.siteFacts) : null,
                  emailSource: lead.emailSource || null,
                  lat: lead.lat,
                  lng: lead.lng,
                  offer: offer || null,
                  contactEmail: lead.emails?.[0] || null,
                  ...(rejectReason ? { status: 'REJECTED', rejectionReason: rejectReason } : {}),
                }
              });
              // Use the DB id so the UI can generate/deploy/send for this lead immediately
              lead.id = saved.id;
              if (rejectReason) {
                autoRejectedCount++;
                sendEvent(`[Auto-Reject] ${lead.name}: ${rejectReason}`);
                try {
                  await prisma.activity.create({
                    data: { type: 'LEAD_REJECTED', leadId: saved.id, message: `${lead.name} auto-rejected — ${rejectReason}` },
                  });
                } catch (e) {
                  console.error('Activity log err', e);
                }
              }
            }
          } catch(e) {
             console.error("DB Save err", e);
          }

          enrichedLeads.push(lead);

          // Send incremental update to show leads on map as they process.
          // siteFacts (the full crawled site content — several KB per lead)
          // is already persisted to the DB above; the live map/list only
          // ever reads name/rating/phone/lat/lng, so it's stripped here —
          // each "incremental" event re-sends the whole growing list, and
          // that field alone would make later events in a 10-lead scan
          // dozens of times bigger than they need to be.
          sendEvent("incremental_lead", forWire(enrichedLeads));
        };

        // Real PageSpeed tests now take ~20-25s each (they run actual
        // Lighthouse audits, not a fast pass/fail check) — processing 10
        // leads one at a time can take 250s+ and risks the platform's
        // function time limit killing the whole scan mid-run with nothing
        // sent back to the browser. Processing a few leads at once keeps
        // total wall-clock time well under that ceiling.
        const CONCURRENCY = 3;
        for (let i = 0; i < leads.length; i += CONCURRENCY) {
          const batch = leads.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(processOneLead));
        }

        // Record the scan itself for the Overview tab / remote supervision.
        try {
          await prisma.activity.create({
            data: {
              type: 'SCAN',
              message: `Scanned "${businessType} in ${city}" — ${enrichedLeads.length} found` +
                (autoRejectedCount > 0 ? `, ${autoRejectedCount} auto-rejected, ${enrichedLeads.length - autoRejectedCount} awaiting review.` : ' — awaiting review.'),
            },
          });
        } catch (e) {
          console.error('Activity log err', e);
        }

        sendEvent("DONE", forWire(enrichedLeads));
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
