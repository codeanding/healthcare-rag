import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [ToolsModule],
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
