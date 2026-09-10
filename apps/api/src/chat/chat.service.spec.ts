import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Document } from '@langchain/core/documents';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ChatPromptValue } from '@langchain/core/prompt_values';
import {
  KnowledgeBaseRetriever,
  type KnowledgeBaseDocMetadata,
} from '../documents/knowledge-base-retriever';
import { FaqService } from '../faq/faq.service';
import { ProvidersService } from '../providers/providers.service';
import { ChatService } from './chat.service';
import { MemoryService } from './memory.service';
import { ProviderFactory } from './provider-factory.service';

// `ProvidersService` is imported purely for its DI token, but it pulls in Prisma
// transitively. Stubbing that boundary keeps this a real unit test: no generated
// client, no database, no connection attempt.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

const USER_ID = 'user-1';

/**
 * Only the *model* is faked. The prompt template, the LCEL sequence and the output
 * parser are the real ones, so these tests exercise the actual chain rather than a
 * mock of it — a broken prompt or a parser change fails here.
 */
function fakeModel(...responses: string[]): BaseChatModel {
  return new FakeListChatModel({ responses });
}

function doc(filename: string, text: string, score: number) {
  return new Document<KnowledgeBaseDocMetadata>({
    pageContent: text,
    metadata: { filename, score },
  });
}

describe('ChatService', () => {
  let service: ChatService;
  let memory: MemoryService;
  let retriever: { invoke: jest.Mock };
  let providerFactory: { build: jest.Mock };
  let providers: { findActiveProviderNames: jest.Mock };
  let faq: {
    recordQuestion: jest.Mock;
    getCachedAnswer: jest.Mock;
    setCachedAnswer: jest.Mock;
    getTopQuestions: jest.Mock;
    claimWarmSlot: jest.Mock;
  };

  beforeAll(() => {
    // Warming logs expected failures at warn level; keep the test output readable.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(async () => {
    retriever = {
      invoke: jest
        .fn()
        .mockResolvedValue([doc('handbook.pdf', 'Leave is 25 days.', 0.82)]),
    };
    providerFactory = {
      build: jest.fn().mockResolvedValue(fakeModel('25 days of leave.')),
    };
    providers = {
      findActiveProviderNames: jest.fn().mockResolvedValue(['GROQ']),
    };
    faq = {
      recordQuestion: jest.fn().mockResolvedValue(undefined),
      getCachedAnswer: jest.fn().mockResolvedValue(null),
      setCachedAnswer: jest.fn().mockResolvedValue(undefined),
      getTopQuestions: jest.fn().mockResolvedValue([]),
      claimWarmSlot: jest.fn().mockResolvedValue(true),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        MemoryService,
        { provide: KnowledgeBaseRetriever, useValue: retriever },
        { provide: ProviderFactory, useValue: providerFactory },
        { provide: FaqService, useValue: faq },
        { provide: ProvidersService, useValue: providers },
      ],
    }).compile();

    service = moduleRef.get(ChatService);
    memory = moduleRef.get(MemoryService);
  });

  describe('handleChat — cache miss', () => {
    it('answers from retrieved context and reports the sources', async () => {
      const result = await service.handleChat(
        USER_ID,
        'How much leave?',
        'GROQ',
      );

      expect(result).toEqual({
        answer: '25 days of leave.',
        sources: [
          { filename: 'handbook.pdf', text: 'Leave is 25 days.', score: 0.82 },
        ],
        cached: false,
      });
    });

    it('caches the answer under the requested provider', async () => {
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      expect(faq.setCachedAnswer).toHaveBeenCalledWith(
        'GROQ',
        'How much leave?',
        {
          answer: '25 days of leave.',
          sources: [
            {
              filename: 'handbook.pdf',
              text: 'Leave is 25 days.',
              score: 0.82,
            },
          ],
        },
      );
    });

    it('feeds retrieved chunks into the prompt, tagged by filename', async () => {
      const model = fakeModel('25 days of leave.');
      const invoke = jest.spyOn(model, 'invoke');
      providerFactory.build.mockResolvedValue(model);
      retriever.invoke.mockResolvedValue([
        doc('handbook.pdf', 'Leave is 25 days.', 0.82),
        doc('policy.docx', 'Carry-over is capped at 5 days.', 0.71),
      ]);

      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      const prompt = (invoke.mock.calls[0][0] as ChatPromptValue).toString();
      expect(prompt).toContain('[handbook.pdf] Leave is 25 days.');
      expect(prompt).toContain('[policy.docx] Carry-over is capped at 5 days.');
      expect(prompt).toContain('How much leave?');
    });

    it('tells the model when the knowledge base has nothing to offer', async () => {
      const model = fakeModel('I do not have that information.');
      const invoke = jest.spyOn(model, 'invoke');
      providerFactory.build.mockResolvedValue(model);
      retriever.invoke.mockResolvedValue([]);

      const result = await service.handleChat(USER_ID, 'Anything?', 'GROQ');

      expect((invoke.mock.calls[0][0] as ChatPromptValue).toString()).toContain(
        'No relevant information found in the knowledge base.',
      );
      expect(result.sources).toEqual([]);
    });

    it('builds the model for the provider the caller asked for', async () => {
      await service.handleChat(USER_ID, 'How much leave?', 'ANTHROPIC');

      expect(providerFactory.build).toHaveBeenCalledWith('ANTHROPIC');
    });
  });

  describe('handleChat — cache hit', () => {
    const cached = {
      answer: 'A cached answer.',
      sources: [
        { filename: 'handbook.pdf', text: 'Leave is 25 days.', score: 0.82 },
      ],
    };

    beforeEach(() => faq.getCachedAnswer.mockResolvedValue(cached));

    it('skips retrieval and the LLM entirely', async () => {
      // This is the whole point of the cache: a repeat question must not consume
      // provider quota or run a vector search.
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      expect(retriever.invoke).not.toHaveBeenCalled();
      expect(providerFactory.build).not.toHaveBeenCalled();
    });

    it('flags the answer as cached and returns the stored sources', async () => {
      const result = await service.handleChat(
        USER_ID,
        'How much leave?',
        'GROQ',
      );

      expect(result).toEqual({ ...cached, cached: true });
    });

    it('does not rewrite the cache entry it just read', async () => {
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      expect(faq.setCachedAnswer).not.toHaveBeenCalled();
    });

    it('still counts the question towards the frequency ranking', async () => {
      // It is the *question* that is frequently asked, independent of whether any
      // one provider happened to have an answer cached.
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      expect(faq.recordQuestion).toHaveBeenCalledWith('How much leave?');
    });
  });

  describe('handleChat — conversation memory', () => {
    it('records both sides of the exchange', async () => {
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');

      expect(memory.getAll(USER_ID)).toEqual([
        { role: 'user', content: 'How much leave?' },
        { role: 'assistant', content: '25 days of leave.' },
      ]);
    });

    it('keeps each user history separate', async () => {
      await service.handleChat(USER_ID, 'How much leave?', 'GROQ');
      await service.handleChat('user-2', 'Something else?', 'GROQ');

      expect(memory.getAll(USER_ID)).toHaveLength(2);
      expect(memory.getAll('user-2')).toHaveLength(2);
    });
  });

  describe('handleChat — empty provider response', () => {
    // Regression: an Azure hiccup returned "" once, which was cached and then
    // served back as a blank answer until the next document upload.
    beforeEach(() => providerFactory.build.mockResolvedValue(fakeModel('   ')));

    it('fails loudly rather than returning a blank answer', async () => {
      await expect(
        service.handleChat(USER_ID, 'How much leave?', 'GROQ'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('names the provider so the user knows to switch', async () => {
      await expect(
        service.handleChat(USER_ID, 'How much leave?', 'GROQ'),
      ).rejects.toThrow(/GROQ/);
    });

    it('never caches the blank response', async () => {
      await expect(service.handleChat(USER_ID, 'q', 'GROQ')).rejects.toThrow();

      expect(faq.setCachedAnswer).not.toHaveBeenCalled();
    });

    it('leaves no assistant turn in the conversation history', async () => {
      await expect(service.handleChat(USER_ID, 'q', 'GROQ')).rejects.toThrow();

      expect(memory.getAll(USER_ID)).toEqual([{ role: 'user', content: 'q' }]);
    });
  });

  describe('warmFrequentQuestions', () => {
    const topQuestions = [
      { question: 'what is rag', count: 9 },
      { question: 'how much leave', count: 4 },
    ];

    it('pre-generates every top question for every active provider', async () => {
      faq.getTopQuestions.mockResolvedValue(topQuestions);
      providers.findActiveProviderNames.mockResolvedValue([
        'GROQ',
        'AZURE_OPENAI',
      ]);
      providerFactory.build.mockImplementation(() =>
        Promise.resolve(fakeModel('warmed')),
      );

      await service.warmFrequentQuestions();

      expect(faq.setCachedAnswer).toHaveBeenCalledTimes(4);
      for (const provider of ['GROQ', 'AZURE_OPENAI']) {
        for (const { question } of topQuestions) {
          expect(faq.setCachedAnswer).toHaveBeenCalledWith(
            provider,
            question,
            expect.objectContaining({ answer: 'warmed' }),
          );
        }
      }
    });

    it('runs at most once per cache version', async () => {
      faq.getTopQuestions.mockResolvedValue(topQuestions);
      faq.claimWarmSlot.mockResolvedValue(false);

      await service.warmFrequentQuestions();

      expect(retriever.invoke).not.toHaveBeenCalled();
      expect(faq.setCachedAnswer).not.toHaveBeenCalled();
    });

    it('skips questions that are already cached', async () => {
      faq.getTopQuestions.mockResolvedValue(topQuestions);
      faq.getCachedAnswer.mockImplementation((_p: string, question: string) =>
        Promise.resolve(
          question === 'what is rag'
            ? { answer: 'already here', sources: [] }
            : null,
        ),
      );

      await service.warmFrequentQuestions();

      expect(faq.setCachedAnswer).toHaveBeenCalledTimes(1);
      expect(faq.setCachedAnswer).toHaveBeenCalledWith(
        'GROQ',
        'how much leave',
        expect.anything(),
      );
    });

    it('does not spend the version’s single attempt when there is nothing to warm', async () => {
      faq.getTopQuestions.mockResolvedValue([]);

      await service.warmFrequentQuestions();

      expect(faq.claimWarmSlot).not.toHaveBeenCalled();
    });

    it('does not spend the attempt when no provider is configured', async () => {
      faq.getTopQuestions.mockResolvedValue(topQuestions);
      providers.findActiveProviderNames.mockResolvedValue([]);

      await service.warmFrequentQuestions();

      expect(faq.claimWarmSlot).not.toHaveBeenCalled();
    });

    it('keeps going after one provider fails', async () => {
      faq.getTopQuestions.mockResolvedValue([topQuestions[0]]);
      providers.findActiveProviderNames.mockResolvedValue([
        'GROQ',
        'AZURE_OPENAI',
      ]);
      providerFactory.build.mockImplementation((provider: string) =>
        provider === 'GROQ'
          ? Promise.reject(new Error('rate limited'))
          : Promise.resolve(fakeModel('warmed')),
      );

      await expect(service.warmFrequentQuestions()).resolves.toBeUndefined();

      expect(faq.setCachedAnswer).toHaveBeenCalledTimes(1);
      expect(faq.setCachedAnswer).toHaveBeenCalledWith(
        'AZURE_OPENAI',
        'what is rag',
        expect.anything(),
      );
    });

    it('never throws, even if the FAQ store is unreachable', async () => {
      // Warming is fire-and-forget from GET /chat/faq — a rejection here would
      // surface as an unhandled promise rejection, not a failed request.
      faq.getTopQuestions.mockRejectedValue(new Error('redis down'));

      await expect(service.warmFrequentQuestions()).resolves.toBeUndefined();
    });
  });
});
