import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const maxDuration = 60;

// POST /api/deploy — publish a lead's generated landing page as a live Vercel site
export async function POST(request: Request) {
  try {
    const { leadId } = await request.json();
    if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead || !lead.landingPageHtml) {
      return NextResponse.json({ error: "Lead not found or missing HTML asset" }, { status: 404 });
    }

    const vercelToken = process.env.VERCEL_TOKEN;
    if (!vercelToken) {
      return NextResponse.json(
        { error: "VERCEL_TOKEN is not set. Create a token at vercel.com/account/tokens and add it to the environment." },
        { status: 500 }
      );
    }

    // One Vercel project per prospect → stable demo URL like acme-dental-demo.vercel.app
    const slug = lead.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const projectName = `${slug}-demo`;

    const deployRes = await fetch("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: projectName,
        target: "production",
        files: [
          { file: "index.html", data: lead.landingPageHtml, encoding: "utf-8" },
        ],
        projectSettings: { framework: null },
      }),
    });

    if (!deployRes.ok) {
      const errTx = await deployRes.text();
      throw new Error(`Vercel deploy error (${deployRes.status}): ${errTx}`);
    }

    const deployData = await deployRes.json();
    // The stable production alias is <projectName>.vercel.app
    const siteUrl = `https://${projectName}.vercel.app`;

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { liveWebsiteUrl: siteUrl },
    });

    return NextResponse.json({ success: true, url: siteUrl, deploymentUrl: `https://${deployData.url}`, lead: updatedLead });

  } catch (error: any) {
    console.error("Deploy API error:", error);
    return NextResponse.json({ error: error.message || "Failed deployment" }, { status: 500 });
  }
}
