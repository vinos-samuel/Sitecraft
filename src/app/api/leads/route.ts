import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/leads — return all leads, newest first
export async function GET() {
  try {
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(leads);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PUT /api/leads — update any CRM-editable fields on a lead
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const {
      id,
      status,
      contactEmail,
      notes,
      lastContactedAt,
      followUpAt,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const data: Record<string, any> = {};
    if (status !== undefined) data.status = status;
    if (contactEmail !== undefined) data.contactEmail = contactEmail;
    if (notes !== undefined) data.notes = notes;
    if (lastContactedAt !== undefined)
      data.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : null;
    if (followUpAt !== undefined)
      data.followUpAt = followUpAt ? new Date(followUpAt) : null;

    const lead = await prisma.lead.update({ where: { id }, data });
    return NextResponse.json(lead);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
