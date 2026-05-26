import { Injectable } from '@nestjs/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class S3Service {
  private readonly client = new S3Client({
    region: process.env.AWS_REGION ?? 'us-east-1',
  });
  private readonly defaultBucket = process.env.S3_DOCUMENTS_BUCKET;

  async getObject(key: string, bucket?: string): Promise<Buffer> {
    const targetBucket = bucket ?? this.defaultBucket;
    if (!targetBucket) {
      throw new Error('S3 bucket not provided and S3_DOCUMENTS_BUCKET is not set');
    }
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: targetBucket, Key: key }),
    );
    if (!response.Body) {
      throw new Error(`S3 object s3://${targetBucket}/${key} returned empty body`);
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }
}
