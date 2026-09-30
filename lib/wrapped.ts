/**
 * CV Wrapped — deterministic logic layer.
 *
 * Principle: the LLM EXTRACTS facts (per bullet), this file DECIDES everything
 * (scores, animal, hero stat, level, plot twist). Same CV in → same Wrapped out,
 * and every claim on a card can point back to the bullets that produced it.
 *
 * The LLM is only used twice:
 *   1. extraction  (temperature 0, JSON schema below)  → Extraction
 *   2. copy polish (temperature 0.7, tiny strings only) → setup fragments + one rewrite
 */

// ─────────────────────────────────────────────────────────────
// 1. Types — what the extraction call must return
// ─────────────────────────────────────────────────────────────

export type Discipline =
  | "product_design" | "research" | "service_design" | "strategy"
  | "engineering" | "delivery" | "marketing" | "data" | "other";

export type MetricKind = "before_after" | "percent_change" | "count" | "money" | "time" | "rating";

export interface Metric {
  raw: string;            // EXACTLY as written on the CV, e.g. "from under 5% to ~31%"
  kind: MetricKind;
  before?: number;        // numeric parts, for ranking only — never displayed
  after?: number;
  value?: number;
  unit?: "%" | "x" | "currency" | "people" | "days" | "items" | "score" | "other";
  label: string;          // what moved, in ≤4 words, e.g. "walkthrough completion"
}

export interface Bullet {
  id: string;
  text: string;           // verbatim
  section: "experience" | "project" | "leadership" | "education" | "other";
  source: string;         // org or project name, e.g. "Vizara", "EY Seren"
  lead_verb: string;      // first verb, lowercase lemma: "led", "design", "ship"
  verbs: string[];        // all action verbs in the bullet, lowercase lemmas
  people_signals: string[]; // words showing other people involved: led, aligned, facilitated, mentored, presented, stakeholders…
  scope_signals: string[];  // sole, owned, end-to-end, led team, managed N, budget…
  artefact_nouns: string[]; // screen, flow, interface, prototype, onboarding, design system, dashboard…
  metrics: Metric[];
  domain: string | null;    // industry, lowercase: "fintech", "healthtech", "government", "culture"…
  discipline: Discipline;
}

export interface Extraction {
  is_cv: boolean;
  person: { name: string | null; headline: string | null; years_stated: number | null; years_source?: "stated" | "estimated" };
  pages: number;
  bullets: Bullet[];
}

// ─────────────────────────────────────────────────────────────
// 2. Verb lexicon — code decides verb families, the LLM doesn't
// ─────────────────────────────────────────────────────────────

const FRAMING = new Set([
  "research", "diagnose", "identify", "map", "scope", "frame", "define", "analyse", "analyze",
  "conduct", "discover", "audit", "investigate", "explore", "synthesise", "synthesize",
  "assess", "evaluate", "interview", "survey", "model", "forecast", "strategise", "plan",
  "prioritise", "prioritize", "ground", "reframe", "hypothesise", "test", "validate",
]);
const MAKING = new Set([
  "design", "build", "ship", "deliver", "launch", "prototype", "implement", "integrate",
  "develop", "create", "craft", "code", "deploy", "produce", "write", "redesign", "increase",
  "reduce", "cut", "improve", "solve", "own", "migrate", "automate", "handoff", "contribute",
]);
const PEOPLE = new Set([
  "lead", "led", "co-lead", "align", "facilitate", "mentor", "coach", "present", "collaborate",
  "co-develop", "coordinate", "manage", "guide", "advise", "negotiate", "partner", "workshop",
  "stakeholder", "stakeholders", "team", "teach", "hire",
]);

const lemma = (v: string) => v.toLowerCase().replace(/(ed|ing|s)$/, "").replace(/e$/, "");
const inSet = (set: Set<string>, v: string) =>
  set.has(v.toLowerCase()) || [...set].some((s) => lemma(s) === lemma(v));

// ─────────────────────────────────────────────────────────────
// 3. Axes (0 = left pole, 1 = right pole)
// ─────────────────────────────────────────────────────────────

