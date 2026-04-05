import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const territories = await prisma.territory.findMany();
    return NextResponse.json(territories);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { name, geoJson } = await request.json();
    const territory = await prisma.territory.create({ data: { name, geoJson } });
    return NextResponse.json(territory);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
