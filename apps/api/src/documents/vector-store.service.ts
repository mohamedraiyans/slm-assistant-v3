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

// How many candidates to consider before trimming down to topK.
const POOL_MULTIPLIER = 3;
// Most chunks any single file may contribute before others get a turn.
const MAX_PER_FILE = 4;

/**
 * Trims a relevance-ordered pool to `topK`, capping how many chunks any one file
 * may contribute so a single densely on-topic document can't crowd out passages
 * that live in the others. Remaining slots are then filled from the rest of the
 * pool regardless of file, so a question that genuinely concerns only one
 * document still gets a full context window.
 */
function spreadAcrossFiles(pool: VectorMatch[], topK: number): VectorMatch[] {
  const chosen = new Set<number>();
  const perFile = new Map<string, number>();

  for (let i = 0; i < pool.length && chosen.size < topK; i += 1) {
    const used = perFile.get(pool[i].filename) ?? 0;
    if (used >= MAX_PER_FILE) continue;
    chosen.add(i);
    perFile.set(pool[i].filename, used + 1);
  }

  for (let i = 0; i < pool.length && chosen.size < topK; i += 1) {
    chosen.add(i);
  }

  // Sorting by pool index keeps the original relevance ordering.
  return [...chosen].sort((a, b) => a - b).map((i) => pool[i]);
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

    // Over-fetch, then trim with a per-file cap: plain top-k has no notion of
    // document coverage, so one densely on-topic file can take every slot and
    // hide relevant passages in every other file.
    const results = await this.collection.query({
      queryTexts: [question],
      nResults: Math.min(topK * POOL_MULTIPLIER, count),
    });

    const documents = results.documents[0] ?? [];
    const metadatas = results.metadatas[0] ?? [];
    const distances = results.distances[0] ?? [];

    const pool = documents.map((text, i) => ({
      filename: (metadatas[i]?.filename as string) ?? 'unknown',
      text: text ?? '',
      score: Math.round(Math.max(0, 1 - (distances[i] ?? 1)) * 10000) / 10000,
    }));

    return spreadAcrossFiles(pool, topK);
  }

  async hasDocument(filename: string): Promise<boolean> {
    const existing = await this.collection.get({ where: { filename }, limit: 1 });
    return existing.ids.length > 0;
  }

  async deleteDocument(filename: string): Promise<void> {
    await this.collection.delete({ where: { filename } });
  }
}