export interface Axes {
  framing_making: number; // 0 framing … 1 making
  deep_wide: number;      // 0 deep    … 1 wide
  solo_crowd: number;     // 0 solo    … 1 crowd
}

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

export function scoreAxes(ex: Extraction): Axes & { evidence: Record<keyof Axes, string[]> } {
  const bs = ex.bullets.filter((b) => b.section !== "education");

  // Framing ↔ Making: lead verb counts 1, other verbs 0.5
  let framing = 0, making = 0;
  const fmEvidence: { id: string; w: number }[] = [];
  for (const b of bs) {
    const weigh = (v: string, w: number) => {
      if (inSet(FRAMING, v)) { framing += w; fmEvidence.push({ id: b.id, w: -w }); }
      else if (inSet(MAKING, v)) { making += w; fmEvidence.push({ id: b.id, w }); }
    };
    weigh(b.lead_verb, 1);
    b.verbs.filter((v) => v !== b.lead_verb).forEach((v) => weigh(v, 0.5));
  }
  const framing_making = framing + making === 0 ? 0.5 : making / (framing + making);

  // Deep ↔ Wide: distinct domains + distinct disciplines, each needing ≥2 bullets of evidence
  const count = (key: (b: Bullet) => string | null) => {
    const m = new Map<string, number>();
    bs.forEach((b) => { const k = key(b); if (k) m.set(k, (m.get(k) ?? 0) + 1); });
    return [...m.entries()].filter(([, n]) => n >= 2).map(([k]) => k);
  };
  const domains = count((b) => b.domain);
  const disciplines = count((b) => (b.discipline === "other" ? null : b.discipline));
  const deep_wide = clamp(((domains.length - 1) / 3) * 0.5 + ((disciplines.length - 1) / 3) * 0.5);

  // Solo ↔ Crowd: share of bullets with any people signal; 10% → 0, 70% → 1
  const peopleBullets = bs.filter(
    (b) => b.people_signals.length > 0 || inSet(PEOPLE, b.lead_verb),
  );
  const ratio = bs.length ? peopleBullets.length / bs.length : 0;
  const solo_crowd = clamp((ratio - 0.1) / 0.6);

  const top = (arr: { id: string; w: number }[], dir: 1 | -1) =>
    arr.filter((e) => Math.sign(e.w) === dir).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3).map((e) => e.id);

  return {
    framing_making, deep_wide, solo_crowd,
    evidence: {
      framing_making: top(fmEvidence, framing_making >= 0.5 ? 1 : -1),
      deep_wide: [`domains: ${domains.join(", ")}`, `disciplines: ${disciplines.join(", ")}`],
      solo_crowd: peopleBullets.slice(0, 3).map((b) => b.id),
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 4. Archetypes — fixed table (the LLM never invents these)
// ─────────────────────────────────────────────────────────────

export interface Archetype {
  id: string; animal: string; name: string; tagline: string;
  oneLiner: string; definition: string; thrives: string; watchOut: string; colour: string;
}

// key = [making?, wide?, crowd?]
export const ARCHETYPES: Record<string, Archetype> = {
  "000": { id: "owl", animal: "Owl", name: "The Owl", tagline: "The Diagnostician.", colour: "#2E3BFF",
    oneLiner: "Sees the real problem before anyone starts building.",
    definition: "Owls go deep and go quiet: long looks, sharp conclusions. You find the actual problem under the stated one.",
    thrives: "Discovery-heavy teams and research-led roles.", watchOut: "Teams that want output before understanding." },
  "001": { id: "elephant", animal: "Elephant", name: "The Elephant", tagline: "The Sense-Maker.", colour: "#FFB3D9",
    oneLiner: "Turns messy evidence into something a whole team believes.",
    definition: "Elephants remember everything and move the herd together. You synthesise deeply and bring people along with it.",
    thrives: "Research ops, insight leads, alignment-heavy programmes.", watchOut: "Teams that skip synthesis to hit a date." },
  "010": { id: "fox", animal: "Fox", name: "The Fox", tagline: "The Strategist.", colour: "#FF4F1F",
    oneLiner: "Reads every terrain and picks the route.",
    definition: "Foxes range widely and think a few moves ahead. You connect patterns across domains and choose where to go.",
    thrives: "Strategy, innovation and zero-to-one work.", watchOut: "Being parked in one narrow lane for too long." },
  "011": { id: "dolphin", animal: "Dolphin", name: "The Dolphin", tagline: "The Connector.", colour: "#D4F53C",
    oneLiner: "Joins the dots across teams, disciplines and industries.",
    definition: "Dolphins travel far and travel in pods. You frame problems across boundaries and get different people talking.",
    thrives: "Cross-functional programmes, consultancies, platform teams.", watchOut: "Siloed orgs where nobody talks across functions." },
  "100": { id: "beaver", animal: "Beaver", name: "The Beaver", tagline: "The Craftsperson.", colour: "#F5B301",
    oneLiner: "Builds it properly, down to the last edge case.",
    definition: "Beavers build things that hold. You go deep on the making and care about the details other people skip.",
    thrives: "Craft-led product teams, design systems, complex UI.", watchOut: "Endless alignment with nothing to build." },
  "101": { id: "bee", animal: "Bee", name: "The Bee", tagline: "The Systems Builder.", colour: "#D4F53C",
    oneLiner: "Makes the machine work, with everyone in it.",
    definition: "Bees build systems that run at scale, together. You make repeatable things and make them work for a team.",
    thrives: "Scale-ups, ops-heavy products, design systems teams.", watchOut: "Chaos with no process worth improving." },
  "110": { id: "octopus", animal: "Octopus", name: "The Octopus", tagline: "The Multi-Maker.", colour: "#2E3BFF",
    oneLiner: "Ships across every surface, often single-handed.",
    definition: "Eight arms, all busy. You make things across lots of mediums and contexts, and you can carry a product alone.",
    thrives: "Early-stage startups and founding-designer roles.", watchOut: "Burning out as the only person who can do everything." },
  "111": { id: "wolf", animal: "Wolf", name: "The Wolf", tagline: "Pack Leader.", colour: "#D4F53C",
    oneLiner: "Gets a cross-functional crew from a messy brief to something shipped.",
    definition: "Wolves cover a lot of ground, and they do it as a pack. You lead mixed teams through wide briefs and land them.",
    thrives: "Product teams with lots of stakeholders and fuzzy briefs.", watchOut: "Narrow, hand-me-the-spec roles." },
};

export function pickArchetype(a: Axes) {
  const key = `${+(a.framing_making >= 0.5)}${+(a.deep_wide >= 0.5)}${+(a.solo_crowd >= 0.5)}`;
  const nearMiddle = (Object.keys(a) as (keyof Axes)[]).filter((k) => Math.abs(a[k] - 0.5) < 0.05);
  return { archetype: ARCHETYPES[key], key, nearMiddle };
}

// ─────────────────────────────────────────────────────────────
// 5. Metrics — the "biggest flex"
// ─────────────────────────────────────────────────────────────
// Percent before→after is ranked by percentage-POINT gain, not ratio:
// "<1% → 13%" is a 13× ratio but only +12pp; "<5% → 31%" is +26pp and the stronger claim.

export function rankMetrics(ex: Extraction) {
  const all = ex.bullets.flatMap((b) => b.metrics.map((m) => ({ ...m, bulletId: b.id, source: b.source })));
  const score = (m: Metric) => {
    switch (m.kind) {
      case "before_after":
        if (m.unit === "%" && m.before != null && m.after != null) return 30 + Math.abs(m.after - m.before);
        if (m.before && m.after) return 30 + Math.min(Math.abs(m.after / m.before), 20) * 2;
        return 30;
      case "percent_change": return 20 + Math.min(Math.abs(m.value ?? 0), 100) / 4;
      case "money": return 18;
      case "rating": return 12;
      case "count": return 8 + Math.min(m.value ?? 0, 200) / 20;
      case "time": return 8;
    }
  };
  const ranked = all.map((m) => ({ ...m, score: score(m) })).sort((a, b) => b.score - a.score);
  const hero = ranked[0] ?? null;
  const multiplier =
    hero?.kind === "before_after" && hero.before && hero.after ? Math.round(hero.after / hero.before) : null;
  return { hero, runnersUp: ranked.slice(1, 3), multiplier, all: ranked };
}

// ─────────────────────────────────────────────────────────────
// 6. Numbers + verbs
// ─────────────────────────────────────────────────────────────

const LEMMA_DISPLAY: Record<string, string> = {
  lead: "Led", led: "Led", design: "Designed", deliver: "Delivered", map: "Mapped", ship: "Shipped",
  build: "Built", scope: "Scoped", research: "Researched", conduct: "Conducted", develop: "Developed",
  increase: "Increased", integrate: "Integrated", own: "Owned", solve: "Solved", diagnose: "Diagnosed",
  present: "Presented", mentor: "Mentored", facilitate: "Facilitated", align: "Aligned", test: "Tested",
};
const display = (v: string) => LEMMA_DISPLAY[v] ?? v.charAt(0).toUpperCase() + v.slice(1) + "ed";

export function topVerbs(ex: Extraction, n = 5) {
  const c = new Map<string, number>();
  ex.bullets.forEach((b) => new Set(b.verbs.concat(b.lead_verb)).forEach((v) => c.set(v, (c.get(v) ?? 0) + 1)));
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v, count]) => ({ verb: display(v), count }));
}

