# CV Wrapped: logic spec

## The one principle
**The LLM extracts, code decides.** The old Skill Mapper asked the model for opinions (archetypes, confidence, "unfair advantage"). That produced a different answer every run, and nobody could explain any of it. Now the model only turns the CV into structured facts per bullet, and `lib/wrapped.ts` computes everything else. Same CV in, same Wrapped out, and every card can point to the bullets behind it.

| Step | Who | Output |
|---|---|---|
| Parse | code (unpdf / mammoth) | text, page count |
| Extract | LLM, temp 0, `ExtractionSchema` | per-bullet: verbs, people/scope signals, artefacts, metrics (verbatim), domain, discipline |
| Sanitise | code | drops any metric/signal not literally in the bullet (anti-hallucination) |
| Score + pick | code | 3 axes, animal, hero stat, verbs, level, roles, receipts, plot twist |
| Rewrite | LLM, one call | one bullet rewrite, rejected if it adds numbers or runs past 24 words |

## What replaced what
| Old | Problem | New |
|---|---|---|
| Strategy Fox + Pi-shaped/Upstream/Challenger pills + Bain archetype | three stacked taxonomies, labels with no referent | **one** system: 3 axes → 8 animals, every animal defined in a fixed table |
| "86% confidence" | LLM self-rating, uncalibrated | removed; a "Right in the middle" caption when an axis is near 0.5 |
| Radar + bar chart | bar chart counted tags (Research = 1 for a researcher); radar all ≈3 | three labelled spectrums with evidence |
| Unfair advantage paragraph | word salad | archetype one-liner + definition + 3 verbatim receipts + watch-out |
| Top role fits | no seniority, no reasoning | Dreyfus stage (years + scope signals) → seniority; roles = discipline × the domain where that discipline has most evidence |
| All skills | pills with no legend | top verbs (counted), biggest flex (ranked), plot twist (gap + fix) |

## Axes (0 → 1)
- **Framing ↔ Making**: verb families from a fixed lexicon (not the LLM). Lead verb weight 1, other verbs 0.5. Score = making / (framing + making).
- **Deep ↔ Wide**: domains and disciplines that each have ≥2 bullets of evidence. `0.5·(domains−1)/3 + 0.5·(disciplines−1)/3`.
- **Solo ↔ Crowd**: share of bullets with a people signal, mapped so 10% → 0 and 70% → 1 (designers' CVs rarely go below 10% or above 70%).
- A pole wins at ≥ 0.5. An axis within ±0.05 of the middle is flagged `nearMiddle` and the copy says so.

## 8 animals ([making, wide, crowd])
| Key | Animal | Tagline |
|---|---|---|
| 000 | Owl | The Diagnostician |
| 001 | Elephant | The Sense-Maker |
| 010 | Fox | The Strategist |
| 011 | Dolphin | The Connector |
| 100 | Beaver | The Craftsperson |
| 101 | Bee | The Systems Builder |
| 110 | Octopus | The Multi-Maker |
| 111 | Wolf | Pack Leader |

Each has a fixed one-liner, definition, "thrives in" and "watch out for" (see `ARCHETYPES`). **Next step:** commission or generate 8 illustrations in one consistent style. The reveal card depends on them.

## Biggest flex ranking
before→after > % change > money > rating > counts > time. Percentage before→after is ranked by **percentage-point gain, not ratio**: small bases inflate ratios ("<1% → 13%" is 13× but only +12pp). The ratio is only used for the copy ("A 6× jump"). Numbers are always displayed as the CV wrote them.

## Level (Dreyfus, estimated)
The base comes from years: <1 Novice, 1–2 Beginner, 2–4 Competent, 4–8 Proficient, 8+ Expert. +1 step only if there are ≥4 distinct scope signals **and** the person is within a year of the next band. Never more than one step. The UI labels it as an estimate and links to the model.

## Plot twist (first rule that fires)
1. The headline is a design role, the #1 verb is a people/framing verb, and <35% of bullets name an artefact.
2. The headline discipline accounts for <60% of bullets → "Only N of M bullets are about it".
3. <25% of bullets have a number.
4. Otherwise, the positive variant.

Always paired with **one** rewrite of a real bullet (vague lead verb + no named artefact), validated so it can't add facts.

## Tested on Devi's CV (`sample-extraction.json`)
Wolf (Making 0.64 · Wide 0.83 · Crowd 0.74) · verbs Designed ×4, Delivered ×3, Led ×3, Mapped ×3, Shipped ×2 · 11/22 bullets with numbers · hero "from under 5% to ~31%" (6×) · Proficient, mid–senior · roles: Product Designer in HealthTech; Product Designer in culture/immersive; UX Researcher in fintech · twist: "Only 11 of your 22 bullets are about it" (the rest is research and service design) · rewrite target = the "Solved the supply-side chicken-and-egg problem" bullet. Edge cases checked: <5 bullets → `TOO_SHORT`; no metrics → numbers and flex cards skip cleanly.

## Figma copy that's out of date (fix by hand: Starter-plan MCP limit reached)
The mockups were drawn before the logic was tested. Update these to match the real output above:
- **04 Top verbs**: Designed ×4, Delivered ×3, Led ×3, Mapped ×3, Shipped ×2 (the mockup has Led first)
- **05 Biggest flex runners-up**: "<1% → 13% content discovery · Vizara", "+60% positive feedback · AI trust research"
- **06 Shape**: Framing↔Making dot at 64%, caption "More making than framing."
- **09 Why the Wolf receipts**: Vizara "Sole product designer delivering end-to-end design across 5+ digital platforms…", EY Seren "Developed a Trust Pyramid framework… achieving a 60% increase in positive user feedback", and keep the HealthTech one
- **10 Roles**: 1 Product Designer · mid–senior / HealthTech · 2 Product Designer / Museums, culture & immersive studios · 3 UX Researcher / Fintech & banking scale-ups
- **11 Plot twist**: "Your headline says Product Designer. Only 11 of your 22 bullets are about it." / "The rest is research and service design…" / fix label "Easy fix: say what you designed" / original "Solved the supply-side chicken-and-egg problem…" → "Designed a pre-verification flow: GPs browse demand and build profiles, with bookings locked until credentials are approved."
- **Summary / share / export cards**: top verbs 1 Designed, 2 Delivered, 3 Led
- **01 Analysing**: "Counted your verbs" (drop the made-up "41")

## Open risks
- **Name**: "Wrapped" is Spotify's campaign name. It's fine for a portfolio piece, but pick your own name before promoting it publicly.
- **Privacy line**: only claim "nothing is stored" if your Groq/Vercel setup really doesn't retain it.
- **Lexicon coverage**: the verb lists are design-centric. Test 5 CVs from other professions and check the animals spread. If everyone becomes a Wolf, retune the thresholds.
- **Your own results are a signal**: the roles put fintech third (through research, not product design). If fintech product roles are the target, that's a CV finding, not a tool bug.
