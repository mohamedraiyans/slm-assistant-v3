import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AlignJobData,
  MIN_MATCH_RATE,
  RECITATION_QUEUE,
} from './recitation-queue';
import {
  type AlignReferenceResponse,
  SpeechClient,
  SpeechServiceError,
} from './speech-client.service';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// One recording at a time: the speech service decodes on every CPU core already, so
// parallel jobs would only queue up inside it and risk hitting request timeouts.
@Processor(RECITATION_QUEUE, { concurrency: 1 })
export class RecitationProcessor extends WorkerHost {
  private readonly logger = new Logger(RecitationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly speech: SpeechClient,
  ) {
    super();
  }

  async process(job: Job<AlignJobData>): Promise<void> {
    const { referenceId } = job.data;
    const reference = await this.prisma.recitationReference.findUnique({
      where: { id: referenceId },
    });
    if (!reference) return; // deleted while queued

    await this.prisma.recitationReference.update({
      where: { id: referenceId },
      data: { status: 'PROCESSING', processingError: null },
    });

    let result: AlignReferenceResponse;
    try {
      result = await this.speech.alignReference({
        storedName: reference.storedName,
        surah: reference.surah,
        ayahStart: reference.ayahStart,
        ayahEnd: reference.ayahEnd,
      });
    } catch (error) {
      if (error instanceof SpeechServiceError && !error.retryable) {
        // Retrying a bad range or a missing file fails identically every time.
        await this.markFailed(referenceId, error.message);
        throw new UnrecoverableError(error.message);
      }
      throw error; // transient: BullMQ retries with backoff
    }

    const usable = result.matchRate >= MIN_MATCH_RATE;
    const percent = Math.round(result.matchRate * 100);
    try {
      await this.prisma.$transaction([
        this.prisma.recitationWord.deleteMany({ where: { referenceId } }),
        this.prisma.recitationWord.createMany({
          data: result.words.map((word) => ({
            referenceId,
            ayah: word.ayah,
            position: word.position,
            text: word.text,
            startSec: word.start,
            endSec: word.end,
            match: word.match,
            estimated: word.estimated,
          })),
        }),
        this.prisma.recitationReference.update({
          where: { id: referenceId },
          data: {
            status: usable ? 'READY' : 'FAILED',
            processingError: usable
              ? null
              : `Only ${percent}% of the expected words were recognised. Check the surah and ayah range match this recording.`,
            durationSec: result.durationSec,
            matchRate: result.matchRate,
            modelId: result.modelId,
            modelRevision: result.modelRevision,
            processedAt: new Date(),
          },
        }),
      ]);
    } catch (error) {
      const stillExists = await this.prisma.recitationReference.count({
        where: { id: referenceId },
      });
      if (!stillExists) return; // deleted mid-processing; its words cascaded away
      throw error;
    }

    this.logger.log(
      `Aligned ${referenceId}: ${percent}% of ${result.words.length} words in ${result.processingSec}s`,
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<AlignJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const finalAttempt =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!finalAttempt) {
      this.logger.warn(
        `Alignment attempt ${job.attemptsMade} failed for ${job.data.referenceId}, retrying: ${messageOf(error)}`,
      );
      return;
    }
    await this.markFailed(
      job.data.referenceId,
      error instanceof UnrecoverableError
        ? error.message
        : `Processing failed after ${job.attemptsMade} attempts: ${messageOf(error)}`,
    );
  }

  private async markFailed(
    referenceId: string,
    message: string,
  ): Promise<void> {
    // updateMany rather than update: the reference may have been deleted meanwhile.
    await this.prisma.recitationReference.updateMany({
      where: { id: referenceId },
      data: { status: 'FAILED', processingError: message },
    });
  }
}