export function numbersCard(ex: Extraction) {
  const total = ex.bullets.length;
  const withNumber = ex.bullets.filter((b) => b.metrics.length > 0 || /\d/.test(b.text)).length;
  const ratio = total ? withNumber / total : 0;
  const because =
    ratio >= 0.5 ? "Half your CV comes with receipts. Numbers are what skimmers stop on."
    : ratio >= 0.25 ? "Some receipts, room for more. Numbers are what skimmers stop on."
    : "Your CV is mostly words. One number per role would change how it reads.";
  return { withNumber, total, ratio, because, show: withNumber > 0 };
}

// ─────────────────────────────────────────────────────────────
// 7. Level (Dreyfus stage, estimated) + roles
// ─────────────────────────────────────────────────────────────

export const DREYFUS = ["Novice", "Beginner", "Competent", "Proficient", "Expert"] as const;

export function level(ex: Extraction) {
  const years = ex.person.years_stated ?? 0;
  const base = years < 1 ? 0 : years < 2 ? 1 : years < 4 ? 2 : years < 8 ? 3 : 4;
  const thresholds = [1, 2, 4, 8];
  const scope = new Set(ex.bullets.flatMap((b) => b.scope_signals.map((s) => s.toLowerCase()))).size;
  // +1 only when strong scope signals AND within a year of the next band — never more than one step
  const next = thresholds[base];
  const bump = scope >= 4 && next != null && next - years <= 1 ? 1 : 0;
  const idx = Math.min(4, base + bump);
  const seniority = ["entry", "junior", "mid", "mid–senior", "senior"][idx];
  return { stage: DREYFUS[idx], index: idx, seniority, basis: { years, scopeSignals: scope } };
}

