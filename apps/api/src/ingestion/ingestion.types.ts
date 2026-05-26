// Public + module-internal types for the ingestion module.

export interface IngestionResult {
  documentId: string;
  chunkCount: number;
  documentTitle: string;
}

// ----- Chunker -----

export interface ChunkerOptions {
  maxTokens: number;
  overlapTokens: number;
  minTokens: number;
}

export interface Chunk {
  content: string;
  section: string | null;
  pageNumber: number;
  chunkIndex: number;
}

// ----- PDF parser -----

export interface ParsedPdf {
  text: string;
  documentTitle: string;
  pages: PdfPage[];
}

export interface PdfPage {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
}
