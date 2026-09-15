import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PracticeAttemptResult } from '@slm/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { detectAudioFormat, SUPPORTED_AUDIO_LABEL } from './audio-format';
import { judgeAttempt } from './practice-judge';
import {
  type CheckAttemptResponse,
  SpeechClient,
  SpeechServiceError,
} from './speech-client.service';

export interface AttemptAudio {
  buffer: Buffer;
}

function parseAyah(value: unknown): number {
  const ayah = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof ayah !== 'number' || !Number.isInteger(ayah) || ayah < 1) {
    throw new BadRequestException('ayah must be a whole number of 1 or more');
  }
  return ayah;
}

@Injectable()
export class PracticeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly speech: SpeechClient,
  ) {}

  /**
   * Checks one recited ayah against a processed reference. Synchronous rather than
   * queued: someone is waiting for the answer, and one ayah decodes in seconds. The
   * recording is only passed through - it is never written anywhere.
   */
  async checkAttempt(
    referenceId: string,
    rawAyah: unknown,
    audio: AttemptAudio | undefined,
  ): Promise<PracticeAttemptResult> {
    const ayah = parseAyah(rawAyah);
    if (!audio?.buffer?.length)
      throw new BadRequestException('No recording was uploaded');

    const reference = await this.prisma.recitationReference.findUnique({
      where: { id: referenceId },
      select: { surah: true, status: true },
    });
    if (!reference) throw new NotFoundException('Recitation not found');
    if (reference.status !== 'READY') {
      throw new ConflictException(
        'This recitation has not finished processing yet',
      );
    }

    const referenceWords = await this.prisma.recitationWord.findMany({
      where: { referenceId, ayah },
      orderBy: { position: 'asc' },
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
    if (referenceWords.length === 0) {
      throw new BadRequestException(
        `Ayah ${ayah} is not part of this recitation`,
      );
    }

    const format = detectAudioFormat(audio.buffer);
    if (!format) {
      throw new BadRequestException(
        `Recording is not a supported audio format. Supported: ${SUPPORTED_AUDIO_LABEL}`,
      );
    }

    let checked: CheckAttemptResponse;
    try {
      checked = await this.speech.checkAttempt({
        audio: audio.buffer,
        mimeType: format.mimeType,
        extension: format.extension,
        surah: reference.surah,
        ayah,
      });
    } catch (error) {
      if (error instanceof SpeechServiceError && !error.retryable) {
        throw new BadRequestException(error.message);
      }
      throw new ServiceUnavailableException(
        'The speech service is not available right now. Try again in a moment.',
      );
    }

    return judgeAttempt(
      ayah,
      referenceWords,
      checked.words,
      checked.extraWords,
    );
  }
}
