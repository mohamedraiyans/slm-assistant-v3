import { ConfigService } from '@nestjs/config';
import { ChromaClient } from 'chromadb';
import { VectorStoreService } from './vector-store.service';

// Chroma is stubbed rather than run for real: these tests are about the ranking
// policy applied *on top of* the vector search, and a live collection would make
// the results depend on an embedding model rather than on the code under test.
jest.mock('chromadb', () => ({ ChromaClient: jest.fn() }));
jest.mock('@chroma-core/default-embed', () => ({
  DefaultEmbeddingFunction: jest.fn(),
}));

interface PoolEntry {
  filename: string;
  text: string;
  distance: number;
}

/** Shapes a list of hits the way `collection.query` returns them. */
function chromaResponse(entries: PoolEntry[]) {
  return {
    documents: [entries.map((e) => e.text)],
    metadatas: [entries.map((e) => ({ filename: e.filename, index: 0 }))],
    distances: [entries.map((e) => e.distance)],
  };
}

/** `count` hits from one file, at steadily increasing distance. */
function hitsFrom(
  filename: string,
  count: number,
  startDistance = 0.1,
): PoolEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    filename,
    text: `${filename} chunk ${i}`,
    distance: startDistance + i * 0.01,
  }));
}

describe('VectorStoreService', () => {
  let service: VectorStoreService;
  let collection: {
    count: jest.Mock;
    query: jest.Mock;
    upsert: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    collection = {
      count: jest.fn().mockResolvedValue(100),
      query: jest.fn(),
      upsert: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    (ChromaClient as unknown as jest.Mock).mockImplementation(() => ({
      getOrCreateCollection: jest.fn().mockResolvedValue(collection),
    }));

    const config = { get: jest.fn().mockReturnValue('http://localhost:8000') };
    service = new VectorStoreService(config as unknown as ConfigService);
    await service.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  describe('query', () => {
    it('returns nothing and skips the search when the collection is empty', async () => {
      collection.count.mockResolvedValue(0);

      await expect(service.query('anything', 12)).resolves.toEqual([]);
      expect(collection.query).not.toHaveBeenCalled();
    });

    it('over-fetches candidates so there is a pool to rebalance', async () => {
      collection.query.mockResolvedValue(chromaResponse(hitsFrom('a.pdf', 5)));

      await service.query('question', 12);

      expect(collection.query).toHaveBeenCalledWith(
        expect.objectContaining({ queryTexts: ['question'], nResults: 36 }),
      );
    });

    it('never asks for more candidates than the collection holds', async () => {
      collection.count.mockResolvedValue(10);
      collection.query.mockResolvedValue(chromaResponse(hitsFrom('a.pdf', 5)));

      await service.query('question', 12);

      expect(collection.query).toHaveBeenCalledWith(
        expect.objectContaining({ nResults: 10 }),
      );
    });

    describe('document coverage', () => {
      it('stops one document from taking every slot', async () => {
        // The reported bug: with three résumés uploaded, the one most densely
        // on-topic won all 12 slots and the other two never reached the LLM, so
        // answers silently came from a single file.
        collection.query.mockResolvedValue(
          chromaResponse([
            ...hitsFrom('dense.pdf', 12, 0.1),
            ...hitsFrom('second.pdf', 6, 0.4),
            ...hitsFrom('third.pdf', 6, 0.5),
          ]),
        );

        const matches = await service.query('list everyone', 12);

        const perFile = matches.reduce<Record<string, number>>((acc, m) => {
          acc[m.filename] = (acc[m.filename] ?? 0) + 1;
          return acc;
        }, {});

        expect(matches).toHaveLength(12);
        expect(perFile).toEqual({
          'dense.pdf': 4,
          'second.pdf': 4,
          'third.pdf': 4,
        });
      });

      it('still fills every slot when only one document is relevant', async () => {
        // The cap must not become a ceiling: a question that genuinely concerns
        // one document should still get a full context window.
        collection.query.mockResolvedValue(
          chromaResponse(hitsFrom('only.pdf', 20)),
        );

        const matches = await service.query('a narrow question', 12);

        expect(matches).toHaveLength(12);
        expect(matches.every((m) => m.filename === 'only.pdf')).toBe(true);
      });

      it('returns everything when the pool is smaller than topK', async () => {
        collection.query.mockResolvedValue(
          chromaResponse(hitsFrom('a.pdf', 3)),
        );

        await expect(service.query('question', 12)).resolves.toHaveLength(3);
      });

      it('preserves relevance order among the chunks it keeps', async () => {
        collection.query.mockResolvedValue(
          chromaResponse([
            ...hitsFrom('a.pdf', 5, 0.1),
            ...hitsFrom('b.pdf', 1, 0.4),
          ]),
        );

        const matches = await service.query('question', 5);
        const scores = matches.map((m) => m.score);

        expect(scores).toEqual([...scores].sort((x, y) => y - x));
        // a.pdf's 5th chunk is more relevant than b.pdf's only chunk, but the cap
        // yields its slot so the second document is represented at all.
        expect(matches.map((m) => m.filename)).toEqual([
          'a.pdf',
          'a.pdf',
          'a.pdf',
          'a.pdf',
          'b.pdf',
        ]);
      });
    });

    describe('score normalization', () => {
      it('converts cosine distance to a similarity score', async () => {
        collection.query.mockResolvedValue(
          chromaResponse([
            { filename: 'a.pdf', text: 'exact', distance: 0 },
            { filename: 'b.pdf', text: 'close', distance: 0.2337 },
          ]),
        );

        const matches = await service.query('question', 12);

        expect(matches[0].score).toBe(1);
        expect(matches[1].score).toBe(0.7663);
      });

      it('floors dissimilar matches at zero rather than going negative', async () => {
        collection.query.mockResolvedValue(
          chromaResponse([
            { filename: 'a.pdf', text: 'opposite', distance: 1.5 },
          ]),
        );

        const matches = await service.query('question', 12);

        expect(matches[0].score).toBe(0);
      });

      it('rounds to four decimal places', async () => {
        collection.query.mockResolvedValue(
          chromaResponse([
            { filename: 'a.pdf', text: 'noisy', distance: 0.123456789 },
          ]),
        );

        const matches = await service.query('question', 12);

        expect(matches[0].score).toBe(0.8765);
      });
    });

    it('falls back to a placeholder filename when metadata is missing', async () => {
      collection.query.mockResolvedValue({
        documents: [['orphaned chunk']],
        metadatas: [[null]],
        distances: [[0.2]],
      });

      const matches = await service.query('question', 12);

      expect(matches[0].filename).toBe('unknown');
      expect(matches[0].text).toBe('orphaned chunk');
    });
  });

  describe('addChunks', () => {
    it('does not call Chroma for an empty chunk list', async () => {
      await service.addChunks([]);

      expect(collection.upsert).not.toHaveBeenCalled();
    });

    it('upserts ids, text and filename metadata together', async () => {
      await service.addChunks([
        { id: 'a.pdf::0', filename: 'a.pdf', text: 'first', index: 0 },
        { id: 'a.pdf::1', filename: 'a.pdf', text: 'second', index: 1 },
      ]);

      expect(collection.upsert).toHaveBeenCalledWith({
        ids: ['a.pdf::0', 'a.pdf::1'],
        documents: ['first', 'second'],
        metadatas: [
          { filename: 'a.pdf', index: 0 },
          { filename: 'a.pdf', index: 1 },
        ],
      });
    });
  });

  describe('hasDocument', () => {
    it.each([
      ['reports a stored document', ['a.pdf::0'], true],
      ['reports an absent document', [], false],
    ])('%s', async (_label, ids, expected) => {
      collection.get.mockResolvedValue({ ids });

      await expect(service.hasDocument('a.pdf')).resolves.toBe(expected);
    });
  });

  describe('deleteDocument', () => {
    it('deletes by filename rather than by chunk id', async () => {
      // Chunk ids are positional, so deleting a known id range would miss chunks
      // left over from a longer earlier version of the same file.
      await service.deleteDocument('a.pdf');

      expect(collection.delete).toHaveBeenCalledWith({
        where: { filename: 'a.pdf' },
      });
    });
  });
});
