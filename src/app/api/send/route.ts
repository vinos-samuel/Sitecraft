import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { prisma } from '@/lib/prisma';

const DEFAULT_DAILY_CAP = 50;

export async function POST(request: Request) {
  try {
    const { to, subject, html, leadId } = await request.json();

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { success: false, error: "RESEND_API_KEY is not set. Get one at resend.com and add it to the environment." },
        { status: 500 }
      );
    }

    if (!to || !to.includes('@') || to.endsWith('@example.com')) {
      return NextResponse.json(
        { success: false, error: "No valid recipient email. Add the prospect's email in the lead panel first." },
        { status: 400 }
      );
    }

    // Hard cap on sends/24h — nothing stops a burst of sends from burning a
    // sending domain's reputation otherwise. Override with MAX_DAILY_SENDS.
    const dailyCap = Number(process.env.MAX_DAILY_SENDS) || DEFAULT_DAILY_CAP;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentToday = await prisma.activity.count({
      where: { type: 'EMAIL_SENT', createdAt: { gte: since } },
    });
    if (sentToday >= dailyCap) {
      return NextResponse.json(
        { success: false, error: `Daily send cap reached (${dailyCap}/24h). This protects your sending domain — raise MAX_DAILY_SENDS if this is intentional.` },
        { status: 429 }
      );
    }

    // Note: with the default resend.dev sender, Resend only delivers to your own
    // verified email (test mode). Verify a domain in Resend and set EMAIL_FROM
    // before doing real outreach.
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM || 'OmniLead <onboarding@resend.dev>';
    const replyTo = process.env.REPLY_TO_EMAIL || 'vinos.samuel@gmail.com';

    // CAN-SPAM: every commercial email needs a working opt-out and a physical
    // mailing address. Reply-to-unsubscribe satisfies the opt-out at this volume;
    // the address is a placeholder until BUSINESS_MAILING_ADDRESS is set.
    const mailingAddress = process.env.BUSINESS_MAILING_ADDRESS || '[Add BUSINESS_MAILING_ADDRESS before sending real outreach]';
    const complianceFooter = `
      <hr style="margin-top:24px; border:none; border-top:1px solid #e2e8f0;"/>
      <p style="font-size:11px; color:#94a3b8; margin-top:12px;">
        ${mailingAddress}<br/>
        Don't want future emails? Just reply and let us know.
      </p>
    `;

    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      replyTo,
      subject: subject,
      html: html + complianceFooter,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    try {
      await prisma.activity.create({
        data: {
          type: 'EMAIL_SENT',
          leadId: leadId || null,
          message: `Outreach email sent to ${to}.`,
        },
      });
    } catch (e) {
      console.error('Activity log err', e);
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
