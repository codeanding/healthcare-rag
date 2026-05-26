import { Module } from '@nestjs/common';
import { SyntheaIngestionService } from './synthea-ingestion.service';

@Module({
  providers: [SyntheaIngestionService],
  exports: [SyntheaIngestionService],
})
export class SyntheaModule {}
