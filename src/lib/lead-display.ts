function issueList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : value ? [value] : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

export function isNoRealSiteLead(lead: {
  website?: string | null;
  websiteIssues?: unknown;
}): boolean {
  if (!lead.website) return true;
  return issueList(lead.websiteIssues).some((i) =>
    /no website|directory or social|invisible to anyone searching/i.test(i)
  );
}

/** PSI and design both failed — 2/5 was a placeholder, not a judgment. */
export function isUntestedLead(lead: {
  designScore?: number | null;
  mobileScore?: number | null;
  desktopScore?: number | null;
  website?: string | null;
  websiteQualityScore?: number | null;
  websiteIssues?: unknown;
}): boolean {
  if (lead.designScore != null) return false;
  if (lead.mobileScore != null || lead.desktopScore != null) return false;
  if (lead.websiteQualityScore === 0) return true;
  if (isNoRealSiteLead(lead)) return false;
  return true;
}

export function leadScoreLabel(lead: {
  designScore?: number | null;
  mobileScore?: number | null;
  desktopScore?: number | null;
  website?: string | null;
  websiteQualityScore?: number | null;
  websiteIssues?: unknown;
}): string {
  if (isUntestedLead(lead)) return 'UNTESTED';
  if (isNoRealSiteLead(lead)) return 'NO SITE';
  if (lead.designScore != null) return `DESIGN ${lead.websiteQualityScore}/5`;
  return `SITE ${lead.websiteQualityScore}/5 (perf)`;
}

export function parseSiteFacts(value: unknown): { whatsapp?: string | null } | null {
  if (!value) return null;
  if (typeof value === 'object') return value as { whatsapp?: string | null };
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return null; }
  }
  return null;
}
