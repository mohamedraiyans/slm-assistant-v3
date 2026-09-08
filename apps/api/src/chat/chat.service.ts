import { Injectable, InternalServerErrorException } from '@nestjs/common';
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

@Injectable()
export class ChatService {
  constructor(
    private readonly retriever: KnowledgeBaseRetriever,
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

    const sources = toVectorMatches(docs);
    this.memory.save(userId, 'assistant', answer);
    await this.faq.setCachedAnswer(provider, question, { answer, sources });
    return { answer, sources, cached: false };
  }
}
