jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
import { parseTriples } from './graph-extractor.service';
import { entityKey, toRelType } from './graph.service';

describe('graph helpers', () => {
  it('turns predicates into safe Cypher relationship types', () => {
    expect(toRelType('works at')).toBe('WORKS_AT');
    expect(toRelType('built `]-() DETACH DELETE n //')).toBe('BUILT_DETACH_DELETE_N');
    expect(toRelType('123')).toBe('RELATED_TO');
  });

  it('normalises entity keys', () => {
    expect(entityKey('  Acme   Corp ')).toBe('acme corp');
  });

  it('parses triples out of a fenced reply and drops malformed ones', () => {
    const raw =
      'Sure!\n```json\n[{"subject":"Ana","subjectType":"Person","predicate":"works at","object":"Acme","objectType":"Organization"},{"subject":"","predicate":"x","object":"y"}]\n```';
    expect(parseTriples(raw)).toEqual([
      { subject: 'Ana', subjectType: 'Person', predicate: 'works at', object: 'Acme', objectType: 'Organization' },
    ]);
    expect(parseTriples('no json here')).toEqual([]);
  });
});
