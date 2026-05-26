// Wire format of Titan Embeddings v2 invoke responses. Internal — not exposed
// outside BedrockService.
export interface TitanEmbeddingResponse {
  embedding: number[];
  inputTextTokenCount?: number;
}
