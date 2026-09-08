import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateOutreachAssets, ScrapedLead } from '@/lib/scraper';
import { SiteFacts } from '@/lib/site-audit';

// Generate + QA + one repair can take a few minutes.
export const maxDuration = 180;

// POST /api/generate — generate outreach email + landing page for one lead
export async function POST(request: Request) {
  try {
    const { leadId, offer, businessType, city } = await request.json();
    if (!leadId) return NextResponse.json({ error: 'Missing leadId' }, { status: 400 });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    let painPoints: string[] = [];
    try {
      painPoints = JSON.parse(lead.painPoints);
    } catch {
      painPoints = [lead.painPoints];
    }

    let websiteIssues: string[] = [];
    try {
      websiteIssues = lead.websiteIssues ? JSON.parse(lead.websiteIssues) : [];
    } catch {
      websiteIssues = [];
    }

    // The stored crawl (see site-audit.ts) is the grounding source for the
    // demo — without it, generateOutreachAssets falls back to a second,
    // thinner single-page fetch of just the homepage.
    let siteFacts: SiteFacts | null = null;
    try {
      siteFacts = lead.siteFacts ? JSON.parse(lead.siteFacts) : null;
    } catch {
      siteFacts = null;
    }

    let designReasons: string[] = [];
    try {
      designReasons = lead.designReasons ? JSON.parse(lead.designReasons) : [];
    } catch {
      designReasons = [];
    }

    const scraped: ScrapedLead = {
      id: lead.id,
      name: lead.name,
      rating: lead.rating,
      reviewsCount: lead.reviewsCount,
      phone: lead.phone,
      website: lead.website,
      address: lead.address,
      emails: lead.contactEmail ? [lead.contactEmail] : [],
      socials: [],
      painPoints,
      websiteQualityScore: lead.websiteQualityScore,
      mobileScore: lead.mobileScore,
      desktopScore: lead.desktopScore,
      designScore: lead.designScore,
      designReasons,
      websiteIssues,
      siteFacts,
      lat: lead.lat,
      lng: lead.lng,
      businessType: lead.businessType,
    };

    const effectiveOffer = offer || lead.offer || 'A modern, mobile-friendly website that wins you more customers.';
    // Persist scan category on the lead so regenerate (and unnamed clinics)
    // still hit the dental shell after the form is cleared.
    const effectiveBusinessType = lead.businessType || businessType;
    const generated = await generateOutreachAssets(scraped, effectiveOffer, () => {}, { businessType: effectiveBusinessType, city });

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: {
        outreachEmail: generated.outreachEmail,
        landingPageHtml: generated.landingPageHtml,
        ...(!lead.businessType && effectiveBusinessType ? { businessType: effectiveBusinessType } : {}),
      },
    });

    return NextResponse.json({ success: true, lead: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Generation failed. Try again.' }, { status: 500 });
  }
}
