# v0 prompt: CV Wrapped (rebuild of Skill Mapper)

Import the `cv-wrapped` GitHub repo into v0, then paste everything below the line.

---

Rebuild my existing Next.js app "Skill Mapper" as **CV Wrapped**: upload a CV and get a Spotify Wrapped-style story about how the CV reads. It's personality-first, mobile-first and shareable. The logic is already in the repo (`lib/wrapped.ts`, `lib/prompts.ts`, `lib/sample-extraction.json`). Use it as the source of truth.

**Assets:** the 8 animal illustrations are `/public/animals/{archetype.id}.png` (800×800, black background). Show them cropped to a circle or rounded square. **Design references:** `/design/*.png`. They show layout and visual style. Headings, labels and button text in them are real copy, so use them as written. Anything person-specific (name, numbers, verbs, quotes, roles, animal, level, plot twist) is sample data. Never hard-code it; it comes from `buildWrapped()`. **Do not rewrite the scoring logic, and do not let the LLM decide scores, animals or levels.**

## Stack
- Next.js App Router, TypeScript, Tailwind, Framer Motion
- Vercel AI SDK + Groq (`@ai-sdk/groq`). The model id comes from `process.env.GROQ_MODEL`.
- Parse PDFs with `unpdf` and DOCX with `mammoth`. Export images with `html-to-image`.
- No database and no file storage. Process the CV in memory and discard it.

## Architecture
1. `POST /api/wrap` (multipart file):
   parse → `generateObject({ schema: ExtractionSchema, system: EXTRACT_SYSTEM, temperature: 0 })` → `buildWrapped(extraction)` → if `twist.rewriteBulletId`, one `generateText` call with `REWRITE_SYSTEM`, kept only if `validateRewrite()` passes → return JSON.
2. Stream progress to the client as the 4 real stages resolve (parse, extract, score, copy), using server-sent events or a streamed response.
3. `/` = upload. `/wrapped` = story player (the result is held in client state; no URL persistence in v1).
4. **Build the UI first against `buildWrapped(sampleExtraction)`**, then wire up the API.

## Design tokens
- Colours: paper `#F2EFE8`, ink `#111111`, vermilion `#FF4F1F`, cobalt `#2E3BFF`, lime `#D4F53C`, pink `#FFB3D9`, grey `#6B6B6B`
- Fonts (next/font/google): **Bricolage Grotesque** 800 for display (tracking −3% to −5%, line-height 0.85–0.95), **Instrument Sans** 400–700 for UI, **Instrument Serif Italic** for the "because" voice (one line per card that explains why a claim is true)
- Story card: 390×844 logical size, radius 28, padding 24 / 16 top / 28 bottom. Layout per card: chrome (progress + header) at the top, content in the middle, actions at the bottom (space-between)
- Style: editorial bold. One idea per card, huge type, one accent colour per card, occasional big geometric shape (circle, bar, 14-point star). No gradients, no glassmorphism, no emoji.

## Story player
- 11 segmented progress bars at the top, and a header with a "CV WRAPPED" wordmark and a close ✕
- Tap right third = next, left third = back, press and hold = pause, swipe down or Esc = exit, ← → keys on desktop
- **No auto-advance.** The cards are text-heavy (and WCAG 2.2.2 applies). Show a subtle "Tap to continue" on the first card only.
- Desktop: the 390px story is centred on an ink background, with click zones and keyboard support
- Card transition: 250ms slide and fade. Respect `prefers-reduced-motion` (cross-fade only).
- Every card except Setup and Plot twist has a "Share this card" pill bottom-left and "n / 11" bottom-right

