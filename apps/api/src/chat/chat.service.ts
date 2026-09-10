import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';
import type { Document } from '@langchain/core/documents';
import type { ProviderName } from '@slm/shared-types';
import {
  KnowledgeBaseRetriever,
  type KnowledgeBaseDocMetadata,
} from '../documents/knowledge-base-retriever';
import type { VectorMatch } from '../documents/vector-store.service';
import { FaqService } from '../faq/faq.service';
import { ProvidersService } from '../providers/providers.service';
import { MemoryService } from './memory.service';
import { ProviderFactory } from './provider-factory.service';

const SYSTEM_PROMPT =
  "You are a helpful assistant answering questions using the company's knowledge base. " +
  'Use the provided context to answer naturally and confidently, handling synonyms and ' +
  "paraphrased questions. If the answer isn't in the context, say so clearly.";

const promptTemplate = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  ['human', 'Context:\n{context}\n\nQuestion: {question}'],
]);

function formatDocuments(docs: Document<KnowledgeBaseDocMetadata>[]): string {
  return docs.length
    ? docs.map((doc) => `[${doc.metadata.filename}] ${doc.pageContent}`).join('\n\n')
    : 'No relevant information found in the knowledge base.';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toVectorMatches(docs: Document<KnowledgeBaseDocMetadata>[]): VectorMatch[] {
  return docs.map((doc) => ({
    filename: doc.metadata.filename,
    text: doc.pageContent,
    score: doc.metadata.score,
  }));
}

export interface ChatResult {
  answer: string;
  sources: VectorMatch[];
  cached: boolean;
}

// Kept deliberately small: warming runs for every active provider, so this is
// multiplied by the number of configured providers in LLM calls per document change.
const WARM_QUESTION_LIMIT = 5;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly retriever: KnowledgeBaseRetriever,
    private readonly providerFactory: ProviderFactory,
    private readonly memory: MemoryService,
    private readonly faq: FaqService,
    private readonly providers: ProvidersService,
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

    const { answer, sources } = await this.generateAnswer(question, provider);
    this.memory.save(userId, 'assistant', answer);
    await this.faq.setCachedAnswer(provider, question, { answer, sources });
    return { answer, sources, cached: false };
  }

  /**
   * Retrieval + generation only. Deliberately touches neither conversation memory
   * nor the question-frequency counter, so background warming can reuse it without
   * polluting a user's chat history or inflating the "frequently asked" ranking.
   */
  private async generateAnswer(
    question: string,
    provider: ProviderName,
  ): Promise<{ answer: string; sources: VectorMatch[] }> {
    const docs = await this.retriever.invoke(question);
    const model = await this.providerFactory.build(provider);
    const chain = RunnableSequence.from([promptTemplate, model, new StringOutputParser()]);
    const answer = await chain.invoke({ context: formatDocuments(docs), question });

    if (!answer.trim()) {
      // Don't cache or persist a blank reply — an empty LLM response is a
      // provider hiccup, not a valid answer, and caching it would serve the
      // same blank reply forever until the cache version next bumps.
      throw new InternalServerErrorException(
        `${provider} returned an empty response. Try again or switch providers.`,
      );
    }

    return { answer, sources: toVectorMatches(docs) };
  }

  /**
   * Pre-generates answers for the most-asked questions so clicking one in the
   * "Frequently Asked" tab is instant instead of paying for a fresh LLM call.
   *
   * Runs at most once per cache version, which means it re-warms exactly once
   * after each document upload/delete (those bump the version) and is otherwise a
   * no-op no matter how often the FAQ list is polled. Best-effort by design: it
   * never throws, and a failure for one question/provider doesn't stop the rest.
   */
  async warmFrequentQuestions(): Promise<void> {
    try {
      const questions = await this.faq.getTopQuestions(WARM_QUESTION_LIMIT);
      if (questions.length === 0) return;

      const providers = await this.providers.findActiveProviderNames();
      if (providers.length === 0) return;

      // Claimed last, so an empty question list or unconfigured provider doesn't
      // burn this version's single warm attempt.
      if (!(await this.faq.claimWarmSlot())) return;

      let warmed = 0;
      for (const provider of providers) {
        for (const { question } of questions) {
          try {
            if (await this.faq.getCachedAnswer(provider, question)) continue;
            const result = await this.generateAnswer(question, provider);
            await this.faq.setCachedAnswer(provider, question, result);
            warmed += 1;
          } catch (error) {
            this.logger.warn(
              `FAQ warm failed for ${provider} / "${question}": ${describeError(error)}`,
            );
          }
        }
      }
      this.logger.log(`FAQ warm complete: cached ${warmed} answer(s)`);
    } catch (error) {
      this.logger.warn(`FAQ warm aborted: ${describeError(error)}`);
    }
  }
}
