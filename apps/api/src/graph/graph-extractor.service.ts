import { Injectable, Logger } from '@nestjs/common';
import { ProvidersService } from '../providers/providers.service';
import { ProviderFactory } from '../chat/provider-factory.service';
import type { Chunk } from '../documents/document-chunker';
import { GraphService, type Triple } from './graph.service';

const BATCH_SIZE = 3;
// Headroom for reasoning models, which spend part of the budget thinking before they answer.
const EXTRACTION_MAX_TOKENS = 4096;

const PROMPT =
  'Extract a knowledge graph from the text below. Return ONLY a JSON array, no prose. ' +
  'Each item: {"subject":"","subjectType":"","predicate":"","object":"","objectType":""}. ' +
  'Types are one of Person, Organization, Project, Skill, Place, Technology, Concept. ' +
  'Predicate is a short verb phrase like "works at", "built", "uses", "located in". ' +
  'Use full proper names (never pronouns). Only include facts stated in the text.\n\nTEXT:\n';

/** Pulls the JSON array out of a reply that may be wrapped in a code fence or prose. */
export function parseTriples(raw: string): Triple[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is Triple =>
        !!t &&
        typeof t.subject === 'string' &&
        typeof t.predicate === 'string' &&
        typeof t.object === 'string' &&
        t.subject.trim() !== '' &&
        t.object.trim() !== '' &&
        t.predicate.trim() !== '',
    ).map((t) => ({
      subject: t.subject.trim(),
      subjectType: String(t.subjectType ?? 'Concept'),
      predicate: t.predicate.trim(),
      object: t.object.trim(),
      objectType: String(t.objectType ?? 'Concept'),
    }));
  } catch {
    return [];
  }
}

@Injectable()
export class GraphExtractorService {
  private readonly logger = new Logger(GraphExtractorService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly providers: ProvidersService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  /**
   * Background indexing: never throws and is never awaited by the upload, because
   * extraction costs one LLM call per few chunks.
   */
  async indexDocument(filename: string, chunks: Chunk[]): Promise<void> {
    if (!this.graph.enabled) return;
    try {
      const [provider] = await this.providers.findActiveProviderNames();
      if (!provider) {
        this.logger.warn('No active LLM provider; skipping graph extraction');
        return;
      }
      const model = await this.providerFactory.build(provider, EXTRACTION_MAX_TOKENS);
      const triples: Triple[] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const text = chunks
          .slice(i, i + BATCH_SIZE)
          .map((c) => c.text)
          .join('\n\n');
        try {
          const reply = await model.invoke(PROMPT + text);
          const batch = parseTriples(String(reply.content));
          if (batch.length === 0) {
            this.logger.warn(
              `No facts parsed for ${filename} batch ${i / BATCH_SIZE + 1}; reply started: ${String(reply.content).slice(0, 120) || '(empty)'}`,
            );
          }
          triples.push(...batch);
        } catch (error) {
          this.logger.warn(`Extraction batch failed for ${filename}: ${(error as Error).message}`);
        }
      }
      await this.graph.replaceDocument(filename, triples);
      this.logger.log(`Graph indexed ${filename}: ${triples.length} facts via ${provider}`);
    } catch (error) {
      this.logger.warn(`Graph indexing of ${filename} aborted: ${(error as Error).message}`);
    }
  }
}