## Screens (data bindings = the `buildWrapped()` output)
0. **Upload.** Headline "Your CV, Wrapped.", one sentence, dropzone (PDF/DOCX, 5 MB, validated on drop), and a privacy line (only ship it if it's true). The "Wrap my CV" CTA is disabled until a valid file is attached. On desktop, a split layout with a tilted phone preview of the reveal card.
1. **Analysing** (ink). "Reading your CV…" with 4 named steps ticking off as the real stages resolve and showing real counts (pages, bullets). Use `aria-live="polite"`. On error, name the failed step and offer a retry. Errors: `NOT_A_CV` → "This doesn't look like a CV." `TOO_SHORT` → "Your CV needs a few more bullet points for a proper Wrapped." Unreadable PDF → "We couldn't read text from this PDF. Is it a scan? Try a DOCX."
2. **Intro** (vermilion). Small label "{name} · {headline}", display "We read your CV.", serif "All {bulletCount} bullet points of it.", body "Let's see what it says about you."
3. **By the numbers** (paper). Huge vermilion `numbers.withNumber`, "of your {total} bullets have a number in them.", serif `numbers.because`. If `!numbers.show`, skip this card.
4. **Top verbs** (paper). Title "Your most-used verbs". Ranked 1–5 with each verb in an ink box with paper text (the #1 verb is larger), and "×count" in grey. Serif provenance line "Counted across all {bulletCount} bullet points." Tapping a verb shows the bullets it came from.
5. **Biggest flex** (cobalt). Label, then `flex.hero` shown as before → after when `kind === "before_after"`, with the after value huge in lime. Label, then serif "A {multiplier}× jump. The kind of line people remember after the interview." Show 2 runners-up with source. **Show numbers exactly as the CV writes them (keep "~" and "under").** If there's no hero, skip the card.
6. **Your shape** (paper). Three labelled spectrums: Framing↔Making, Deep↔Wide, Solo↔Crowd. Each is a track with 5 ticks and a vermilion dot at the axis value. The pole it leans to is ink and the other pole grey, with a serif caption under each. Footer "Based on how each bullet starts, and who else is in it." If an axis is in `nearMiddle`, the caption reads "Right in the middle. Rarer than you'd think."
7. **Setup** (ink). The three `setup` lines in huge display, then lime serif "Put that together and you're…", then "Tap to reveal". No share button.
8. **Reveal** (archetype colour). the animal illustration `/public/animals/{archetype.id}.png` at 240px, in a circle, "YOUR WORK ANIMAL IS", `archetype.name` in huge display, serif `archetype.tagline`, one line of `archetype.oneLiner`. The badge scales in 0.6 → 1 with an overshoot.
9. **Why the {animal}?** (paper). `archetype.definition`, then "THE RECEIPTS": 3 verbatim `receipts` quotes, truncated with "…", with a vermilion left rule and the source label. Then an ink box "WATCH OUT FOR" with `archetype.watchOut`.
10. **Where you'd thrive** (pink). A 5-step Dreyfus ladder (Novice, Beginner, Competent, Proficient, Expert) with steps filled up to `level.index`, and a serif line explaining the stage. An ⓘ opens "Estimated from years + scope signals, based on the Dreyfus model of skill acquisition." Then up to 3 `roles` rows: title + where.
11. **Plot twist** (ink). Vermilion label "PLOT TWIST", `twist.headline` in display, `twist.because` in lime serif, then an outlined box: `twist.fixLabel`, the original bullet (faded serif) → the rewrite. The CTA is "Copy the rewrite" (not share). If `twist.kind === "none"`, show the positive variant.
12. **Summary** (ink). "That's a wrap." plus the summary card (archetype colour): animal illustration (64px circle), "I'm a {animal}." + tagline, top 3 verbs, biggest flex, shape as "Making · Wide · Crowd", and a footer with the wordmark and URL. Buttons: "Share my Wrapped" and "↺ Replay". Below that, a "See the full breakdown" link to a scrollable detail view (all metrics, all receipts, skills by level).

## Share sheet
Opens as a bottom sheet with a live preview of the card:
- Format toggle: Story 9:16 (1080×1920) or Post 4:5 (1080×1350)
- Colourway: 5 swatches
- "Hide my name" toggle
- Actions: LinkedIn, Instagram, Download, Copy link. Use the Web Share API with files where supported, and fall back to download.

Keep all text on exported images ≥ 24px at 1080 width.

## Accessibility
- Contrast AA on every card (lime is only used on ink or cobalt)
- Focus rings, and all tap zones reachable by keyboard
- Every card has a visually hidden heading
- Spectrums expose their value as text, e.g. "Making, 64%"

## Don'ts
- No radar charts, no bar chart of tag counts, no confidence percentages
- No text the LLM invents about the person beyond the one validated rewrite
- No zeros on share cards
