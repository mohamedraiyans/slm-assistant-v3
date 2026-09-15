import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RecitationReferenceSummary } from '@slm/shared-types';
import type { RecitationReference } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { detectAudioFormat, SUPPORTED_AUDIO_LABEL } from './audio-format';
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
  };
}

@Injectable()
export class RecitationService {
  constructor(private readonly prisma: PrismaService) {}

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

    try {
      const row = await this.prisma.recitationReference.create({
        data: {
          ...input,
          storedName,
          originalName,
          mimeType: format.mimeType,
          sizeBytes: file.size,
          uploadedBy: userId,
        },
      });
      return toSummary(row);
    } catch (error) {
      await unlink(path).catch(() => undefined);
      throw error;
    }
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

  private async findOrThrow(id: string): Promise<RecitationReference> {
    const row = await this.prisma.recitationReference.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Recitation not found');
    return row;
  }
}
