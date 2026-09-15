import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PracticeService } from './practice.service';
import { SpeechServiceError } from './speech-client.service';

// The generated Prisma client sits outside jest's rootDir; only the DI token is needed.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const WEBM = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(32),
]);
const REFERENCE_WORDS = [
  {
    ayah: 2,
    position: 1,
    text: 'الْحَمْدُ',
    startSec: 6.4,
    endSec: 6.9,
    match: 'EXACT',
    estimated: false,
  },
  {
    ayah: 2,
    position: 2,
    text: 'لِلَّهِ',
    startSec: 6.9,
    endSec: 7.7,
    match: 'EXACT',
    estimated: false,
  },
];

function setup({
  reference = { surah: 1, status: 'READY' },
  words = REFERENCE_WORDS,
}: {
  reference?: { surah: number; status: string } | null;
  words?: typeof REFERENCE_WORDS;
} = {}) {
  const prisma = {
    recitationReference: { findUnique: jest.fn().mockResolvedValue(reference) },
    recitationWord: { findMany: jest.fn().mockResolvedValue(words) },
  };
  const speech = {
    checkAttempt: jest.fn().mockResolvedValue({
      surah: 1,
      ayah: 2,
      processingSec: 1.2,
      transcript: 'الحمد',
      words: [
        { position: 1, text: 'الْحَمْدُ', match: 'EXACT', heard: 'الحمد' },
        { position: 2, text: 'لِلَّهِ', match: 'MISSING', heard: null },
      ],
      extraWords: [],
    }),
  };
  return {
    prisma,
    speech,
    service: new PracticeService(prisma as never, speech as never),
  };
}

describe('PracticeService.checkAttempt', () => {
  it('returns verdicts with the reference timing of each word', async () => {
    const { service } = setup();
    const result = await service.checkAttempt('ref-1', '2', { buffer: WEBM });

    expect(result.passed).toBe(false);
    expect(result.words[1]).toMatchObject({
      verdict: 'MISTAKE',
      startSec: 6.9,
      endSec: 7.7,
    });
  });

  it("sends the reference's surah and the format detected from the recording's bytes", async () => {
    const { speech, service } = setup();
    await service.checkAttempt('ref-1', '2', { buffer: WEBM });

    expect(speech.checkAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        surah: 1,
        ayah: 2,
        mimeType: 'audio/webm',
        extension: 'webm',
      }),
    );
  });

  it('only loads reference words for the ayah being practised', async () => {
    const { prisma, service } = setup();
    await service.checkAttempt('ref-1', '2', { buffer: WEBM });

    expect(prisma.recitationWord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { referenceId: 'ref-1', ayah: 2 } }),
    );
  });

  describe('rejects before calling the speech service', () => {
    it.each(['0', '-1', '2.5', 'two', undefined])(
      'an invalid ayah (%s)',
      async (ayah) => {
        const { speech, service } = setup();
        await expect(
          service.checkAttempt('ref-1', ayah, { buffer: WEBM }),
        ).rejects.toThrow(BadRequestException);
        expect(speech.checkAttempt).not.toHaveBeenCalled();
      },
    );

    it('a missing recording', async () => {
      const { service } = setup();
      await expect(
        service.checkAttempt('ref-1', '2', undefined),
      ).rejects.toThrow(/No recording/);
    });

    it('an unknown reference', async () => {
      const { service } = setup({ reference: null });
      await expect(
        service.checkAttempt('ref-1', '2', { buffer: WEBM }),
      ).rejects.toThrow(NotFoundException);
    });

    it.each(['PENDING', 'PROCESSING', 'FAILED'])(
      'a reference that is %s',
      async (status) => {
        const { speech, service } = setup({ reference: { surah: 1, status } });
        await expect(
          service.checkAttempt('ref-1', '2', { buffer: WEBM }),
        ).rejects.toThrow(ConflictException);
        expect(speech.checkAttempt).not.toHaveBeenCalled();
      },
    );

    it('an ayah the reference recording does not cover', async () => {
      const { service } = setup({ words: [] });
      await expect(
        service.checkAttempt('ref-1', '9', { buffer: WEBM }),
      ).rejects.toThrow(/Ayah 9 is not part of this recitation/);
    });

    it('a recording that is not audio', async () => {
      const { speech, service } = setup();
      await expect(
        service.checkAttempt('ref-1', '2', { buffer: Buffer.from('%PDF-1.7') }),
      ).rejects.toThrow(/not a supported audio format/);
      expect(speech.checkAttempt).not.toHaveBeenCalled();
    });
  });

  it('turns a permanent speech-service error into a 400 with its reason', async () => {
    const { speech, service } = setup();
    speech.checkAttempt.mockRejectedValueOnce(
      new SpeechServiceError(
        'Speech service returned 422: could not decode audio',
        false,
        422,
      ),
    );
    await expect(
      service.checkAttempt('ref-1', '2', { buffer: WEBM }),
    ).rejects.toThrow(/could not decode audio/);
  });

  it('turns an outage into a 503 rather than a generic 500', async () => {
    const { speech, service } = setup();
    speech.checkAttempt.mockRejectedValueOnce(
      new SpeechServiceError('unreachable', true),
    );
    await expect(
      service.checkAttempt('ref-1', '2', { buffer: WEBM }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
