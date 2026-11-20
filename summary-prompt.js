// Instructions for the AI summary, and strict checks on what goes in and comes out.
// The AI only ever sees rounded numbers (in $ millions) and two labels. No names, no addresses.

const SYSTEM_PROMPT = `You explain a Pacific Palisades homeowner's scenario results in plain, warm, everyday language, after the January 2025 Palisades fire.

Rules:
- Use only the numbers provided. Never invent figures, market data, or facts about the neighborhood.
- Write dollar amounts like "$3.3M" or "$950K".
- Do not tell them what to do. Never say they should sell, hold, rebuild or stay. Describe what the numbers show and what the result depends on.
- No tax, legal or financial advice. Point to questions for a CPA, realtor or insurer instead.
- These are projections under an assumed recovery speed, not predictions. Say so briefly if it helps.
- "summary": 2 or 3 short sentences.
- "questions": 2 or 3 specific questions they could bring to a CPA, realtor or insurer, based on these results.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "questions"],
  properties: {
    summary: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
};

// Exactly these fields, each a number in a sane range (or one of the allowed labels).
const NUMBER_FIELDS = {
  sellInYears: [1, 15], sellNow: [-100, 100], sellLater: [-100, 100], breakEven: [-100, 200],
  breakEvenGrowthPct: [-100, 100], homeValue: [0, 100], outOfPocket: [0, 100],
  slowSellLater: [-100, 100], fastSellLater: [-100, 100],
  overrunPct: [0, 60], premiumGrowthPct: [0, 50], returnPct: [0, 10],
};
const LABELS = { situation: ["lot", "rebuilding", "standing"], speed: ["slow", "typical", "fast"] };

// Returns a clean copy, or null if anything is missing, extra or out of range.
function validateNumbers(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const allowed = new Set([...Object.keys(NUMBER_FIELDS), ...Object.keys(LABELS)]);
  if (Object.keys(input).some((k) => !allowed.has(k))) return null;
  const out = {};
  for (const [k, opts] of Object.entries(LABELS)) {
    if (!opts.includes(input[k])) return null;
    out[k] = input[k];
  }
  for (const [k, [lo, hi]] of Object.entries(NUMBER_FIELDS)) {
    const v = input[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return null;
    out[k] = Math.round(v * 100) / 100;
  }
  return out;
}

const SITUATION_TEXT = {
  lot: "Their home burned. They are comparing selling the lot now, rebuilding and then selling, and rebuilding and staying.",
  rebuilding: "They are already rebuilding. They are comparing selling when it is finished, finishing and selling later, and staying.",
  standing: "Their home survived the fire. They are comparing selling now, holding and selling later, and staying.",
};

function buildUserMessage(n) {
  return [
    SITUATION_TEXT[n.situation],
    `Recovery speed they chose: ${n.speed}. Later sale happens in ${n.sellInYears} years.`,
    `All money in $ millions, rounded:`,
    `- Selling early nets ${n.sellNow}.`,
    `- Selling later nets ${n.sellLater} (slow recovery ${n.slowSellLater}, fast ${n.fastSellLater}).`,
    `- Break-even sale price for the later sale: ${n.breakEven}, which means values changing about ${n.breakEvenGrowthPct}% a year from the home's value of ${n.homeValue}.`,
    `- Rebuild costs not covered by insurance: ${n.outOfPocket}.`,
    `Their assumptions: rebuild cost overrun ${n.overrunPct}%, insurance premiums rising ${n.premiumGrowthPct}% a year, sale money earning ${n.returnPct}% a year.`,
  ].join("\n");
}

// Keep the AI's answer short and plain text. The page shows it as text, never as HTML.
function cleanAnswer(a) {
  if (!a || typeof a.summary !== "string" || !Array.isArray(a.questions)) throw new Error("bad answer");
  const clip = (s, n) => String(s).replace(/\s+/g, " ").trim().slice(0, n);
  return {
    summary: clip(a.summary, 700),
    questions: a.questions.filter((q) => typeof q === "string" && q.trim()).slice(0, 3).map((q) => clip(q, 240)),
  };
}

module.exports = { SYSTEM_PROMPT, RESPONSE_SCHEMA, validateNumbers, buildUserMessage, cleanAnswer, NUMBER_FIELDS };
