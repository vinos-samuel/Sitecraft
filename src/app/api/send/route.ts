import { NextResponse } from 'next/server';
import { Resend } from 'resend';

export async function POST(request: Request) {
  try {
    const { to, subject, html } = await request.json();

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

    // Note: with the default resend.dev sender, Resend only delivers to your own
    // verified email (test mode). Verify a domain in Resend and set EMAIL_FROM
    // before doing real outreach.
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.EMAIL_FROM || 'OmniLead <onboarding@resend.dev>';

    const { data, error } = await resend.emails.send({
      from,
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
