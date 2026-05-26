import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamCommandOutput,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import {
  DEFAULT_AWS_REGION,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL_ID,
  DEFAULT_LLM_MODEL_ID,
} from './bedrock.constants';
import type { TitanEmbeddingResponse } from './bedrock.types';

// Bedrock can run against a separate AWS account (e.g. one with model access
// granted) by setting BEDROCK_AWS_*. Falls back to the app-wide AWS_* /
// AWS_PROFILE chain when those aren't set.
function buildBedrockClientConfig(): BedrockRuntimeClientConfig {
  const config: BedrockRuntimeClientConfig = {
    region: process.env.BEDROCK_AWS_REGION ?? process.env.AWS_REGION ?? DEFAULT_AWS_REGION,
  };

  const accessKeyId = process.env.BEDROCK_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      sessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN,
    };
    return config;
  }

  const profile = process.env.BEDROCK_AWS_PROFILE;
  if (profile) {
    config.credentials = fromIni({ profile });
  }
  return config;
}

@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name);
  private readonly client = new BedrockRuntimeClient(buildBedrockClientConfig());
  private readonly embeddingModelId =
    process.env.BEDROCK_EMBEDDING_MODEL_ID ?? DEFAULT_EMBEDDING_MODEL_ID;
  private readonly llmModelId = process.env.BEDROCK_LLM_MODEL_ID ?? DEFAULT_LLM_MODEL_ID;

  get defaultLlmModelId(): string {
    return this.llmModelId;
  }

  async converse(
    input: Omit<ConverseCommandInput, 'modelId'> & { modelId?: string },
  ): Promise<ConverseCommandOutput> {
    const command = new ConverseCommand({
      modelId: input.modelId ?? this.llmModelId,
      ...input,
    });
    return this.client.send(command);
  }

  async converseStream(
    input: Omit<ConverseStreamCommandInput, 'modelId'> & { modelId?: string },
  ): Promise<ConverseStreamCommandOutput> {
    const command = new ConverseStreamCommand({
      modelId: input.modelId ?? this.llmModelId,
      ...input,
    });
    return this.client.send(command);
  }

  async embed(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.embeddingModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text,
        dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    });

    const response = await this.client.send(command);
    const decoded = new TextDecoder().decode(response.body);
    const parsed = JSON.parse(decoded) as TitanEmbeddingResponse;

    if (
      !Array.isArray(parsed.embedding) ||
      parsed.embedding.length !== DEFAULT_EMBEDDING_DIMENSIONS
    ) {
      throw new Error(
        `Bedrock returned malformed embedding (length=${parsed.embedding?.length ?? 'undefined'})`,
      );
    }
    return parsed.embedding;
  }
}
