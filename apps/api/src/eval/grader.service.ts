import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../aws/bedrock/bedrock.service';
import { DEFAULT_JUDGE_MODEL, RUBRICS } from './eval.constants';
import type { EvalQuestion, GradeResult } from './eval.types';

const JUDGE_MODEL = process.env.BEDROCK_JUDGE_MODEL_ID ?? DEFAULT_JUDGE_MODEL;

// Grading is delegated to a Haiku-as-judge call across all three tiers. This
// avoids brittle regex extraction (the model paraphrases meds with brand names,
// embeds dates inside prose, includes unrelated digits like "1st specimen") and
// lets us evaluate the assistant on clinical correctness rather than format.
// Cost is ~$0.001 per judgement.

@Injectable()
export class GraderService {
  private readonly logger = new Logger(GraderService.name);

  constructor(private readonly bedrock: BedrockService) {}

  async grade(question: EvalQuestion, response: string): Promise<GradeResult> {
    const rubric = RUBRICS[question.tier];
    if (!rubric) {
      return { pass: false, score: 0, reason: `unknown tier ${question.tier}` };
    }

    const prompt = `You are grading a clinical assistant's answer against a deterministic ground truth.

TIER: ${question.tier}
RUBRIC:
${rubric}

QUESTION:
${question.question}

GROUND TRUTH (only authoritative source):
${JSON.stringify(question.groundTruth, null, 2)}

ASSISTANT'S RESPONSE:
${response}

Reply with ONLY a JSON object on a single line:
{"pass": true|false, "score": 0..1, "reason": "<one short sentence>"}`;

    try {
      const res = await this.bedrock.converse({
        modelId: JUDGE_MODEL,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 250, temperature: 0 },
      });
      const text =
        res.output?.message?.content
          ?.flatMap((b) => ('text' in b && b.text ? [b.text] : []))
          .join('\n')
          .trim() ?? '';
      const json = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}';
      const parsed = JSON.parse(json) as { pass?: boolean; score?: number; reason?: string };
      const score = typeof parsed.score === 'number' ? parsed.score : parsed.pass ? 1 : 0;
      return {
        pass: parsed.pass === true,
        score: Math.max(0, Math.min(1, score)),
        reason: parsed.reason ?? 'no reason given',
      };
    } catch (err) {
      this.logger.error(`judge failed: ${err instanceof Error ? err.message : String(err)}`);
      return { pass: false, score: 0, reason: 'judge error' };
    }
  }
}
