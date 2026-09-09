import { NextResponse } from 'next/server';
import { ensureLeadSchema, prisma } from '@/lib/prisma';

export const maxDuration = 60;

// POST /api/deploy — publish a lead's generated landing page as a live Vercel site
export async function POST(request: Request) {
  try {
    const { leadId } = await request.json();
    if (!leadId) return NextResponse.json({ error: "Missing leadId" }, { status: 400 });

    await ensureLeadSchema();
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

    // Optional — only needed if VERCEL_TOKEN is scoped to a team rather than
    // your personal account. See the 403 "permission to create a project"
    // troubleshooting note on this route.
    const teamId = process.env.VERCEL_TEAM_ID;
    const url = `https://api.vercel.com/v13/deployments${teamId ? `?teamId=${teamId}` : ''}`;

    const deployRes = await fetch(url, {
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
      // "permission to create a project" almost always means VERCEL_TOKEN is
      // scoped to a team where this account isn't an Owner/Admin — recreate
      // the token at vercel.com/account/tokens scoped to your personal
      // account instead (not a team), or add VERCEL_TEAM_ID with a team
      // where you do have that permission.
      throw new Error(`Vercel deploy error (${deployRes.status}): ${errTx}`);
    }

    const deployData = await deployRes.json();
    // The stable production alias is <projectName>.vercel.app
    const siteUrl = `https://${projectName}.vercel.app`;

    const updatedLead = await prisma.lead.update({
      where: { id: leadId },
      data: { liveWebsiteUrl: siteUrl },
    });

    try {
      await prisma.activity.create({
        data: { type: 'DEMO_DEPLOYED', leadId, message: `Demo site deployed for ${lead.name}: ${siteUrl}` },
      });
    } catch (e) {
      console.error('Activity log err', e);
    }

    return NextResponse.json({ success: true, url: siteUrl, deploymentUrl: `https://${deployData.url}`, lead: updatedLead });

  } catch (error: any) {
    console.error("Deploy API error:", error);
    return NextResponse.json({ error: error.message || "Failed deployment" }, { status: 500 });
  }
}
