import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } });
    return NextResponse.json(leads);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { id, status } = await request.json();
    const lead = await prisma.lead.update({ where: { id }, data: { status } });
    return NextResponse.json(lead);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
