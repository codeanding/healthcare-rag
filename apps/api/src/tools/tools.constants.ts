// Defaults for the search_notes tool.
export const SEARCH_NOTES_DEFAULT_K = 5;
export const SEARCH_NOTES_MAX_K = 20;

// HNSW search effort — higher = better recall, more CPU. 40 is the sweet
// spot for our HNSW index (m=16, ef_construction=64). Set per-transaction
// via SET LOCAL hnsw.ef_search.
export const HNSW_EF_SEARCH = 40;

// Row caps per tool call. Generous enough that the model rarely hits them
// for a single patient, tight enough to avoid blowing context windows.
export const STRUCTURED_TAKE = 100;
export const ENCOUNTER_TAKE = 50;

// Lab queries: latest_only fans out to 500 raw rows so the dedup-by-code
// pass still finds historical labs even on heavy patients. Trend mode
// returns up to 200 raw rows.
export const LAB_TAKE_LATEST = 500;
export const LAB_TAKE_TREND = 200;
