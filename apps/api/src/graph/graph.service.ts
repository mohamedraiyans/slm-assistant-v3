import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { type Driver } from 'neo4j-driver';

export interface Triple {
  subject: string;
  subjectType: string;
  predicate: string;
  object: string;
  objectType: string;
}

export interface GraphData {
  nodes: { id: string; name: string; type: string }[];
  links: { source: string; target: string; type: string; file: string }[];
}

/** Relationship types are interpolated into Cypher (they can't be parameters), so keep them to A-Z_. */
export function toRelType(predicate: string): string {
  const cleaned = predicate
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[A-Z]/.test(cleaned) ? cleaned.slice(0, 40) : 'RELATED_TO';
}

export function entityKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Thin wrapper over Neo4j. Optional by design: with NEO4J_URI unset, or the database
 * unreachable, every method degrades to a no-op so plain vector RAG keeps working.
 */
@Injectable()
export class GraphService implements OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private readonly driver: Driver | null;

  constructor(config: ConfigService) {
    const uri = config.get<string>('NEO4J_URI');
    this.driver = uri
      ? neo4j.driver(
          uri,
          neo4j.auth.basic(
            config.get<string>('NEO4J_USER') ?? 'neo4j',
            config.get<string>('NEO4J_PASSWORD') ?? '',
          ),
        )
      : null;
  }

  get enabled(): boolean {
    return this.driver !== null;
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  private async run<T>(
    cypher: string,
    params: Record<string, unknown>,
    map: (record: Record<string, unknown>) => T,
  ): Promise<T[]> {
    if (!this.driver) return [];
    const session = this.driver.session();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((r) => map(r.toObject()));
    } finally {
      await session.close();
    }
  }

  /** Replaces everything a file contributed, so re-uploading never leaves stale facts. */
  async replaceDocument(file: string, triples: Triple[]): Promise<void> {
    if (!this.driver) return;
    await this.deleteDocument(file);
    for (const t of triples) {
      const rel = toRelType(t.predicate);
      await this.run(
        `MERGE (a:Entity {key: $aKey}) ON CREATE SET a.name = $aName, a.type = $aType
         MERGE (b:Entity {key: $bKey}) ON CREATE SET b.name = $bName, b.type = $bType
         MERGE (a)-[:${rel} {source: $file}]->(b)`,
        {
          aKey: entityKey(t.subject),
          aName: t.subject,
          aType: t.subjectType,
          bKey: entityKey(t.object),
          bName: t.object,
          bType: t.objectType,
          file,
        },
        () => null,
      );
    }
  }

  async deleteDocument(file: string): Promise<void> {
    if (!this.driver) return;
    try {
      await this.run('MATCH ()-[r {source: $file}]-() DELETE r', { file }, () => null);
      await this.run('MATCH (e:Entity) WHERE NOT (e)--() DELETE e', {}, () => null);
    } catch (error) {
      this.logger.warn(`Graph cleanup for ${file} failed: ${(error as Error).message}`);
    }
  }

  /**
   * The GraphRAG step: find entities named in the question, then walk up to two hops
   * out from them. Two hops is what answers "which projects did people from X work on",
   * which no single chunk contains.
   */
  async factsFor(question: string, limit = 25): Promise<string[]> {
    if (!this.driver) return [];
    try {
      const rows = await this.run(
        `MATCH (seed:Entity)
         WHERE size(seed.key) >= 3 AND $q CONTAINS seed.key
         MATCH p = (seed)-[*1..2]-(:Entity)
         UNWIND relationships(p) AS r
         WITH DISTINCT r
         RETURN startNode(r).name AS a, type(r) AS rel, endNode(r).name AS b, r.source AS file
         LIMIT ${Math.floor(limit)}`,
        { q: entityKey(question) },
        (o) => `${o.a} -[${o.rel}]-> ${o.b} (${o.file})`,
      );
      return rows;
    } catch (error) {
      this.logger.warn(`Graph lookup failed, continuing without it: ${(error as Error).message}`);
      return [];
    }
  }

  async data(limit = 300): Promise<GraphData> {
    const rows = await this.run(
      `MATCH (a:Entity)-[r]->(b:Entity)
       RETURN a.key AS ak, a.name AS an, a.type AS at, type(r) AS rel,
              r.source AS file, b.key AS bk, b.name AS bn, b.type AS bt
       LIMIT ${Math.floor(limit)}`,
      {},
      (o) => o as Record<string, string>,
    );
    const nodes = new Map<string, GraphData['nodes'][number]>();
    const links: GraphData['links'] = [];
    for (const o of rows) {
      nodes.set(o.ak, { id: o.ak, name: o.an, type: o.at });
      nodes.set(o.bk, { id: o.bk, name: o.bn, type: o.bt });
      links.push({ source: o.ak, target: o.bk, type: o.rel, file: o.file });
    }
    return { nodes: [...nodes.values()], links };
  }
}
