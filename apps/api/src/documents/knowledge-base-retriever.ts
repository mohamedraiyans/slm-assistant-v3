import { Injectable } from '@nestjs/common';
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { VectorStoreService } from './vector-store.service';

export interface KnowledgeBaseDocMetadata extends Record<string, unknown> {
  filename: string;
  score: number;
}

// Chunks are ~70 words, so even 12 is a small context window. Aggregate questions
// ("list every X") need enough slots for several files to be represented at once —
// see the per-file cap in VectorStoreService.query.
const TOP_K = 12;

@Injectable()
export class KnowledgeBaseRetriever extends BaseRetriever<KnowledgeBaseDocMetadata> {
  lc_namespace = ['slm', 'retrievers', 'knowledge_base'];

  constructor(private readonly vectorStore: VectorStoreService) {
    super();
  }

  async _getRelevantDocuments(query: string): Promise<Document<KnowledgeBaseDocMetadata>[]> {
    const matches = await this.vectorStore.query(query, TOP_K);
    return matches.map(
      (m) => new Document({ pageContent: m.text, metadata: { filename: m.filename, score: m.score } }),
    );
  }
}
