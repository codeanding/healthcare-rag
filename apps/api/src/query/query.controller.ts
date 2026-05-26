import {
  BadRequestException,
  Body,
  Controller,
  type MessageEvent,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../db/prisma.service';
import type { QueryDto } from './query.types';
import { QueryService } from './query.service';

@Controller('api/patients/:patientId')
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly prisma: PrismaService,
  ) {}

  // patientId is bound by the URL — never read from request body or model output.
  // This is the security boundary that prevents cross-patient data exfiltration.
  @Post('query')
  async query(
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() body: QueryDto,
  ) {
    await this.assertPatientExists(patientId, body);
    return this.queryService.askAboutPatient(patientId, body.question);
  }

  // SSE streaming variant. POST + @Sse() works in NestJS as long as the handler
  // returns Observable<MessageEvent>. Each event is one of the typed StreamEvents
  // emitted by streamAboutPatient — the client distinguishes by `type`.
  @Post('query/stream')
  @Sse()
  async queryStream(
    @Param('patientId', new ParseUUIDPipe({ version: '4' })) patientId: string,
    @Body() body: QueryDto,
  ): Promise<Observable<MessageEvent>> {
    await this.assertPatientExists(patientId, body);

    const stream = this.queryService.streamAboutPatient(patientId, body.question);

    return new Observable<MessageEvent>((subscriber) => {
      let cancelled = false;
      (async () => {
        try {
          for await (const event of stream) {
            if (cancelled) return;
            subscriber.next({ type: event.type, data: event });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
      return () => {
        cancelled = true;
      };
    });
  }

  private async assertPatientExists(patientId: string, body: QueryDto): Promise<void> {
    if (!body?.question?.trim()) {
      throw new BadRequestException('question is required');
    }
    const exists = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }
}
