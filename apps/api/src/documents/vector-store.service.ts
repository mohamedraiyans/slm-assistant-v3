import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, type Collection } from 'chromadb';
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed';
import type { Chunk } from './document-chunker';

export interface VectorMatch {
  filename: string;
  text: string;
  score: number;
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private client: ChromaClient;
  private collection: Collection;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('CHROMA_URL') ?? 'http://localhost:8000';
    const parsed = new URL(url);
    this.client = new ChromaClient({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 8000,
      ssl: parsed.protocol === 'https:',
    });
  }

  async onModuleInit() {
    this.collection = await this.client.getOrCreateCollection({
      name: 'documents',
      metadata: { 'hnsw:space': 'cosine' },
      embeddingFunction: new DefaultEmbeddingFunction(),
    });
  }

  async addChunks(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.collection.upsert({
      ids: chunks.map((c) => c.id),
      documents: chunks.map((c) => c.text),
      metadatas: chunks.map((c) => ({ filename: c.filename, index: c.index })),
    });
  }

  async query(question: string, topK = 5): Promise<VectorMatch[]> {
    const count = await this.collection.count();
    if (count === 0) return [];

    const results = await this.collection.query({
      queryTexts: [question],
      nResults: Math.min(topK, count),
    });

    const documents = results.documents[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];
    const distances = results.distances[0] ?? [];

    return documents.map((text, i) => ({
      filename: (metadatas[i]?.filename as string) ?? 'unknown',
      text: text ?? '',
      score: Math.round(Math.max(0, 1 - (distances[i] ?? 1)) * 10000) / 10000,
    }));
  }

  async hasDocument(filename: string): Promise<boolean> {
    const existing = await this.collection.get({ where: { filename }, limit: 1 });
    return existing.ids.length > 0;
  }

  async deleteDocument(filename: string): Promise<void> {
    await this.collection.delete({ where: { filename } });
  }
}
