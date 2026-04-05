import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import JSZip from 'jszip';

export async function POST(request: Request) {
  try {
    const { leadId } = await request.json();
    if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || !lead.landingPageHtml) {
      return NextResponse.json({ error: "Lead not found or missing HTML asset" }, { status: 404 });
    }

    const netlifyToken = process.env.NETLIFY_API_KEY;
    
    // Mock deployment if no API key is provided
    if (!netlifyToken) {
      await new Promise(res => setTimeout(res, 2000)); // Simulate upload
      const mockUrl = `https://demo-${lead.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}-preview.netlify.app`;
      
      const updatedMock = await prisma.lead.update({
        where: { id: leadId },
        data: { liveWebsiteUrl: mockUrl }
      });
      return NextResponse.json({ success: true, url: mockUrl, lead: updatedMock });
    }

    // Step 1: Zip the assets
    const zip = new JSZip();
    zip.file("index.html", lead.landingPageHtml);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Step 2: Create temporary Netlify Site
    const siteReq = await fetch("https://api.netlify.com/api/v1/sites", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${netlifyToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        name: `omni-preview-${Date.now().toString().slice(-6)}`
      })
    });
    
    if (!siteReq.ok) {
       const errTx = await siteReq.text();
       throw new Error(`Netlify Site Init Error: ${errTx}`);
    }
    
    const siteData = await siteReq.json();
    const siteId = siteData.id;
    const siteUrl = siteData.ssl_url || siteData.url;

    // Step 3: Deploy the ZIP package
    const deployReq = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${netlifyToken}`,
        "Content-Type": "application/zip"
      },
      body: zipBuffer as unknown as BodyInit
    });

    if (!deployReq.ok) {
        throw new Error("Netlify ZIP Deploy Error");
    }

    // Save Live URL to database
    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { liveWebsiteUrl: siteUrl }
    });

    return NextResponse.json({ success: true, url: siteUrl, lead: updatedLead });

  } catch (error: any) {
    console.error("Deploy API error:", error);
    return NextResponse.json({ error: error.message || "Failed deployment" }, { status: 500 });
  }
}
