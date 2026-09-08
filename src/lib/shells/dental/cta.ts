import type { CtaPolicy, DentalFill, PrimaryCta } from './types';

export function digitsForTel(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const plus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return plus ? `+${digits}` : digits;
}

export function telHref(phone: string): string {
  const d = digitsForTel(phone);
  return d ? `tel:${d}` : '';
}

export function waHref(whatsapp: string): string {
  const raw = whatsapp.trim();
  if (!raw) return '';
  const urlMatch = raw.match(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send|whatsapp\.com\/send)[^\s]*/i);
  if (urlMatch) return urlMatch[0];
  const me = raw.match(/(?:wa\.me\/)(\+?\d+)/i);
  if (me) return `https://wa.me/${me[1].replace(/^\+/, '')}`;
  const send = raw.match(/[?&]phone=(\+?\d+)/i);
  if (send) return `https://wa.me/${send[1].replace(/^\+/, '')}`;
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) return `https://wa.me/${digits}`;
  return '';
}

/**
 * Primary CTA: booking_url → WhatsApp → tel: → #visit.
 * "Book online" is used only when booking_url is set.
 */
export function resolvePrimaryCta(fill: Pick<DentalFill, 'booking_url' | 'whatsapp' | 'phone'>, policy: CtaPolicy = 'auto'): PrimaryCta {
  const booking = fill.booking_url.trim();
  const wa = waHref(fill.whatsapp);
  const tel = telHref(fill.phone);

  if (policy === 'booking' && booking) return { href: booking, label: 'Book online', kind: 'booking' };
  if (policy === 'whatsapp' && wa) return { href: wa, label: 'WhatsApp', kind: 'whatsapp' };
  if (policy === 'phone' && tel) return { href: tel, label: 'Call', kind: 'phone' };
  if (policy === 'visit') return { href: '#visit', label: 'Visit', kind: 'visit' };

  if (booking) return { href: booking, label: 'Book online', kind: 'booking' };
  if (wa) return { href: wa, label: 'WhatsApp', kind: 'whatsapp' };
  if (tel) return { href: tel, label: 'Call', kind: 'phone' };
  return { href: '#visit', label: 'Visit', kind: 'visit' };
}
