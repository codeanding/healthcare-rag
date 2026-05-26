import { Module } from '@nestjs/common';
import { ToolsService } from './tools.service';

@Module({
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
