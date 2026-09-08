import type { DentalClaims, DentalModules, LocationPreset, ShellVariant } from './types';

/** US network names — hidden unless locationPreset is US. */
export const US_INSURANCE_NETWORKS = [
  'delta', 'cigna', 'aetna', 'metlife', 'guardian', 'humana',
  'unitedhealthcare', 'united healthcare', 'uhc', 'blue cross',
  'blue shield', 'bcbs', 'ameritas', 'principal', 'geha',
  'anthem', 'ppo',
];

export function emptyClaims(): DentalClaims {
  return {
    newPatients: false,
    sameDayEmergencies: false,
    medisave: false,
    chas: false,
    insuranceAccepted: false,
    invisalign: false,
  };
}

export function defaultModules(variant: ShellVariant, preset: LocationPreset): DentalModules {
  const full = variant === 'full';
  return {
    hero: true,
    proof: true,
    services: true,
    hours: true,
    // Insurance is a US module. Other presets keep the slot available only
    // if the operator turns it on and FILL actually has non-US names.
    insurance: preset === 'US',
    payment: true,
    team: true,
    reviews: true,
    faq: true,
    visit: true,
    sticky: full,
    claims: true,
  };
}

export function countryForPreset(preset: LocationPreset): string {
  if (preset === 'US') return 'United States';
  if (preset === 'India') return 'India';
  if (preset === 'Singapore') return 'Singapore';
  return '';
}

export function isUsInsuranceName(name: string): boolean {
  const lower = name.toLowerCase();
  return US_INSURANCE_NETWORKS.some((n) => lower.includes(n));
}

/** Filter insurance names for the active preset. Never a theme swap. */
export function filterInsurance(names: string[], preset: LocationPreset): string[] {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (preset === 'US') return cleaned;
  return cleaned.filter((n) => !isUsInsuranceName(n));
}

export function inferLocationPreset(blob: string, phone = ''): LocationPreset {
  const text = `${blob} ${phone}`.toLowerCase();
  if (
    /\bsingapore\b/.test(text)
    || /\b\+65\b/.test(text)
    || /^\s*\+65/.test(phone)
    || /singapore\s*6\d{5}/i.test(blob)
  ) {
    return 'Singapore';
  }
  if (
    /\bindia\b/.test(text)
    || /\b\+91\b/.test(text)
    || /^\s*\+91/.test(phone)
    || /\b(hadapsar|pune|mumbai|bengaluru|bangalore|hyderabad|chennai|delhi|kolkata|maharashtra|karnataka|tamil nadu|gujarat|kerala)\b/i.test(text)
  ) {
    return 'India';
  }
  if (
    /\b(united states|usa|\bu\.s\.a\.?\b|\bu\.s\.\b)\b/i.test(text)
    || /^\s*\+1/.test(phone)
    || /,\s*[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(blob)
  ) {
    return 'US';
  }
  return 'Generic';
}

export function extractCity(address: string, hint = ''): string {
  if (hint.trim()) return hint.trim();
  if (!address.trim()) return '';

  const sgNamed = address.match(/([A-Za-z][A-Za-z0-9 .'-]+?),\s*Singapore\b/i);
  if (sgNamed) {
    const city = sgNamed[1].trim().replace(/^Blk\s+\d+\s+/i, '');
    if (city && !/^singapore$/i.test(city)) return city;
  }

  const us = address.match(/([A-Za-z][A-Za-z .'-]+),\s*[A-Z]{2}\s+\d{5}/);
  if (us) return us[1].trim();

  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^(singapore|india|usa|united states)$/i.test(p)) {
      return (parts[i - 1] ?? '').replace(/\s+\d{5,6}\b.*$/, '').trim();
    }
    if (/^[A-Z]{2}\s+\d{5}/.test(p) && parts[i - 1]) return parts[i - 1];
    if (/^singapore\s+\d{5,6}/i.test(p) && parts[i - 1]) return parts[i - 1];
  }
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\s+\d{5,6}\b.*$/, '').trim();
  return parts[0]?.replace(/\s+\d{5,6}\b.*$/, '').trim() ?? '';
}
