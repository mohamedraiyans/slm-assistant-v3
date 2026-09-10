import { Injectable } from '@nestjs/common';
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { VectorStoreService } from './vector-store.service';

export interface KnowledgeBaseDocMetadata extends Record<string, unknown> {
  filename: string;
  score: number;
}

const TOP_K = 8;

@Injectable()
export class KnowledgeBaseRetriever extends BaseRetriever<KnowledgeBaseDocMetadata> {
  lc_namespace = ['slm', 'retrievers', 'knowledge_base'];

  constructor(private readonly vectorStore: VectorStoreService) {
    super();
  }

  async _getRelevantDocuments(query: string): Promise<Document<KnowledgeBaseDocMetadata>[]> {
    // Aggregate questions ("list every X") need more than a handful of chunks —
    // a hard top-5 silently dropped correct answers that ranked just below it.
    const matches = await this.vectorStore.query(query, TOP_K);
    return matches.map(
      (m) => new Document({ pageContent: m.text, metadata: { filename: m.filename, score: m.score } }),
    );
  }
}
