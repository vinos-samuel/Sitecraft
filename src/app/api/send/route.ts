import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 'fake_key_for_build');

export async function POST(request: Request) {
  try {
    const { to, subject, html, leadId } = await request.json();
    
    // In production environment without a key, act as a dry-run mock
    if (!process.env.RESEND_API_KEY) {
       console.log("Mock SEND to:", to, "Subject:", subject);
       return NextResponse.json({ success: true, id: `mocked_resend_${leadId}` });
    }

    const data = await resend.emails.send({
      from: 'OmniLead Automation <onboarding@resend.dev>',
      to: [to],
      subject: subject,
      html: html, // The generated outreach email wrapped in simple HTML
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