const DISCIPLINE_TITLE: Record<Discipline, string> = {
  product_design: "Product Designer", research: "UX Researcher", service_design: "Service Designer",
  strategy: "Design Strategist", engineering: "Engineer", delivery: "Delivery Lead",
  marketing: "Marketer", data: "Data Analyst", other: "Generalist",
};
const DOMAIN_COMPANIES: Record<string, string> = {
  fintech: "Fintech & banking scale-ups with a design team",
  healthtech: "HealthTech: regulated, two-sided products",
  government: "Public-sector digital consultancies",
  culture: "Museums, culture & immersive studios",
  saas: "B2B SaaS product teams",
};

/** Roles = (discipline × the domain where THAT discipline has the most evidence), no domain repeated. */
export function roles(ex: Extraction, lvl: ReturnType<typeof level>) {
  const tally = <K,>(items: K[]) => {
    const m = new Map<K, number>();
    items.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  };
  const discs = tally(ex.bullets.filter((b) => b.discipline !== "other").map((b) => b.discipline));
  const used = new Set<string>();
  const bestDomainFor = (d: Discipline) => {
    const dom = tally(ex.bullets.filter((b) => b.discipline === d && b.domain).map((b) => b.domain!))
      .find((x) => !used.has(x));
    if (dom) used.add(dom);
    return dom ? DOMAIN_COMPANIES[dom] ?? dom : null;
  };
  const primary = discs[0] ?? "other";
  const out = [
    { title: `${DISCIPLINE_TITLE[primary]} · ${lvl.seniority}`, where: bestDomainFor(primary) },
    { title: DISCIPLINE_TITLE[primary], where: bestDomainFor(primary) },
    discs[1] ? { title: DISCIPLINE_TITLE[discs[1]], where: bestDomainFor(discs[1]) } : null,
  ];
  return out.filter((r): r is { title: string; where: string } => !!r && !!r.where);
}

