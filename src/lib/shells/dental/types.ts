/** Locked Broadsheet dental shell — FILL is the only thing the model/operator edits. */

export type LocationPreset = 'US' | 'India' | 'Singapore' | 'Generic';
export type ShellVariant = 'full' | 'quiet';
export type ShellMode = 'designer' | 'prospect';
export type ServicesMode = 'listed' | 'generic';
export type CtaPolicy = 'auto' | 'booking' | 'whatsapp' | 'phone' | 'visit';
export type AccentName = 'cyan' | 'magenta' | 'green' | 'ochre';

export interface DentalTeamMember {
  name: string;
  role?: string;
}

export interface DentalReview {
  quote: string;
  attribution?: string;
}

export interface DentalFaqItem {
  question: string;
  answer: string;
}

export interface DentalServiceItem {
  name: string;
  category?: string;
  /** Only render if supplied. Never invent a fee. */
  price?: string;
}

export type DentalService = string | DentalServiceItem;

export interface DentalClaims {
  newPatients: boolean;
  sameDayEmergencies: boolean;
  /** Singapore — off unless operator turns on AND FILL has the note/data. */
  medisave: boolean;
  chas: boolean;
  insuranceAccepted: boolean;
  invisalign: boolean;
}

export interface DentalModules {
  hero: boolean;
  proof: boolean;
  services: boolean;
  hours: boolean;
  insurance: boolean;
  payment: boolean;
  team: boolean;
  reviews: boolean;
  faq: boolean;
  visit: boolean;
  sticky: boolean;
  claims: boolean;
}

export interface DentalShellOptions {
  variant: ShellVariant;
  locationPreset: LocationPreset;
  modules: DentalModules;
  claims: DentalClaims;
  ctaPolicy: CtaPolicy;
  servicesMode: ServicesMode;
  mode: ShellMode;
  /** Designer-only footnote (e.g. fixture provenance). Never emitted in prospect mode. */
  designerNote?: string;
}

export interface DentalFill {
  name: string;
  headline: string;
  rating_line: string;
  phone: string;
  address: string;
  city: string;
  whatsapp: string;
  country: string;
  accent: AccentName;
  services: DentalService[];
  rating: number | null;
  review_count: number | null;
  booking_url: string;
  hours: string;
  insurance: string[];
  payment_note: string;
  team: DentalTeamMember[];
  reviews: DentalReview[];
  faq: DentalFaqItem[];
  hero_image: string;
  /** Singapore scheme copy — only shown when the matching claim flag is on. */
  medisave_note: string;
  chas_note: string;
  options: DentalShellOptions;
}

export interface DentalLeadInput {
  name: string;
  rating?: string;
  reviewsCount?: string;
  phone?: string;
  website?: string;
  address?: string;
  offer?: string;
  /** Persisted scan-form / Places category. Preferred over name/heading heuristics. */
  businessType?: string | null;
  siteFacts?: {
    pagesFetched: { url: string; title: string; headings: string[]; text: string }[];
    socials?: string[];
    phones?: string[];
    capabilities?: {
      onlineBooking?: { status: string; evidence: string };
    };
  } | null;
}

export interface FillFromLeadOptions {
  variant?: ShellVariant;
  locationPreset?: LocationPreset;
  mode?: ShellMode;
  cityHint?: string;
  businessType?: string | null;
  claims?: Partial<DentalClaims>;
  modules?: Partial<DentalModules>;
  ctaPolicy?: CtaPolicy;
  servicesMode?: ServicesMode;
  designerNote?: string;
  accent?: AccentName;
}

export interface PrimaryCta {
  href: string;
  label: string;
  kind: 'booking' | 'whatsapp' | 'phone' | 'visit';
}
