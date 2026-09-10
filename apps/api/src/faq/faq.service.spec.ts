import type Redis from 'ioredis';
import { FaqService } from './faq.service';

const SEVEN_DAYS = 60 * 60 * 24 * 7;

/**
 * A small in-memory stand-in for the bits of Redis this service uses.
 *
 * Deliberately stateful rather than a bag of `jest.fn()`s: the behaviour worth
 * testing here is *round-trip* (write an answer, bump the version, read nothing
 * back), which assertion-on-mock-calls can't express. `set` implements real
 * `NX` semantics because the pre-warming lock depends on them.
 */
class FakeRedis {
  private store = new Map<string, string>();
  private sortedSets = new Map<string, Map<string, number>>();

  /** Recorded so tests can assert TTLs without inspecting the store. */
  readonly expirations = new Map<string, number>();

  /** Present only to prove the invalidation path never reaches for them. */
  readonly keys = jest.fn();
  readonly scan = jest.fn();
  readonly del = jest.fn();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(
    key: string,
    value: string,
    _ex?: 'EX',
    seconds?: number,
    nx?: 'NX',
  ): Promise<'OK' | null> {
    if (nx === 'NX' && this.store.has(key)) return Promise.resolve(null);
    this.store.set(key, value);
    if (seconds !== undefined) this.expirations.set(key, seconds);
    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return Promise.resolve(next);
  }

  zincrby(key: string, by: number, member: string): Promise<string> {
    const set = this.sortedSets.get(key) ?? new Map<string, number>();
    const next = (set.get(member) ?? 0) + by;
    set.set(member, next);
    this.sortedSets.set(key, set);
    return Promise.resolve(String(next));
  }

  zrem(key: string, member: string): Promise<number> {
    return Promise.resolve(this.sortedSets.get(key)?.delete(member) ? 1 : 0);
  }

  /** The trailing 'WITHSCORES' argument the service passes is implied here. */
  zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const ranked = [
      ...(this.sortedSets.get(key) ?? new Map<string, number>()),
    ].sort((a, b) => b[1] - a[1]);
    return Promise.resolve(
      ranked
        .slice(start, stop + 1)
        .flatMap(([member, score]) => [member, String(score)]),
    );
  }

  /** Test helper — the service never calls this. */
  snapshotKeys(): string[] {
    return [...this.store.keys()];
  }
}