// ─────────────────────────────────────────────────────────────
// 8. Plot twist — first rule that fires wins
// ─────────────────────────────────────────────────────────────

const HEADLINE_DISCIPLINE: [RegExp, Discipline][] = [
  [/product design|ux design|ui design|interaction design/i, "product_design"],
  [/research/i, "research"], [/service design/i, "service_design"], [/strateg/i, "strategy"],
];

const DISCIPLINE_NOUN: Record<Discipline, string> = {
  product_design: "product design", research: "research", service_design: "service design",
  strategy: "strategy", engineering: "engineering", delivery: "delivery", marketing: "marketing",
  data: "data", other: "other work",
};

export function plotTwist(ex: Extraction, verbs: ReturnType<typeof topVerbs>, nums: ReturnType<typeof numbersCard>) {
  const headlineDisc = HEADLINE_DISCIPLINE.find(([re]) => re.test(ex.person.headline ?? ""))?.[1];
  const artefactBullets = ex.bullets.filter((b) => b.artefact_nouns.length > 0).length;
  const total = ex.bullets.length;
  const topVerb = verbs[0]?.verb ?? "";
  const topIsPeople = inSet(PEOPLE, topVerb) || inSet(FRAMING, topVerb);

  // rewrite candidate: vague lead verb + no named artefact, in the headline discipline if possible
  const VAGUE = new Set(["own", "solve", "contribute", "support", "help", "work", "handle", "manage", "responsible"]);
  const noArtefact = ex.bullets.filter((b) => b.artefact_nouns.length === 0);
  const candidate =
    noArtefact.find((b) => inSet(VAGUE, b.lead_verb) && b.discipline === headlineDisc) ??
    noArtefact.find((b) => inSet(VAGUE, b.lead_verb)) ??
    noArtefact.find((b) => inSet(MAKING, b.lead_verb)) ??
    noArtefact[0];

  if (headlineDisc === "product_design" && topIsPeople && artefactBullets / total < 0.35)
    return {
      kind: "headline_vs_verbs",
      headline: `Your headline says ${ex.person.headline}. Your #1 verb is “${topVerb}”.`,
      because: `Only ${artefactBullets} of your ${total} bullets name a screen, flow or interface.`,
      fixLabel: "Easy fix: name the thing you designed", rewriteBulletId: candidate?.id ?? null,
    };
  const headlineShare = headlineDisc
    ? ex.bullets.filter((b) => b.discipline === headlineDisc).length / total
    : 1;
  if (headlineDisc && headlineShare < 0.6) {
    const inHeadline = ex.bullets.filter((b) => b.discipline === headlineDisc).length;
    const freq = new Map<Discipline, number>();
    ex.bullets.forEach((b) => b.discipline !== headlineDisc && b.discipline !== "other" && freq.set(b.discipline, (freq.get(b.discipline) ?? 0) + 1));
    const others = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => DISCIPLINE_NOUN[d]);
    return {
      kind: "headline_share",
      headline: `Your headline says ${ex.person.headline}. Only ${inHeadline} of your ${total} bullets are about it.`,
      because: `The rest is ${others.slice(0, 2).join(" and ")}. That's range, but a skimmer looking for ${ex.person.headline?.toLowerCase()} work finds it in ${inHeadline} places.`,
      fixLabel: "Easy fix: say what you designed",
      rewriteBulletId: candidate?.id ?? null,
    };
  }
  if (nums.ratio < 0.25)
    return {
      kind: "no_receipts",
      headline: `Only ${nums.withNumber} of your ${total} bullets have a number.`,
      because: "Numbers are what skimmers stop on.",
      fixLabel: "Easy fix: add one number", rewriteBulletId: candidate?.id ?? null,
    };
  return { kind: "none", headline: "Your CV says what you do.", because: "Rare. Honestly.", fixLabel: null, rewriteBulletId: null };
}

