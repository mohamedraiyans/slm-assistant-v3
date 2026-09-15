import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type {
  RecitationReferenceSummary,
  RecitationWordTiming,
} from '@slm/shared-types';
import type { RecitationReference } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { detectAudioFormat, SUPPORTED_AUDIO_LABEL } from './audio-format';
import {
  ALIGN_JOB,
  ALIGN_JOB_OPTIONS,
  type AlignJobData,
  alignJobId,
  RECITATION_QUEUE,
} from './recitation-queue';
import { parseReferenceInput } from './reference-input';

export const RECITATIONS_DIR = join(process.cwd(), 'data', 'recitations');

export interface UploadedAudio {
  originalname: string;
  buffer: Buffer;
  size: number;
}

export interface StoredAudio {
  path: string;
  mimeType: string;
}

// An explicit allowlist rather than spreading the row, so a column added later
// (and the internal storedName today) can't leak into API responses by default.
function toSummary(row: RecitationReference): RecitationReferenceSummary {
  return {
    id: row.id,
    title: row.title,
    surah: row.surah,
    ayahStart: row.ayahStart,
    ayahEnd: row.ayahEnd,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    durationSec: row.durationSec,
    matchRate: row.matchRate,
    processingError: row.processingError,
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class RecitationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RecitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(RECITATION_QUEUE)
    private readonly queue: Queue<AlignJobData>,
  ) {}

  /**
   * Re-queues anything left unfinished — uploads from before the queue existed, or
   * jobs lost to a crash mid-processing. Deterministic job ids make this safe to run
   * on every boot: a reference already queued or running is not added twice.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const unfinished = await this.prisma.recitationReference.findMany({
        where: { status: { in: ['PENDING', 'PROCESSING'] } },
        select: { id: true },
      });
      for (const { id } of unfinished) await this.enqueue(id);
      if (unfinished.length > 0) {
        this.logger.log(
          `Re-queued ${unfinished.length} unfinished recitation(s)`,
        );
      }
    } catch (error) {
      // Startup must not fail because Redis is briefly unavailable; the rows stay
      // PENDING and an admin can reprocess them.
      this.logger.warn(
        `Could not re-queue unfinished recitations: ${(error as Error).message}`,
      );
    }
  }

  async listReferences(): Promise<RecitationReferenceSummary[]> {
    const rows = await this.prisma.recitationReference.findMany({
      orderBy: [{ surah: 'asc' }, { ayahStart: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map(toSummary);
  }

  async uploadReference(
    file: UploadedAudio | undefined,
    body: Record<string, unknown>,
    userId: string,
  ): Promise<RecitationReferenceSummary> {
    if (!file?.buffer?.length)
      throw new BadRequestException('No audio file was uploaded');

    const format = detectAudioFormat(file.buffer);
    if (!format) {
      throw new BadRequestException(
        `Not a supported audio file. Supported: ${SUPPORTED_AUDIO_LABEL}`,
      );
    }
    const originalName = basename(file.originalname);
    const input = parseReferenceInput(body, originalName);

    // Never store under the client's filename: it collides across uploads and is
    // attacker-controlled. The original is kept only as display metadata.
    const storedName = `${randomUUID()}.${format.extension}`;
    const path = join(RECITATIONS_DIR, storedName);
    await mkdir(RECITATIONS_DIR, { recursive: true });
    await writeFile(path, file.buffer);

    let row: RecitationReference;
    try {
      row = await this.prisma.recitationReference.create({
        data: {
          ...input,
          storedName,
          originalName,
          mimeType: format.mimeType,
          sizeBytes: file.size,
          uploadedBy: userId,
        },
      });
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }

    return toSummary(await this.enqueueOrMarkFailed(row));
  }

  async listWords(id: string): Promise<RecitationWordTiming[]> {
    await this.findOrThrow(id);
    return this.prisma.recitationWord.findMany({
      where: { referenceId: id },
      orderBy: [{ ayah: 'asc' }, { position: 'asc' }],
      select: {
        ayah: true,
        position: true,
        text: true,
        startSec: true,
        endSec: true,
        match: true,
        estimated: true,
      },
    });
  }

  async reprocessReference(id: string): Promise<RecitationReferenceSummary> {
    const row = await this.findOrThrow(id);
    if (row.status === 'PROCESSING') {
      throw new ConflictException('This recitation is already being processed');
    }
    const reset = await this.prisma.recitationReference.update({
      where: { id },
      data: { status: 'PENDING', processingError: null },
    });
    return toSummary(await this.enqueueOrMarkFailed(reset));
  }

  async getAudio(id: string): Promise<StoredAudio> {
    const row = await this.findOrThrow(id);
    return {
      path: join(RECITATIONS_DIR, row.storedName),
      mimeType: row.mimeType,
    };
  }

  async removeReference(id: string): Promise<void> {
    const row = await this.findOrThrow(id);
    await this.prisma.recitationReference.delete({ where: { id } });
    await unlink(join(RECITATIONS_DIR, row.storedName)).catch(() => undefined);
  }

  private async enqueue(referenceId: string): Promise<void> {
    await this.queue.add(
      ALIGN_JOB,
      { referenceId },
      { ...ALIGN_JOB_OPTIONS, jobId: alignJobId(referenceId) },
    );
  }

  /** The upload itself has succeeded either way; a queue outage shouldn't lose it. */
  private async enqueueOrMarkFailed(
    row: RecitationReference,
  ): Promise<RecitationReference> {
    try {
      await this.enqueue(row.id);
      return row;
    } catch (error) {
      return this.prisma.recitationReference.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          processingError: `Could not queue for processing: ${(error as Error).message}`,
        },
      });
    }
  }

  private async findOrThrow(id: string): Promise<RecitationReference> {
    const row = await this.prisma.recitationReference.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Recitation not found');
    return row;
  }
}
