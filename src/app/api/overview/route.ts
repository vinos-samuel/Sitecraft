import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/overview — rollup metrics for remote supervision without clicking
// through every lead: pipeline counts, reply/close rate, revenue, recent activity.
export async function GET() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalLeads, byStatusRaw, closedLeads, recentActivity, scansThisWeek, emailsSentThisWeek, emailsSentTotal, demosDeployedTotal] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.groupBy({ by: ['status'], _count: { status: true } }),
      prisma.lead.findMany({ where: { status: 'CLOSED' }, select: { dealValue: true } }),
      prisma.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.activity.count({ where: { type: 'SCAN', createdAt: { gte: sevenDaysAgo } } }),
      prisma.activity.count({ where: { type: 'EMAIL_SENT', createdAt: { gte: sevenDaysAgo } } }),
      prisma.activity.count({ where: { type: 'EMAIL_SENT' } }),
      prisma.activity.count({ where: { type: 'DEMO_DEPLOYED' } }),
    ]);

    const byStatus: Record<string, number> = {};
    byStatusRaw.forEach((r) => { byStatus[r.status] = r._count.status; });

    // "Contacted or beyond" = ever reached out to. Reply rate / close rate are both
    // measured against that denominator, not against total leads scanned.
    const contactedOrBeyond = (byStatus['CONTACTED'] ?? 0) + (byStatus['FOLLOW_UP'] ?? 0) + (byStatus['REPLIED'] ?? 0) + (byStatus['CLOSED'] ?? 0) + (byStatus['LOST'] ?? 0);
    const repliedOrBeyond = (byStatus['REPLIED'] ?? 0) + (byStatus['CLOSED'] ?? 0);
    const closedCount = byStatus['CLOSED'] ?? 0;
    const totalClosedRevenue = closedLeads.reduce((sum, l) => sum + (l.dealValue ?? 0), 0);

    return NextResponse.json({
      totalLeads,
      byStatus,
      scansThisWeek,
      emailsSentThisWeek,
      emailsSentTotal,
      demosDeployedTotal,
      contactedOrBeyond,
      replyRate: contactedOrBeyond > 0 ? repliedOrBeyond / contactedOrBeyond : null,
      closeRate: contactedOrBeyond > 0 ? closedCount / contactedOrBeyond : null,
      totalClosedRevenue,
      recentActivity,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
