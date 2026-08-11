import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ProviderName } from '@slm/shared-types';
import { VectorStoreService, type VectorMatch } from '../documents/vector-store.service';
import { FaqService } from '../faq/faq.service';
import { MemoryService } from './memory.service';
import { ProviderFactory } from './provider-factory.service';

const SYSTEM_PROMPT =
  "You are a helpful assistant answering questions using the company's knowledge base. " +
  'Use the provided context to answer naturally and confidently, handling synonyms and ' +
  "paraphrased questions. If the answer isn't in the context, say so clearly.";

export interface ChatResult {
  answer: string;
  sources: VectorMatch[];
  cached: boolean;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly vectorStore: VectorStoreService,
    private readonly providerFactory: ProviderFactory,
    private readonly memory: MemoryService,
    private readonly faq: FaqService,
  ) {}

  async handleChat(userId: string, question: string, provider: ProviderName): Promise<ChatResult> {
    this.memory.save(userId, 'user', question);
    // Frequency is tracked regardless of provider or cache outcome, since it's the
    // question itself that's "frequently asked", not any one provider's answer to it.
    void this.faq.recordQuestion(question);

    const cached = await this.faq.getCachedAnswer(provider, question);
    if (cached) {
      this.memory.save(userId, 'assistant', cached.answer);
      return { answer: cached.answer, sources: cached.sources, cached: true };
    }

    const matches = await this.vectorStore.query(question, 5);
    const context = matches.length
      ? matches.map((m) => `[${m.filename}] ${m.text}`).join('\n\n')
      : 'No relevant information found in the knowledge base.';

    const model = await this.providerFactory.build(provider);
    const response = await model.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(`Context:\n${context}\n\nQuestion: ${question}`),
    ]);
    const answer = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    if (!answer.trim()) {
      // Don't cache or persist a blank reply — an empty LLM response is a
      // provider hiccup, not a valid answer, and caching it would serve the
      // same blank reply forever until the cache version next bumps.
      throw new InternalServerErrorException(
        `${provider} returned an empty response. Try again or switch providers.`,
      );
    }

    this.memory.save(userId, 'assistant', answer);
    await this.faq.setCachedAnswer(provider, question, { answer, sources: matches });
    return { answer, sources: matches, cached: false };
  }
}
