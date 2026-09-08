import { normalizeFill } from './fill';
import type { DentalFill } from './types';

export interface DentalFixture {
  id: string;
  label: string;
  fill: DentalFill;
}

/** US Ridgeway-style Full designer preview. Claims optional (new patients on). */
export const US_RIDGEWAY: DentalFill = normalizeFill({
  name: 'Ridgeway Family Dental',
  city: 'Ridgeway',
  country: 'United States',
  address: '214 Main Street, Ridgeway, VA 24148',
  phone: '(276) 555-0148',
  rating: 4.8,
  review_count: 112,
  services: [
    { name: 'Check-ups', category: 'check-ups' },
    { name: 'Fillings', category: 'restorative' },
    { name: 'Crowns', category: 'crowns' },
  ],
  hours: 'Mon–Thu 8:00–17:00 · Fri 8:00–13:00',
  insurance: ['Delta Dental', 'Cigna'],
  booking_url: 'https://example.com/book',
  hero_image: '',
  options: {
    variant: 'full',
    locationPreset: 'US',
    mode: 'designer',
    ctaPolicy: 'auto',
    servicesMode: 'listed',
    designerNote: 'Designer fixture — Ridgeway Full preview. Claims optional; insurance listed only because FILL supplied US plan names.',
    claims: {
      newPatients: true,
      sameDayEmergencies: false,
      medisave: false,
      chas: false,
      insuranceAccepted: true,
      invisalign: false,
    },
    modules: {
      hero: true,
      proof: true,
      services: true,
      hours: true,
      insurance: true,
      payment: true,
      team: true,
      reviews: true,
      faq: true,
      visit: true,
      sticky: true,
      claims: true,
    },
  },
});

/** India Hadapsar Quiet preview. No US insurance, claims off. */
export const INDIA_HADAPSAR: DentalFill = normalizeFill({
  name: 'Hadapsar Dental Practice',
  city: 'Hadapsar',
  country: 'India',
  address: 'Hadapsar, Pune, Maharashtra 411028',
  phone: '+91 20 4123 5600',
  rating: 4.6,
  review_count: 87,
  services: [
    { name: 'Check-ups', category: 'check-ups' },
    { name: 'Fillings', category: 'restorative' },
    { name: 'Root canal', category: 'endodontics' },
  ],
  hours: 'Mon–Sat 10:00–20:00',
  insurance: [],
  options: {
    variant: 'quiet',
    locationPreset: 'India',
    mode: 'designer',
    ctaPolicy: 'auto',
    servicesMode: 'listed',
    designerNote: 'Designer fixture — Hadapsar Quiet preview. No insurance module; claims off.',
    claims: {
      newPatients: false,
      sameDayEmergencies: false,
      medisave: false,
      chas: false,
      insuranceAccepted: false,
      invisalign: false,
    },
    modules: {
      hero: true,
      proof: true,
      services: true,
      hours: true,
      insurance: false,
      payment: true,
      team: true,
      reviews: true,
      faq: true,
      visit: true,
      sticky: false,
      claims: true,
    },
  },
});

/**
 * Singapore Jurong East Quiet preview. Same Broadsheet shell.
 * WhatsApp CTA; no US insurance; all claims off; no invented fees.
 */
export const SINGAPORE_JURONG: DentalFill = normalizeFill({
  name: 'Jurong East Dental Practice',
  city: 'Jurong East',
  country: 'Singapore',
  address: 'Blk 135 Jurong East Street 13, #01-08, Singapore 600135',
  phone: '+65 6561 4400',
  whatsapp: '+65 6561 4400',
  rating: 4.5,
  review_count: 64,
  services: [
    { name: 'Check-ups', category: 'check-ups' },
    { name: 'Fillings', category: 'restorative' },
  ],
  hours: 'Tue–Sun 10:00–18:00',
  insurance: [],
  payment_note: '',
  medisave_note: '',
  chas_note: '',
  options: {
    variant: 'quiet',
    locationPreset: 'Singapore',
    mode: 'designer',
    ctaPolicy: 'auto',
    servicesMode: 'listed',
    designerNote: 'Designer fixture — public-facts pattern for a Jurong East clinic (placeholder name). WhatsApp CTA; no insurance; all claims off. Not a live outreach page.',
    claims: {
      newPatients: false,
      sameDayEmergencies: false,
      medisave: false,
      chas: false,
      insuranceAccepted: false,
      invisalign: false,
    },
    modules: {
      hero: true,
      proof: true,
      services: true,
      hours: true,
      insurance: false,
      payment: true,
      team: true,
      reviews: true,
      faq: true,
      visit: true,
      sticky: false,
      claims: true,
    },
  },
});

export const DENTAL_FIXTURES: DentalFixture[] = [
  { id: 'us-ridgeway', label: 'US Ridgeway Full (designer)', fill: US_RIDGEWAY },
  { id: 'india-hadapsar', label: 'India Hadapsar Quiet (designer)', fill: INDIA_HADAPSAR },
  { id: 'singapore-jurong-east', label: 'Singapore Jurong East Quiet (designer)', fill: SINGAPORE_JURONG },
];
