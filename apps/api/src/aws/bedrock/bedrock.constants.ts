// Titan Embeddings v2 — fixed dimension. Set via the `dimensions` field on
// the invoke body; the service throws if the response length doesn't match.
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

export const DEFAULT_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';

// us-west-2 cross-region inference profile. Override via BEDROCK_LLM_MODEL_ID.
export const DEFAULT_LLM_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';

export const DEFAULT_AWS_REGION = 'us-east-1';
