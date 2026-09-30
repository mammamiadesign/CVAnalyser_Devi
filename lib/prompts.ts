/**
 * The only two LLM calls in CV Wrapped.
 * Use with the Vercel AI SDK: generateObject({ model: groq(process.env.GROQ_MODEL!), schema: ExtractionSchema, system: EXTRACT_SYSTEM, prompt: cvText, temperature: 0 })
 */
import { z } from "zod";

const Discipline = z.enum([
  "product_design", "research", "service_design", "strategy",
  "engineering", "delivery", "marketing", "data", "other",
]);

const Metric = z.object({
  raw: z.string().describe("The metric EXACTLY as written in the bullet, copied character for character"),
  kind: z.enum(["before_after", "percent_change", "count", "money", "time", "rating"]),
  before: z.number().optional(),
  after: z.number().optional(),
  value: z.number().optional(),
  unit: z.enum(["%", "x", "currency", "people", "days", "items", "score", "other"]).optional(),
  label: z.string().describe("What moved, max 4 words, e.g. 'walkthrough completion'"),
});

export const ExtractionSchema = z.object({
  is_cv: z.boolean(),
  person: z.object({
    name: z.string().nullable(),
    headline: z.string().nullable().describe("The job title the person gives themselves at the top of the CV, verbatim"),
    years_stated: z.number().nullable(),
    years_source: z.enum(["stated", "estimated"]),
  }),
  pages: z.number(),
  bullets: z.array(z.object({
    id: z.string(),
    text: z.string(),
    section: z.enum(["experience", "project", "leadership", "education", "other"]),
    source: z.string(),
    lead_verb: z.string(),
    verbs: z.array(z.string()),
    people_signals: z.array(z.string()),
    scope_signals: z.array(z.string()),
    artefact_nouns: z.array(z.string()),
    metrics: z.array(Metric),
    domain: z.enum(["fintech", "healthtech", "government", "culture", "saas", "retail", "education", "media", "other"]).nullable(),
    discipline: Discipline,
  })),
});

export const EXTRACT_SYSTEM = `You extract facts from a CV. You do not judge, summarise, praise or infer personality.

Return JSON matching the schema. Rules:
- One entry per bullet point or achievement line. Copy "text" verbatim. Ignore contact details and skills lists.
- "source": the organisation or project the bullet belongs to, as named on the CV.
- "lead_verb": the first action verb, as a lowercase lemma ("led" -> "lead", "shipped" -> "ship"). If the bullet starts with a role noun ("Sole product designer delivering…"), use the first verb that follows.
- "verbs": every action verb in the bullet, lowercase lemmas.
- "people_signals": words IN THE BULLET that show other people were involved (led, aligned, facilitated, mentored, presented, stakeholders, founders, engineers…). Copy the word as written.
- "scope_signals": only these, and only if present: sole, owned, end-to-end, led, managed, independent, founded, head of.
- "artefact_nouns": designed things named IN THE BULLET (screen, flow, interface, prototype, onboarding, dashboard, design system, framework, app…).
- "metrics": every number that measures an outcome or scale. "raw" MUST be an exact substring of the bullet. Put numeric parts in before/after/value. "under 5%" -> before: 5.
- "domain": the industry of that bullet's context. "discipline": the kind of work the bullet describes.
- "years_stated": if the CV states years of experience, use it (years_source "stated"). Otherwise estimate from the earliest non-student role to today (years_source "estimated").
- "is_cv": false if this document is not a CV or résumé.
Never add information that is not in the document.`;

/** Plot-twist rewrite: one bullet, no new facts. Validate the result with validateRewrite() and drop it if it fails. */
export const REWRITE_SYSTEM = `Rewrite ONE CV bullet so it names the specific thing that was designed (a flow, screen, interface, system) and the design decision.
Rules: use only facts in the original bullet. Do not add numbers, results, tools or names that are not in it. Max 22 words. Start with a past-tense verb. Return only the rewritten bullet.`;
