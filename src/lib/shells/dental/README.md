# Broadsheet dental shell

Locked layout for **Dentists** category demos. The agent/operator fills a typed **FILL** object. CSS and section order stay fixed — no teal Bootstrap regen, no third visual identity per country.

## FILL

Required / assembled fields:

| Field | Rule |
|---|---|
| `name`, `phone`, `address`, `city`, `whatsapp`, `country` | Verbatim from the lead / crawl. Empty means omitted. |
| `headline` | Assembled if empty: city + 2+ service cats → `{city} dentistry: {cats}, in one building.` Else → `Dentistry in {city}, planned before it is started.` |
| `rating_line` | Assembled if empty from `rating` + `review_count`. |
| `services[]` | Names from the crawl only. Optional `price` only if supplied. Empty → section not in the DOM. |
| `booking_url`, `hours`, `insurance[]`, `payment_note` | Shown only when set. |
| `team[]`, `reviews[]`, `faq[]` | Never invented. Empty → section not in the DOM. |
| `hero_image` | Prospect mode: empty means no placeholder. Designer mode may show a dashed slot. |
| `accent` | `cyan` \| `magenta` \| `green` \| `ochre` (Process cyan / magenta, Clinical green, Warm ochre). |

Operator options on `FILL.options`:

- `variant`: `full` (CMYK rating numeral, wide hero, sticky bar) or `quiet` (type + proof + services + visit).
- `locationPreset`: `US` \| `India` \| `Singapore` \| `Generic` — **filters modules / CTAs / copy, not a theme.**
- `modules`, `claims`, `ctaPolicy`, `servicesMode`.
- `mode`: `designer` \| `prospect`. Prospect never emits pink FILL tokens or a fill-status footer.

All **claims default OFF** (new patients, same-day emergencies, MediSave, CHAS, insurance accepted, Invisalign). MediSave / CHAS copy is emitted only when the matching flag is on **and** FILL has the note.

## Location presets

Same Broadsheet language (serif, paper, cyan/magenta rules) everywhere.

| Preset | What changes |
|---|---|
| **US** | Insurance module may render if FILL lists plans. |
| **India** | US networks hidden. Same CTA chain if WhatsApp/booking exist. |
| **Singapore** | US networks (Delta / Cigna / Aetna / …) hidden. No MediSave / CHAS unless flags + data. Currency / fees only if FILL supplies them. Address/city accept Jurong East / `Singapore 600xxx`. Phone accepts `+65`. |
| **Generic** | Conservative: treat like India for insurance. |

Singapore **fits the same shell**. It is not a restyle. Differences are module visibility and CTA target only.

## Primary CTA

`booking_url` → WhatsApp (`wa.me` / `FILL.whatsapp`) → `tel:` → `#visit`.

The label **Book online** is used only when `booking_url` is set. Singapore clinics often resolve to WhatsApp; that is the same chain, not a special theme.

## Honesty

- Empty arrays / blank strings → that section is not in the DOM.
- Prospect + empty image → no dashed placeholder.
- Prospect → no pink tokens, no fill-status footer.
- Banned marketing phrases (`seamlessly`, `elevate`, `unlock`, `journey`, `smile of your dreams`, …) are rewritten via a string table. The page is never regenerated to “sound nicer.”
- Do not invent team, reviews, FAQ, Invisalign, or prices.

## How generate uses this

`generateOutreachAssets` in `src/lib/scraper.ts`:

1. If the lead looks like **Dentists / dental** (`businessType`, name, site headings), derive FILL from SiteFacts + lead fields (`fillFromLead`, Quiet + prospect by default — no photos in the pipeline).
2. Compile a self-contained `index.html` string (`renderDentalShell`) into `landingPageHtml` for the existing deploy path.
3. Email is a FILL-based template; GPT may rewrite the email only when an API key is present.
4. **GPT HTML is fallback only** if the shell throws. Non-dental categories still use the existing GPT page path.

## Fixtures

| Id | What |
|---|---|
| `us-ridgeway` | Full + designer. Optional new-patients claim. Insurance only because FILL lists US plans. |
| `india-hadapsar` | Quiet. No insurance. Claims off. |
| `singapore-jurong-east` | Quiet. WhatsApp CTA. No insurance. All claims off. Designer footer note only. |

Render and assert:

```bash
npx --yes tsx scripts/render-dental-fixtures.ts
```

HTML lands in `src/lib/shells/dental/previews/`.
