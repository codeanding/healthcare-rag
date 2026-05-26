import { Global, Module } from '@nestjs/common';
import { BedrockService } from './bedrock/bedrock.service';
import { S3Service } from './s3/s3.service';

// Single @Global() module for all AWS service wrappers. Add new clients
// (DynamoDB, SQS, etc.) by dropping a `aws/<service>/<service>.service.ts`
// and registering it in providers + exports below.
@Global()
@Module({
  providers: [BedrockService, S3Service],
  exports: [BedrockService, S3Service],
})
export class AwsModule {}
