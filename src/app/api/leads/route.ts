import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Always hit the DB fresh — this route must never serve a stale/cached result.
export const dynamic = 'force-dynamic';

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
      dealValue,
      closedAt,
      contractUrl,
      contractSentAt,
      invoiceUrl,
      depositPaidAt,
      outreachEmail,
      rejectionReason,
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
    if (dealValue !== undefined) data.dealValue = dealValue === null ? null : Number(dealValue);
    if (closedAt !== undefined) data.closedAt = closedAt ? new Date(closedAt) : null;
    if (contractUrl !== undefined) data.contractUrl = contractUrl;
    if (contractSentAt !== undefined)
      data.contractSentAt = contractSentAt ? new Date(contractSentAt) : null;
    if (invoiceUrl !== undefined) data.invoiceUrl = invoiceUrl;
    if (depositPaidAt !== undefined)
      data.depositPaidAt = depositPaidAt ? new Date(depositPaidAt) : null;
    if (outreachEmail !== undefined) data.outreachEmail = outreachEmail;
    if (rejectionReason !== undefined) data.rejectionReason = rejectionReason;

    const lead = await prisma.lead.update({ where: { id }, data });

    // Log status changes (especially CLOSED and REJECTED, where the reason matters) for the Overview tab.
    if (status !== undefined) {
      try {
        const type = status === 'CLOSED' ? 'DEAL_CLOSED' : status === 'REJECTED' ? 'LEAD_REJECTED' : status === 'NEW' ? 'LEAD_QUALIFIED' : 'STATUS_CHANGE';
        const message =
          status === 'CLOSED' ? `${lead.name} marked CLOSED${dealValue ? ` — $${dealValue}` : ''}.`
          : status === 'REJECTED' ? `${lead.name} rejected${rejectionReason ? ` — ${rejectionReason}` : ' (no reason given)'}.`
          : status === 'NEW' ? `${lead.name} qualified into the pipeline.`
          : `${lead.name} moved to ${status}.`;
        await prisma.activity.create({ data: { type, leadId: id, message } });
      } catch (e) {
        console.error('Activity log err', e);
      }
    }

    return NextResponse.json(lead);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
