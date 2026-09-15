import { type Job, UnrecoverableError } from 'bullmq';
import type { AlignJobData } from './recitation-queue';
import { RecitationProcessor } from './recitation.processor';
import {
  type AlignReferenceResponse,
  SpeechServiceError,
} from './speech-client.service';

// The generated Prisma client sits outside jest's rootDir; only the DI token is needed.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const REFERENCE = {
  id: 'ref-1',
  storedName: '0b0e7a5c-1111-4222-8333-944455556666.mp3',
  surah: 1,
  ayahStart: null,
  ayahEnd: null,
};

function alignResult(
  overrides: Partial<AlignReferenceResponse> = {},
): AlignReferenceResponse {
  return {
    modelId: 'tarteel-ai/whisper-base-ar-quran',
    modelRevision: '5c3c53fd',
    durationSec: 36.2,
    processingSec: 4.1,
    matchRate: 0.93,
    insertedCount: 0,
    transcript: 'بسم الله',
    words: [
      {
        ayah: 1,
        position: 1,
        text: 'بِسْمِ',
        start: 0.4,
        end: 0.9,
        match: 'EXACT',
        heard: 'بسم',
        estimated: false,
      },
      {
        ayah: 1,
        position: 2,
        text: 'اللَّهِ',
        start: 0.9,
        end: 1.5,
        match: 'MISSING',
        heard: null,
        estimated: true,
      },
    ],
    ...overrides,
  };
}

function createPrisma(reference: typeof REFERENCE | null = REFERENCE) {
  const operations: string[] = [];
  const prisma = {
    recitationReference: {
      findUnique: jest.fn().mockResolvedValue(reference),
      update: jest.fn((args: unknown) => {
        operations.push('reference.update');
        return args;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: reference ? 1 : 0 }),
      count: jest.fn().mockResolvedValue(reference ? 1 : 0),
    },
    recitationWord: {
      deleteMany: jest.fn((args: unknown) => {
        operations.push('words.deleteMany');
        return args;
      }),
      createMany: jest.fn((args: unknown) => {
        operations.push('words.createMany');
        return args;
      }),
    },
    $transaction: jest.fn((steps: unknown[]) => Promise.resolve(steps)),
    operations,
  };
  return prisma;
}

function setup({
  reference = REFERENCE,
  align = jest.fn().mockResolvedValue(alignResult()),
}: {
  reference?: typeof REFERENCE | null;
  align?: jest.Mock;
} = {}) {
  const prisma = createPrisma(reference);
  const speech = { alignReference: align };
  const processor = new RecitationProcessor(prisma as never, speech as never);
  return { prisma, speech, processor };
}

const job = (attemptsMade = 0, attempts = 3) =>
  ({
    data: { referenceId: REFERENCE.id },
    attemptsMade,
    opts: { attempts },
  }) as unknown as Job<AlignJobData>;

/** The data written by the final reference update inside the transaction. */
function finalUpdate(prisma: ReturnType<typeof createPrisma>) {
  const calls = prisma.recitationReference.update.mock.calls;
  return (calls[calls.length - 1][0] as { data: Record<string, unknown> }).data;
}

