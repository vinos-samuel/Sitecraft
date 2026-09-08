export type {
  AccentName,
  CtaPolicy,
  DentalClaims,
  DentalFaqItem,
  DentalFill,
  DentalLeadInput,
  DentalModules,
  DentalReview,
  DentalService,
  DentalServiceItem,
  DentalShellOptions,
  DentalTeamMember,
  FillFromLeadOptions,
  LocationPreset,
  PrimaryCta,
  ServicesMode,
  ShellMode,
  ShellVariant,
} from './types';

export {
  assembleHeadline,
  assembleRatingLine,
  BANNED_PHRASE_TABLE,
  buildDentalOutreachEmail,
  rewriteBannedPhrases,
  serviceName,
} from './copy';

export {
  countryForPreset,
  defaultModules,
  emptyClaims,
  extractCity,
  filterInsurance,
  inferLocationPreset,
  US_INSURANCE_NETWORKS,
} from './presets';

export { digitsForTel, resolvePrimaryCta, telHref, waHref } from './cta';

export { fillFromLead, isDentalLead, normalizeFill, parseRating, parseReviewCount } from './fill';

export { renderDentalShell } from './render';

export {
  DENTAL_FIXTURES,
  INDIA_HADAPSAR,
  SINGAPORE_JURONG,
  US_RIDGEWAY,
} from './fixtures';
export type { DentalFixture } from './fixtures';
