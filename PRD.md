# OmniLead v2 — PRD

**Owner:** Vinos Samuel
**Date:** 2026-08-23
**Status:** Approved for implementation
**Implementing model:** read "How to use this document" before touching any code.

---

## How to use this document (instructions to the implementing model)

1. Read the current code before writing any: `src/lib/scraper.ts`, `src/app/api/scrape/route.ts`, `src/app/api/generate/route.ts`, `src/app/api/send/route.ts`, `src/app/page.tsx`, `prisma/schema.prisma`. Also read `AGENTS.md` (this repo uses Next.js 16 — check `node_modules/next/dist/docs/` for anything unfamiliar).
2. Work **one phase at a time, in order**. Do not start a phase until asked. Each phase ends with its acceptance criteria met and reported honestly.
3. Every requirement has an ID (e.g. `P1-3`). Reference IDs in commit messages.
4. **Surgical changes only.** No refactors of working code, no new features beyond this document, no new dependencies except those listed in each phase. Match the existing code style (inline styles, small modules, comments only where the code can't speak).
5. The operator of this product is **one non-technical person**. Every error they can hit must produce a plain-English message telling them what to do next. Never fail silently.
6. If a requirement seems wrong or two requirements conflict, stop and say so. Do not silently pick an interpretation.

---

## 1. Product context

OmniLead finds small local businesses with genuinely bad websites, proves it with verifiable evidence, generates a personalized cold email plus a redesigned demo site, deploys the demo, and tracks the pipeline in a built-in CRM. It is operated day-to-day by one non-technical employee; Vinos supervises and closes deals.

The current build has a working chassis (CRM, review gate, queue, deploy pipeline, send cap) and a broken sensing layer. A real test scanned a Sydney wellness studio with an excellent website; the tool scored it as an opportunity and claimed it was missing online booking, contact info, and a blog — all false. That failure class is the primary thing this PRD eliminates.

## 2. Goals and success criteria

| # | Goal | Success criterion |
|---|------|-------------------|
| G1 | **Lead & claim accuracy** | The golden regression suite (§9) passes: zero false "missing X" claims across all known-good fixture sites, and known-bad sites are correctly qualified. No email is ever sent to a guessed address. |
| G2 | **Website output quality** | For 10 demo generations against genuinely bad sites, Vinos rates ≥8 as "I would send this to the prospect." Demos contain zero fabricated facts (checked by the QA pass, §7). |
| G3 | **Operational simplicity** | The operator's daily loop (scan → review → send) never requires reading logs, editing config, or understanding a failure. Scans complete or fail loudly with a next step. Sends are blocked, with a clear reason, whenever they would be unsafe. |

## 3. Non-goals (do not build)

- Multi-tenant anything, signup, or per-user API keys. Single tenant, single shared password, as today.
- Reply tracking / inbox integration. Manual for now.
- Calendar, contract, or invoice integrations. Paste-a-link fields already exist and are enough.
- UI redesign. The Broadsheet visual system stays exactly as-is; only the specific copy/field changes named below.
- Map/Territory improvements.
- Any change to auth, deploy target, or database provider.

## 4. Known defects being fixed (from the 2026-08-23 audit)

- **F1** `websiteQualityScore` is derived only from Lighthouse *performance* (load speed), but the pitch is about design/feature quality. The funnel selects backwards: modern professional sites pass triage; outdated-but-fast sites get auto-rejected.
- **F2** Anti-hallucination grounding reads only the homepage (one static fetch, 3,000 chars, `<script>` stripped), so booking widgets and subpages (`/book`, `/blog`) are invisible — the model is told to verify claims against evidence it never receives.
- **F3** Demo is one GPT-4o call with no content inventory and no QA pass; quality ceiling is "generic template."
- **F4** Contact emails are GPT guesses (`contact@domain`) with no verification.
- **F5** `sendEmail` in `page.tsx` embeds the entire landing-page HTML inside the outreach email (Gmail clips >102KB, styling breaks, spam signal).
- **F6** Scans can exceed the 300s Vercel window (10 leads × up to 35s PSI, sequential); the client SSE parser splits on chunk boundaries without buffering and drops events.

---

## Phase 1 — Truth layer: crawl the real site, verify facts

**New module: `src/lib/site-audit.ts`.** No new dependencies (uses `fetch`, `cheerio`, `dns/promises`).

### P1-1 Multi-page crawl
`crawlSite(url: string): Promise<SiteFacts>`:
- Fetch the homepage (10s timeout, same UA string as the existing `fetchWebsiteContext`).
- Collect same-domain links from `<nav>`, header, footer, and body. Follow up to **5** additional pages whose path matches (case-insensitive): `book|appointment|schedule|reserv|contact|about|service|menu|price|pricing|blog|news|shop|store`. 8s timeout each, fetched in parallel with `Promise.allSettled`.
- For each fetched page keep: final URL, `<title>`, up to 15 headings, visible text capped at 2,500 chars.
- Any individual page failure is recorded, never thrown.

### P1-2 Widget and capability detection — BEFORE stripping scripts
On the raw HTML of every fetched page, before `$('script...').remove()`:
- Scan `script[src]`, `iframe[src]`, `link[href]`, and `a[href]` against a constant list of third-party service domains. Minimum list — booking/scheduling: `mindbodyonline, fresha, calendly, squareup, square.site, acuityscheduling, janeapp, vagaro, booksy, setmore, gettimely, glofox, opentable, resy, momence, walla, wellnessliving, zenoti, simplybook`. Live chat: `intercom, tawk.to, crisp.chat, tidio, drift, livechat`. E-commerce: `shopify, woocommerce, bigcommerce`.
- Also detect capability signals in text/markup: `mailto:` links, `tel:` links, booking-intent link text (`book now|book online|make an appointment|reserve`), a blog/news section, social profile links, copyright year in the footer, HTTPS.

### P1-3 The `SiteFacts` contract
```ts
type CapabilityStatus = 'VERIFIED_PRESENT' | 'VERIFIED_ABSENT' | 'UNKNOWN';
interface SiteFacts {
  crawledAt: string;
  pagesFetched: { url: string; title: string; headings: string[]; text: string }[];
  pagesFailed: string[];
  capabilities: {
    onlineBooking: { status: CapabilityStatus; evidence: string };
    contactInfo:   { status: CapabilityStatus; evidence: string };
    blog:          { status: CapabilityStatus; evidence: string };
    liveChat:      { status: CapabilityStatus; evidence: string };
    ecommerce:     { status: CapabilityStatus; evidence: string };
  };
  emails: { address: string; source: 'MAILTO' | 'PAGE_TEXT'; mxVerified: boolean }[];
  phones: string[];
  socials: string[];
  copyrightYear: number | null;
  https: boolean;
}
```
**The core rule:** a capability is `VERIFIED_ABSENT` only if the homepage **and** at least one relevant subpage attempt resolved (fetched or confirmed non-existent) **and** no signal was found. If any relevant fetch failed, the status is `UNKNOWN`. `evidence` states what was found or checked (e.g. `"Fresha widget on /book"`, `"checked home, /contact, /about — no booking link or widget"`).

### P1-4 Real email discovery — guessing is deleted
- Collect emails from `mailto:` links and page-text regex across all fetched pages. Filter obvious junk (`.png@`, `example.`, `sentry`, `wixpress`, `godaddy`, addresses on a different domain unless nothing else exists).
- Verify the best candidate's domain with `dns/promises` → `resolveMx()`. Set `mxVerified`.
- **Remove the `inferredEmail` behavior from `analyzeWebsiteAndReviews` entirely.** The system never invents an address. If no email is found, the lead's contact field stays empty and the UI (Phase 4) tells the operator to find it manually or call.

### P1-5 Wire into the scan + persist
- In `scrape/route.ts`, run `crawlSite` per lead alongside PSI (inside the existing per-lead `Promise.all`).
- `analyzeWebsiteAndReviews` receives `SiteFacts` instead of doing its own single fetch: the prompt's site context becomes the structured capability list + page summaries, with the instruction that only `VERIFIED_ABSENT` capabilities may be described as missing, `UNKNOWN` may not be mentioned at all.
- Schema additions to `Lead` (Prisma + Neon, use `npx prisma db push`):
  - `siteFacts String?` (JSON of `SiteFacts`)
  - `emailSource String?` — `'SCRAPED_MX_VERIFIED' | 'SCRAPED_NO_MX' | 'MANUAL' | null`

### Phase 1 acceptance
1. Run the crawl against 3 real sites Vinos names (including the Sydney studio): output `SiteFacts` shows booking/blog/contact as `VERIFIED_PRESENT` where they truly exist, with evidence strings.
2. A site that blocks fetching yields `UNKNOWN` statuses — never `VERIFIED_ABSENT`.
3. Grep confirms no code path can write a guessed email to `contactEmail`.

---

## Phase 2 — Scoring that matches the pitch

### P2-1 Design score from the real rendered site
PSI responses already contain a rendered screenshot: `lighthouseResult.audits['final-screenshot'].details.data` (base64 JPEG). Capture it from the mobile run (fall back to desktop) in `assessWebsiteQuality`.

New function `assessDesign(screenshotBase64, siteFacts)` → one `gpt-4o-mini` vision call with a fixed rubric, returning JSON:
```json
{ "designScore": 1-5, "reasons": ["..."], "confident": true|false }
```
Rubric (state it verbatim in the prompt): 1 = broken/ancient (default fonts, no mobile layout, walls of text); 3 = functional but visibly dated or cluttered; 5 = modern, professional, clearly designed this decade. Judge **only what is visible in the screenshot**; if the screenshot is blank or unreadable, return `confident: false` and no score. Never infer missing features from the screenshot — features come from `SiteFacts` only.

### P2-2 Qualification uses design, not speed
- New `Lead.designScore Int?` and `Lead.designReasons String?` (JSON).
- `websiteQualityScore` (the 1–5 triage number shown everywhere) becomes: `designScore` when confident; else the current performance bucket as fallback. Performance scores remain stored and shown as supporting evidence.
- **Auto-reject rules in `scrape/route.ts` change to:**
  - Reject "already good": `designScore >= 4` **and** blended performance ≥ 75.
  - Reject "untestable": only when **both** PSI failed **and** the crawl fetched zero pages. (Today PSI failure alone rejects — wrong: a site PSI can't test but the crawler can read is still pitchable on design/capability evidence.)
  - No website at all: keep as today — strongest lead, never auto-rejected.
- Review tab rows and detail pane show `DESIGN n/5` alongside the mobile/desktop performance tiles.

### Phase 2 acceptance
1. The Sydney studio (or equivalent known-good site) gets `designScore >= 4` and is auto-rejected as "already good," with the reason naming the design score.
2. A known outdated-but-fast site is **not** auto-rejected (today it would be) and shows a low design score.
3. Where the vision call returns `confident: false`, the lead falls back to the performance bucket and nothing crashes.

---

## Phase 3 — Demo generation: brief → build → QA

Rework `generateOutreachAssets` in `src/lib/scraper.ts` into three steps. Same model (`gpt-4o`), same storage, same UI.

### P3-1 Step A — Site brief (deterministic, no LLM)
Build a structured brief from stored data — not prose, a typed object serialized into the prompt:
- Verbatim facts: name, phone, address, rating/review count (with the existing "omit rather than invent" rules).
- Services/offerings: headings + text extracted from `SiteFacts.pagesFetched` (services/menu/price pages first).
- Brand hints: title, meta description, theme color if present.
- Capability gaps: **only** capabilities with `status: 'VERIFIED_ABSENT'`, each with its evidence string.
- Pain points from reviews (existing field).
- The offer text.

### P3-2 Step B — Generation
One `gpt-4o` call, `max_tokens: 16000`. Keep the existing prompt's structure and safety rules (respectful tone, verified-facts-only, section list, industry-appropriate palette) with these changes:
- Services section must be built **only** from the brief's extracted services. If the brief has none, use the generic-category fallback already specified — never invent named services.
- Upsell teaser sections may appear **only** for capabilities listed as `VERIFIED_ABSENT` in the brief. `UNKNOWN` gets nothing.
- Visual quality floor, added to the prompt: a distinct hero treatment, consistent spacing scale, one accent color family, visible hover/focus states, and inline SVG allowed for decorative shapes/icons (still **no** `<img>`, no external anything).

### P3-3 Step C — QA pass (one repair maximum)
Second call (`gpt-4o-mini`): input is the generated HTML plus the brief's facts and gap list. It returns JSON: `{ "violations": [ { "type": "FABRICATED_FACT" | "FORBIDDEN_CLAIM" | "BROKEN_STRUCTURE" | "MISSING_REAL_FACT", "detail": "..." } ] }` — checking: any phone/address/rating not matching the brief verbatim; any "missing/no X" claim not in the gap list; any upsell teaser without a matching gap; unclosed tags / raw markdown fences; real facts from the brief omitted from the footer.
- If violations exist: one repair call (original prompt + HTML + violation list → corrected HTML). Re-run QA once. If violations remain, save anyway but prepend a stored warning the UI shows next to the preview: *"QA found issues — review before deploying: …"*. Never send silently-flawed output.

### Phase 3 acceptance
1. Generate demos for 3 real bad-site leads: each services section traces to the crawled site; zero fabricated facts (QA pass output shown as proof).
2. Generate for a lead whose booking status is `UNKNOWN`: the demo contains no booking teaser and no "you have no booking" language anywhere.
3. Vinos-rated: demos are visibly better than the pre-PRD output on the same leads.

---

## Phase 4 — Outreach correctness and operator simplicity

### P4-1 Email content (fixes F5)
In `page.tsx` `sendEmail`:
- The email body is the operator-edited text plus the demo link **only**. Delete the landing-page HTML embed and the "Private Preview created for…" block entirely.
- Append the hardcoded demo-link paragraph only if the edited body doesn't already contain the demo URL (the generated email usually references it — no duplicates).
- Keep the compliance footer added server-side in `send/route.ts` unchanged.

### P4-2 Send safety gate (fixes F4 at the last line of defense)
In `send/route.ts`, refuse to send unless the lead's `emailSource` is `SCRAPED_MX_VERIFIED` or `MANUAL`. When the operator types an address into the Prospect Email field, the `PUT /api/leads` handler sets `emailSource: 'MANUAL'` (human-entered counts as verified-by-human). Refusal message tells the operator exactly what to do: *"This address was found automatically but its mail domain could not be verified. Confirm the address on their website, re-type it in the Prospect Email field, and send again."*

### P4-3 Scan reliability (fixes F6)
- `scrape/route.ts`: process leads with **concurrency 3** (small pool over the lead list; per-lead work is already parallel internally). Track elapsed time; at 240s, stop starting new leads, save what's done, and emit a plain-language event: *"Time limit reached — saved N of M leads. Run the scan again to pick up the rest (already-saved businesses are skipped automatically)."*
- `page.tsx` SSE client: decode with `decoder.decode(value, { stream: true })`, accumulate into a string buffer, split on `\n\n`, keep the trailing partial for the next chunk.

### P4-4 Operator-facing copy
- Review rows: when a lead qualified on design, the one-line reason leads with it (e.g. *"Dated design (2/5) · no online booking (verified) · mobile 34/100"*), built from stored evidence — never free-generated.
- Leads with no verified email show a small tag in the detail pane: *"No email found — check their website or call"*.

### Phase 4 acceptance
1. A sent email received in a real inbox (send to Vinos's own address) is short text + one link, under 20KB, footer intact.
2. Attempting to send to a lead with `emailSource: 'SCRAPED_NO_MX'` is blocked with the exact message above; typing the address manually then allows it.
3. A deliberately large scan (10 leads, slow sites) either completes or ends with the partial-save message — never a silent hang.

---

## §9 Golden regression suite

**New file: `scripts/golden-audit.ts`**, run manually with `npx tsx scripts/golden-audit.ts`. No test framework — plain script, exits non-zero on failure, prints a table.

- **Fixtures: `scripts/goldens.json`** — 10 entries `{ url, label, expect }`; 5 known-good sites (Vinos supplies, including the Sydney studio) with `expect: { autoReject: true, falseAbsentClaims: 0 }`, and 5 known-bad with `expect: { autoReject: false }`.
- For each: run `crawlSite` + PSI + `assessDesign` + the auto-reject decision. Assert:
  1. On known-good sites, **zero** capabilities marked `VERIFIED_ABSENT` that the fixture notes as present (fixture may list `has: ["onlineBooking", "blog"]`).
  2. Auto-reject decisions match `expect`.
  3. No crash on any fixture; failures degrade to `UNKNOWN`.
- This script is the definition of done for G1. It must pass before any outreach resumes, and re-pass after any future change to `site-audit.ts`, scoring, or prompts.

## §10 Schema migration (Phase 1 + 2 together)

Add to `model Lead` in `prisma/schema.prisma`:
```prisma
siteFacts     String?  // JSON — SiteFacts from the multi-page crawl
emailSource   String?  // SCRAPED_MX_VERIFIED | SCRAPED_NO_MX | MANUAL
designScore   Int?     // 1-5, vision assessment of the rendered site
designReasons String?  // JSON string[] — evidence for the design score
```
Apply with `npx prisma db push` (Neon, `DATABASE_URL` from env). No destructive changes; all new columns nullable.

## §11 Environment

No new env vars. Existing: `DATABASE_URL`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY` (also used for PSI), `RESEND_API_KEY`, `EMAIL_FROM`, `REPLY_TO_EMAIL`, `VERCEL_TOKEN`, `APP_PASSWORD`, `MAX_DAILY_SENDS`, `BUSINESS_MAILING_ADDRESS`, `CALENDAR_LINK`.

## §12 Out-of-band decisions already made (do not revisit in code)

- Target market for outreach is a **US metro** (cold email to Australia/Singapore has legal problems — the app doesn't enforce geography; the operator checklist does).
- Pricing/offer is set outside the product.
- Reply handling is manual until 3–5 deals close.
