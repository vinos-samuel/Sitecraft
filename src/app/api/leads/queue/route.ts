import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Always hit the DB fresh — this route must never serve a stale/cached result.
export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/queue
 *
 * Returns up to 10 prioritised leads for today's work, in this order:
 *  1. FOLLOW_UP leads whose followUpAt is today or overdue
 *  2. CONTACTED leads with no reply after 3+ days (lastContactedAt <= 3 days ago)
 *  3. NEW leads created in the last 7 days not yet actioned
 *
 * This is the "who should I contact today?" screen.
 */
export async function GET() {
  try {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    // Bucket 1: FOLLOW_UP leads due today or overdue
    const followUpDue = await prisma.lead.findMany({
      where: {
        status: 'FOLLOW_UP',
        followUpAt: { lte: endOfToday },
      },
      orderBy: { followUpAt: 'asc' },
      take: 10,
    });

    // Bucket 2: CONTACTED leads that haven't replied in 3+ days
    const staleContacted = await prisma.lead.findMany({
      where: {
        status: 'CONTACTED',
        lastContactedAt: { lte: threeDaysAgo },
      },
      orderBy: { lastContactedAt: 'asc' },
      take: 10,
    });

    // Bucket 3: NEW leads from the last 7 days
    const freshNew = await prisma.lead.findMany({
      where: {
        status: 'NEW',
        createdAt: { gte: sevenDaysAgo },
      },
      orderBy: { websiteQualityScore: 'asc' }, // lowest score = most opportunity
      take: 10,
    });

    // Merge, de-dupe by id, cap at 10 — tag each with why it's here so the
    // UI can group by reason (Overdue Follow-ups / Gone Quiet / Fresh Leads).
    const seen = new Set<string>();
    const tagged = [
      ...followUpDue.map((l) => ({ ...l, queueReason: 'OVERDUE' as const })),
      ...staleContacted.map((l) => ({ ...l, queueReason: 'STALE' as const })),
      ...freshNew.map((l) => ({ ...l, queueReason: 'FRESH' as const })),
    ];
    const queue = tagged
      .filter((l) => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      })
      .slice(0, 10);

    return NextResponse.json({
      queue,
      meta: {
        followUpDue: followUpDue.length,
        staleContacted: staleContacted.length,
        freshNew: freshNew.length,
        total: queue.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
