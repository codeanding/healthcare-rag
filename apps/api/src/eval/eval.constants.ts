// Default judge model — Haiku is cheap (~$0.001/grade) and accurate enough
// for the rubrics we use. Override via BEDROCK_JUDGE_MODEL_ID.
export const DEFAULT_JUDGE_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

// Per-tier rubrics passed to the judge. Edit these to change grading
// strictness without touching service code.
export const RUBRICS: Record<string, string> = {
  factoid: `Compare the assistant's list to the ground-truth set.
PASS if the response covers ≥70% of ground-truth items (recall) AND does not
hallucinate items not in the ground truth (precision). Brand names and generic
names are equivalent (Tylenol = acetaminophen). Dosage variations don't matter.
PARTIAL CREDIT proportional to recall × precision.`,

  temporal: `The ground truth has a numeric value and/or a date. PASS if the
response correctly reports both:
  - Value within ±5% of ground-truth value
  - Date within ±2 days of ground-truth date
Brand-name vs generic naming is fine. Format ("March 15, 2024" vs "2024-03-15") is fine.`,

  reasoning: `Did the response use the ground-truth data correctly to reach a
defensible clinical conclusion? Penalise: invented data, ignored allergens,
incorrect contraindication claims. PASS if reasoning is sound and faithful to
the data, even if the conclusion is "no contradictions found".`,
};
