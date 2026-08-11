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
const ANSWER_TTL_SECONDS = 60 * 60 * 6; // 6h safety net on top of explicit invalidation

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

  private async answerKey(provider: ProviderName, question: string): Promise<string> {
    const version = (await this.redis.get(CACHE_VERSION_KEY)) ?? '1';
    return `faq:answer:v${version}:${provider}:${this.normalize(question)}`;
  }
}
