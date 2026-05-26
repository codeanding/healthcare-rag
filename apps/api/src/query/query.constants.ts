// Constants for the agentic loop. Tweaking these has user-visible effects
// (latency, cost, refusal rate), so changes go in PRs not configs.

// Hard cap on Converse loop iterations. Prevents runaway tool spirals when
// the model gets confused. After this many turns we yield an error event.
export const MAX_TOOL_ITERATIONS = 6;

// Per-turn output token cap. Keeps single answers under ~$0.05 with Sonnet.
export const MAX_OUTPUT_TOKENS = 1024;

// Low temperature for clinical determinism — the model should pick the
// obvious tool, not get creative.
export const TEMPERATURE = 0.2;
