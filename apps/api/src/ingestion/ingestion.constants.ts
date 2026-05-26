// Module-wide constants for ingestion. Values picked per SPEC §3.2.

// Bedrock embedding fan-out cap. Stays under Titan v2 TPM limits even on
// large PDFs (~hundreds of chunks). Tune via Bedrock account quotas.
export const EMBEDDING_CONCURRENCY = 8;

// ----- Chunker -----

// English averages ~4 chars/token (cheap heuristic; we don't run a real
// tokenizer at chunking time — that's a Bedrock-side concern).
export const CHARS_PER_TOKEN = 4;

// Lines longer than this are unlikely to be section headings.
export const HEADING_MAX_LEN = 80;

// Patterns that mark a line as a probable section heading. First match wins.
export const HEADING_PATTERNS: readonly RegExp[] = [
  /^#{1,6}\s+\S/, // markdown header
  /^\d+(\.\d+)*\.?\s+\S/, // "1." or "1.2.3 Section"
  /^[IVX]+\.\s+\S/, // roman numerals
  /^[A-Z][A-Z0-9 \-/]{2,}$/, // ALL CAPS headings
];

// Default chunker tokens — token approximated as 4 chars (see CHARS_PER_TOKEN).
export const DEFAULT_MAX_TOKENS = 512;
export const DEFAULT_OVERLAP_TOKENS = 75;
export const DEFAULT_MIN_TOKENS = 50;
