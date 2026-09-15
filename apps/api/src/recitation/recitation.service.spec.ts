import { ConflictException } from '@nestjs/common';
import { ALIGN_JOB, alignJobId } from './recitation-queue';
import { RecitationService } from './recitation.service';

// The generated Prisma client sits outside jest's rootDir; only the DI token is needed.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
// Keep uploads off the real disk.
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.alloc(64)]);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ref-1',
    title: 'Al-Fatiha',
    surah: 1,
    ayahStart: null,
    ayahEnd: null,
    storedName: 'stored.mp3',
    originalName: 'fatiha.mp3',
    mimeType: 'audio/mpeg',
    sizeBytes: 67,
    status: 'PENDING',
    uploadedBy: 'user-1',
    createdAt: new Date('2026-09-15T10:00:00Z'),
    durationSec: null,
    matchRate: null,
    processingError: null,
    modelId: null,
    modelRevision: null,
    processedAt: null,
    ...overrides,
  };
}

function setup({
  existing = row(),
}: { existing?: ReturnType<typeof row> | null } = {}) {
  const prisma = {
    recitationReference: {
      create: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(row(data as Record<string, unknown>)),
      ),
      findUnique: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(row({ ...existing, ...data })),
      ),
    },
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
  const service = new RecitationService(prisma as never, queue as never);
  return { prisma, queue, service };
}

const upload = (service: RecitationService) =>
  service.uploadReference(
    { originalname: 'fatiha.mp3', buffer: MP3, size: MP3.length },
    { surah: '1' },
    'user-1',
  );

describe('RecitationService queueing', () => {
  it('queues an alignment job for every upload, keyed by the reference id', async () => {
    const { queue, service } = setup();
    const created = await upload(service);

    expect(queue.add).toHaveBeenCalledWith(
      ALIGN_JOB,
      { referenceId: created.id },
      expect.objectContaining({ jobId: alignJobId(created.id), attempts: 3 }),
    );
  });

  it('keeps the upload when the queue is down, marked FAILED with the reason', async () => {
    const { prisma, queue, service } = setup();
    queue.add.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const created = await upload(service);

    expect(prisma.recitationReference.create).toHaveBeenCalled();
    expect(created.status).toBe('FAILED');
    expect(created.processingError).toMatch(
      /Could not queue for processing: connect ECONNREFUSED/,
    );
  });

  it('never exposes the internal stored filename', async () => {
    const { service } = setup();
    expect(await upload(service)).not.toHaveProperty('storedName');
  });

  describe('reprocessing', () => {
    it('resets the status and queues a fresh job', async () => {
      const { prisma, queue, service } = setup({
        existing: row({ status: 'FAILED', processingError: 'boom' }),
      });
      const result = await service.reprocessReference('ref-1');

      expect(prisma.recitationReference.update).toHaveBeenCalledWith({
        where: { id: 'ref-1' },
        data: { status: 'PENDING', processingError: null },
      });
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('PENDING');
    });

    it('refuses while a job is already running, rather than racing it', async () => {
      const { queue, service } = setup({
        existing: row({ status: 'PROCESSING' }),
      });

      await expect(service.reprocessReference('ref-1')).rejects.toThrow(
        ConflictException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('on startup', () => {
    it('re-queues references left PENDING or PROCESSING, e.g. by a crash', async () => {
      const { prisma, queue, service } = setup();
      prisma.recitationReference.findMany.mockResolvedValueOnce([
        { id: 'a' },
        { id: 'b' },
      ]);

      await service.onApplicationBootstrap();

      expect(prisma.recitationReference.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['PENDING', 'PROCESSING'] } },
        }),
      );
      const calls = queue.add.mock.calls as [
        string,
        unknown,
        { jobId: string },
      ][];
      expect(calls.map(([, , options]) => options.jobId)).toEqual([
        alignJobId('a'),
        alignJobId('b'),
      ]);
    });

    it("doesn't crash the app when Redis is unavailable at boot", async () => {
      const { prisma, queue, service } = setup();
      prisma.recitationReference.findMany.mockResolvedValueOnce([{ id: 'a' }]);
      queue.add.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});
