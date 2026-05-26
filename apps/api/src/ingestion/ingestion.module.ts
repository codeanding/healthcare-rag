import { Module } from '@nestjs/common';
import { ChunkerService } from './chunker.service';
import { IngestionService } from './ingestion.service';
import { PdfParserService } from './pdf-parser.service';

@Module({
  providers: [IngestionService, ChunkerService, PdfParserService],
  exports: [IngestionService],
})
export class IngestionModule {}