describe('RecitationProcessor.process', () => {
  it('marks the reference PROCESSING before calling the speech service', async () => {
    const { prisma, processor } = setup();
    await processor.process(job());

    expect(prisma.recitationReference.update.mock.calls[0][0]).toEqual({
      where: { id: REFERENCE.id },
      data: { status: 'PROCESSING', processingError: null },
    });
  });

  it('sends the stored file and ayah range, never a client-supplied path', async () => {
    const { speech, processor } = setup();
    await processor.process(job());

    expect(speech.alignReference).toHaveBeenCalledWith({
      storedName: REFERENCE.storedName,
      surah: 1,
      ayahStart: null,
      ayahEnd: null,
    });
  });

  it('replaces previous word timings and marks READY in one transaction', async () => {
    const { prisma, processor } = setup();
    await processor.process(job());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.operations.slice(-3)).toEqual([
      'words.deleteMany',
      'words.createMany',
      'reference.update',
    ]);
    expect(finalUpdate(prisma)).toMatchObject({
      status: 'READY',
      processingError: null,
      matchRate: 0.93,
      durationSec: 36.2,
    });
  });

  it('records which model revision produced the timings', async () => {
    const { prisma, processor } = setup();
    await processor.process(job());

    expect(finalUpdate(prisma)).toMatchObject({
      modelId: 'tarteel-ai/whisper-base-ar-quran',
      modelRevision: '5c3c53fd',
    });
  });

  it('maps speech-service words to database rows', async () => {
    const { prisma, processor } = setup();
    await processor.process(job());

    const { data } = prisma.recitationWord.createMany.mock.calls[0][0] as {
      data: unknown[];
    };
    expect(data[1]).toEqual({
      referenceId: REFERENCE.id,
      ayah: 1,
      position: 2,
      text: 'اللَّهِ',
      startSec: 0.9,
      endSec: 1.5,
      match: 'MISSING',
      estimated: true,
    });
  });

  it('refuses a recording that matches too little of its surah, but keeps the words for diagnosis', async () => {
    const { prisma, processor } = setup({
      align: jest.fn().mockResolvedValue(alignResult({ matchRate: 0.12 })),
    });
    await processor.process(job());

    expect(prisma.recitationWord.createMany).toHaveBeenCalled();
    const data = finalUpdate(prisma);
    expect(data.status).toBe('FAILED');
    expect(data.processingError).toMatch(/Only 12% of the expected words/);
  });

  it('does nothing for a reference deleted while it was queued', async () => {
    const { prisma, speech, processor } = setup({ reference: null });
    await processor.process(job());

    expect(speech.alignReference).not.toHaveBeenCalled();
    expect(prisma.recitationReference.update).not.toHaveBeenCalled();
  });

  it('treats a reference deleted mid-processing as done, not as a failure to retry', async () => {
    const { prisma, processor } = setup();
    prisma.$transaction.mockRejectedValueOnce(
      new Error('foreign key violation'),
    );
    prisma.recitationReference.count.mockResolvedValueOnce(0);

    await expect(processor.process(job())).resolves.toBeUndefined();
  });

  it('rethrows a database error when the reference still exists, so the job retries', async () => {
    const { prisma, processor } = setup();
    prisma.$transaction.mockRejectedValueOnce(new Error('connection reset'));

    await expect(processor.process(job())).rejects.toThrow('connection reset');
  });

  describe('speech service errors', () => {
    it('fails immediately without retrying when the request itself is invalid', async () => {
      const { prisma, processor } = setup({
        align: jest
          .fn()
          .mockRejectedValue(
            new SpeechServiceError(
              '422: ayah range 1-8 is outside surah 1',
              false,
              422,
            ),
          ),
      });

      await expect(processor.process(job())).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(prisma.recitationReference.updateMany).toHaveBeenCalledWith({
        where: { id: REFERENCE.id },
        data: {
          status: 'FAILED',
          processingError: '422: ayah range 1-8 is outside surah 1',
        },
      });
    });

    it('rethrows transient errors unchanged so BullMQ retries with backoff', async () => {
      const outage = new SpeechServiceError('Speech service unreachable', true);
      const { prisma, processor } = setup({
        align: jest.fn().mockRejectedValue(outage),
      });

      await expect(processor.process(job())).rejects.toBe(outage);
      expect(prisma.recitationReference.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('RecitationProcessor.onFailed', () => {
  it('leaves the reference PROCESSING while retries remain', async () => {
    const { prisma, processor } = setup();
    await processor.onFailed(job(1, 3), new Error('timeout'));

    expect(prisma.recitationReference.updateMany).not.toHaveBeenCalled();
  });

  it('marks FAILED once the last attempt is used up, so it never sits in PROCESSING forever', async () => {
    const { prisma, processor } = setup();
    await processor.onFailed(job(3, 3), new Error('timeout'));

    expect(prisma.recitationReference.updateMany).toHaveBeenCalledWith({
      where: { id: REFERENCE.id },
      data: {
        status: 'FAILED',
        processingError: 'Processing failed after 3 attempts: timeout',
      },
    });
  });

  it('marks FAILED on an unrecoverable error even with attempts left', async () => {
    const { prisma, processor } = setup();
    await processor.onFailed(job(1, 3), new UnrecoverableError('bad range'));

    expect(prisma.recitationReference.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'FAILED', processingError: 'bad range' },
      }),
    );
  });

  it('ignores events without a job', async () => {
    const { prisma, processor } = setup();
    await processor.onFailed(undefined, new Error('stalled'));
    expect(prisma.recitationReference.updateMany).not.toHaveBeenCalled();
  });
});
