import { Module } from '@nestjs/common';
import { GraderService } from './grader.service';
import { GroundTruthService } from './ground-truth.service';
import { QuestionGeneratorService } from './question-generator.service';

@Module({
  providers: [GroundTruthService, QuestionGeneratorService, GraderService],
  exports: [GroundTruthService, QuestionGeneratorService, GraderService],
})
export class EvalModule {}
