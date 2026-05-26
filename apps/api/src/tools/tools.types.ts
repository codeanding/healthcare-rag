// Tool input keys come from the model and follow LLM conventions (snake_case),
// matching the schemas in tool-definitions.ts. We deliberately keep the
// `Record<string, unknown>` type — input shapes are validated per-tool inside
// ToolsService rather than by a global schema, so the model can be lenient.
export type ToolInput = Record<string, unknown>;

// Raw shape returned by the pgvector $queryRaw call in search_notes.
// snake_case here matches the SQL column names — gets normalised to
// camelCase in the response mapping.
export interface RawSearchRow {
  id: string;
  content: string;
  section: string | null;
  document_id: string;
  similarity: number;
}
