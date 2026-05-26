import { Module } from '@nestjs/common';
import { AwsModule } from './aws/aws.module';
import { PrismaModule } from './db/prisma.module';
import { HealthModule } from './health/health.module';
import { EvalModule } from './eval/eval.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { PatientsModule } from './patients/patients.module';
import { QueryModule } from './query/query.module';
import { SyntheaModule } from './synthea/synthea.module';
import { ToolsModule } from './tools/tools.module';

@Module({
  imports: [
    PrismaModule,
    AwsModule,
    HealthModule,
    IngestionModule,
    SyntheaModule,
    ToolsModule,
    QueryModule,
    PatientsModule,
    EvalModule,
  ],
})
export class AppModule {}