/** A rewrite is only accepted if it introduces no new numbers and stays short. */
export function validateRewrite(original: string, rewrite: string) {
  const nums = (s: string) => new Set(s.match(/\d+(\.\d+)?/g) ?? []);
  const o = nums(original);
  const newNumbers = [...nums(rewrite)].filter((n) => !o.has(n));
  return newNumbers.length === 0 && rewrite.split(/\s+/).length <= 24;
}

// ─────────────────────────────────────────────────────────────
// 8b. Guardrails + setup copy
// ─────────────────────────────────────────────────────────────

/** Drop anything the LLM "found" that isn't literally in the bullet. Run before scoring. */
export function sanitise(ex: Extraction): Extraction {
  const has = (text: string, s: string) => text.toLowerCase().includes(s.toLowerCase());
  return {
    ...ex,
    bullets: ex.bullets.map((b) => ({
      ...b,
      metrics: b.metrics.filter((m) => has(b.text, m.raw)),
      people_signals: b.people_signals.filter((w) => has(b.text, w)),
      scope_signals: b.scope_signals.filter((w) => has(b.text, w)),
      artefact_nouns: b.artefact_nouns.filter((w) => has(b.text, w)),
    })),
  };
}

/** Card 6 fragments — templated, not generated, so they always match the axes. */
export function setupLines(a: Axes) {
  const mid = (n: number) => Math.abs(n - 0.5) < 0.05;
  return [
    mid(a.framing_making) ? "Half framing, half making." : a.framing_making >= 0.5 ? "Making." : "Framing first.",
    mid(a.deep_wide) ? "Deep and wide." : a.deep_wide >= 0.5 ? "Wide." : "Deep.",
    mid(a.solo_crowd) ? "Solo or in a pack." : a.solo_crowd >= 0.5 ? "Never alone." : "Mostly solo.",
  ];
}

// ─────────────────────────────────────────────────────────────
// 9. Everything → the story
// ─────────────────────────────────────────────────────────────

export function buildWrapped(raw: Extraction) {
  if (!raw.is_cv) throw new Error("NOT_A_CV");
  const ex = sanitise(raw);
  if (ex.bullets.length < 5) throw new Error("TOO_SHORT");
  const axes = scoreAxes(ex);
  const pick = pickArchetype(axes);
  const verbs = topVerbs(ex);
  const nums = numbersCard(ex);
  const flex = rankMetrics(ex);
  const lvl = level(ex);
  // receipts = bullets that hit the most winning poles, one per source, quoted verbatim
  const wantMaking = axes.framing_making >= 0.5, wantCrowd = axes.solo_crowd >= 0.5;
  const fit = (b: Bullet) => {
    const verbs = b.verbs.concat(b.lead_verb);
    const making = verbs.some((v) => inSet(MAKING, v)), framing = verbs.some((v) => inSet(FRAMING, v));
    const crowd = b.people_signals.length > 0 || inSet(PEOPLE, b.lead_verb);
    return (wantMaking ? +making : +framing) + (wantCrowd ? +crowd : +!crowd) + (b.metrics.length ? 0.5 : 0);
  };
  const seen = new Set<string>();
  const receipts = ex.bullets
    .filter((b) => b.section !== "education")
    .map((b) => ({ b, s: fit(b) }))
    .sort((x, y) => y.s - x.s)
    .filter(({ b }) => (seen.has(b.source) ? false : (seen.add(b.source), true)))
    .slice(0, 3);
  return {
    person: ex.person, pages: ex.pages, bulletCount: ex.bullets.length,
    numbers: nums, verbs, flex, axes, setup: setupLines(axes), archetype: pick.archetype, nearMiddle: pick.nearMiddle,
    receipts: receipts.map(({ b }) => ({ bulletId: b.id, quote: b.text, source: b.source })),
    level: lvl, roles: roles(ex, lvl), twist: plotTwist(ex, verbs, nums),
  };
}
