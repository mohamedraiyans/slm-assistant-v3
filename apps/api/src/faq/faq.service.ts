import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { ChatSourceMatch, FaqEntry, ProviderName } from '@slm/shared-types';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface CachedAnswer {
  answer: string;
  sources: ChatSourceMatch[];
}

const COUNTS_KEY = 'faq:counts';
const CACHE_VERSION_KEY = 'faq:cache-version';
// Document changes are handled by the version bump below, not by expiry, so this
// is deliberately long — a short TTL just meant frequently-asked questions kept
// falling back to a fresh LLM call for no correctness benefit. It can't be dropped
// entirely though: a version bump orphans keys rather than deleting them, so the
// TTL is what eventually garbage-collects those orphans instead of leaking forever.
const ANSWER_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

@Injectable()
export class FaqService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  normalize(question: string): string {
    return question
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[?!.,]+$/g, '');
  }

  /** Bumps the frequency counter for a question. Called on every chat message, cache hit or not. */
  async recordQuestion(question: string): Promise<void> {
    const normalized = this.normalize(question);
    if (!normalized) return;
    await this.redis.zincrby(COUNTS_KEY, 1, normalized);
  }

  /** Removes a question from the frequency ranking, e.g. to prune junk entries. */
  async remove(question: string): Promise<void> {
    await this.redis.zrem(COUNTS_KEY, this.normalize(question));
  }

  async getTopQuestions(limit = 10): Promise<FaqEntry[]> {
    const raw = await this.redis.zrevrange(COUNTS_KEY, 0, limit - 1, 'WITHSCORES');
    const entries: FaqEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      entries.push({ question: raw[i], count: Number(raw[i + 1]) });
    }
    return entries;
  }

  async getCachedAnswer(provider: ProviderName, question: string): Promise<CachedAnswer | null> {
    const key = await this.answerKey(provider, question);
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as CachedAnswer) : null;
  }

  async setCachedAnswer(provider: ProviderName, question: string, result: CachedAnswer): Promise<void> {
    const key = await this.answerKey(provider, question);
    await this.redis.set(key, JSON.stringify(result), 'EX', ANSWER_TTL_SECONDS);
  }

  /** Bumps the cache version so every previously cached answer is orphaned (and expires via TTL) without a scan/delete. */
  async invalidateAll(): Promise<void> {
    await this.redis.incr(CACHE_VERSION_KEY);
  }

  /**
   * Claims the right to pre-warm the cache for the current version. Returns true
   * for exactly one caller per version (SET NX is atomic, so concurrent callers
   * can't both win) and false thereafter — so warming runs once after each
   * document change rather than on every FAQ poll.
   */
  async claimWarmSlot(): Promise<boolean> {
    const key = `faq:warmed:v${await this.currentVersion()}`;
    const claimed = await this.redis.set(key, '1', 'EX', ANSWER_TTL_SECONDS, 'NX');
    return claimed === 'OK';
  }

  /**
   * Defaults to 0, not 1: `INCR` on a missing key yields 1, so a default of 1 made
   * the *first* `invalidateAll()` on a fresh Redis a no-op — answers cached before
   * the first document upload stayed live in the same `v1` namespace.
   */
  private async currentVersion(): Promise<string> {
    return (await this.redis.get(CACHE_VERSION_KEY)) ?? '0';
  }

  private async answerKey(provider: ProviderName, question: string): Promise<string> {
    return `faq:answer:v${await this.currentVersion()}:${provider}:${this.normalize(question)}`;
  }
}