describe('FaqService', () => {
  let redis: FakeRedis;
  let service: FaqService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new FaqService(redis as unknown as Redis);
  });

  describe('normalize', () => {
    it.each([
      ['lowercases', 'What Is RAG', 'what is rag'],
      ['trims surrounding whitespace', '  what is rag  ', 'what is rag'],
      ['collapses internal whitespace', 'what   is\t\trag', 'what is rag'],
      ['strips trailing punctuation', 'what is rag?!', 'what is rag'],
      ['keeps internal punctuation', 'what is r.a.g?', 'what is r.a.g'],
    ])('%s', (_label, input, expected) => {
      expect(service.normalize(input)).toBe(expected);
    });

    it('treats differently-typed forms of one question as the same question', () => {
      // This is what makes the cache hit at all — without it, a trailing "?"
      // would cost a full LLM call.
      expect(service.normalize('  What is RAG?  ')).toBe(
        service.normalize('what is rag'),
      );
    });
  });

  describe('recordQuestion', () => {
    it('ranks questions by how often they have been asked', async () => {
      await service.recordQuestion('What is RAG?');
      await service.recordQuestion('what is rag');
      await service.recordQuestion('Who uploaded the handbook?');

      await expect(service.getTopQuestions(10)).resolves.toEqual([
        { question: 'what is rag', count: 2 },
        { question: 'who uploaded the handbook', count: 1 },
      ]);
    });

    it('ignores input that normalizes to nothing', async () => {
      await service.recordQuestion('???');
      await service.recordQuestion('   ');

      await expect(service.getTopQuestions(10)).resolves.toEqual([]);
    });

    it('honours the requested limit', async () => {
      for (const q of ['one', 'two', 'three', 'four'])
        await service.recordQuestion(q);

      await expect(service.getTopQuestions(2)).resolves.toHaveLength(2);
    });
  });

  describe('remove', () => {
    it('drops a question from the ranking by its normalized form', async () => {
      await service.recordQuestion('Yes');

      await service.remove('yes?');

      await expect(service.getTopQuestions(10)).resolves.toEqual([]);
    });
  });

  describe('answer cache', () => {
    const answer = { answer: 'Retrieval-augmented generation.', sources: [] };

    it('round-trips a cached answer', async () => {
      await service.setCachedAnswer('GROQ', 'What is RAG?', answer);

      await expect(
        service.getCachedAnswer('GROQ', 'what is rag'),
      ).resolves.toEqual(answer);
    });

    it('returns null for a question that was never asked', async () => {
      await expect(
        service.getCachedAnswer('GROQ', 'unknown'),
      ).resolves.toBeNull();
    });

    it('keeps providers isolated from each other', async () => {
      // Providers phrase answers differently, so a Groq answer must never be
      // served for an Azure request.
      await service.setCachedAnswer('GROQ', 'what is rag', answer);

      await expect(
        service.getCachedAnswer('AZURE_OPENAI', 'what is rag'),
      ).resolves.toBeNull();
    });

    it('expires answers after seven days', async () => {
      await service.setCachedAnswer('GROQ', 'what is rag', answer);

      const [key] = redis.snapshotKeys();
      expect(redis.expirations.get(key)).toBe(SEVEN_DAYS);
    });
  });

  describe('invalidateAll', () => {
    const answer = { answer: 'Retrieval-augmented generation.', sources: [] };

    it('orphans every cached answer', async () => {
      await service.setCachedAnswer('GROQ', 'what is rag', answer);

      await service.invalidateAll();

      await expect(
        service.getCachedAnswer('GROQ', 'what is rag'),
      ).resolves.toBeNull();
    });

    it('takes effect on the very first invalidation', async () => {
      // Regression: `currentVersion()` used to default to "1" while `INCR` on a
      // missing key also produces 1, so the first document upload against a fresh
      // Redis left every previously cached answer live.
      await service.setCachedAnswer('GROQ', 'what is rag', answer);

      await service.invalidateAll();

      await expect(
        service.getCachedAnswer('GROQ', 'what is rag'),
      ).resolves.toBeNull();
    });

    it('leaves the frequency ranking intact', async () => {
      // The two have deliberately different lifetimes: the list of popular
      // questions survives a knowledge-base change, the answers behind it don't.
      await service.recordQuestion('what is rag');

      await service.invalidateAll();

      await expect(service.getTopQuestions(10)).resolves.toEqual([
        { question: 'what is rag', count: 1 },
      ]);
    });

    it('is O(1) — it never scans or deletes keys', async () => {
      await service.setCachedAnswer('GROQ', 'what is rag', answer);

      await service.invalidateAll();

      expect(redis.keys).not.toHaveBeenCalled();
      expect(redis.scan).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('claimWarmSlot', () => {
    it('is granted to exactly one caller per cache version', async () => {
      await expect(service.claimWarmSlot()).resolves.toBe(true);
      await expect(service.claimWarmSlot()).resolves.toBe(false);
      await expect(service.claimWarmSlot()).resolves.toBe(false);
    });

    it('can be claimed again after the knowledge base changes', async () => {
      await service.claimWarmSlot();

      await service.invalidateAll();

      await expect(service.claimWarmSlot()).resolves.toBe(true);
    });

    it('resolves concurrent claims to a single winner', async () => {
      // The FAQ sidebar polls every 30s from every open tab, so simultaneous
      // claims are the normal case, not an edge case.
      const claims = await Promise.all(
        Array.from({ length: 5 }, () => service.claimWarmSlot()),
      );

      expect(claims.filter(Boolean)).toHaveLength(1);
    });
  });
});
