import { Injectable } from '@nestjs/common';
import { BaseRetriever } from '@langchain/core/retrievers';
import { Document } from '@langchain/core/documents';
import { VectorStoreService } from './vector-store.service';

export interface KnowledgeBaseDocMetadata extends Record<string, unknown> {
  filename: string;
  score: number;
}

@Injectable()
export class KnowledgeBaseRetriever extends BaseRetriever<KnowledgeBaseDocMetadata> {
  lc_namespace = ['slm', 'retrievers', 'knowledge_base'];

  constructor(private readonly vectorStore: VectorStoreService) {
    super();
  }

  async _getRelevantDocuments(query: string): Promise<Document<KnowledgeBaseDocMetadata>[]> {
    const matches = await this.vectorStore.query(query, 5);
    return matches.map(
      (m) => new Document({ pageContent: m.text, metadata: { filename: m.filename, score: m.score } }),
    );
  }
}
