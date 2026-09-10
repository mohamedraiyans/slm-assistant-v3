import { chunkDocument } from './document-chunker';

/**
 * The chunker decides what the retriever is even *able* to find, so most of these
 * are regression tests for retrieval failures that reached production:
 *
 *  - A section heading became a chunk with no body. It still scored highly on topic
 *    words ("Education"), so it occupied a top-k slot while the entries underneath
 *    it — split into separate, context-free lines — competed individually and fell
 *    below the cutoff. "List the universities" returned one university.
 *  - A later fix carried overlap forward by *lines* rather than words, which let a
 *    chunk reach twice its word budget once long paragraphs were involved.
 */

const TARGET_WORDS = 70;
const OVERLAP_WORDS = 20;

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

const RESUME = [
  'Arooshan Sivakumar',
  'Software Engineer',
  'Education',
  'University of Greenwich',
  'BSc Computer Science, 2018 - 2021',
  'Uppsala University',
  'MSc Data Science, 2022 - 2024',
  'Experience',
  'HubEurope AB',
  'Backend Engineer, 2024 - present',
  'Built a multi-tenant retrieval assistant serving internal documentation.',
].join('\n');

/** Lines long enough that none of them is mistaken for a heading. */
const prose = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) =>
      `Paragraph ${i} contains several ordinary words of filler prose here`,
  ).join('\n');

describe('chunkDocument', () => {
  describe('section awareness', () => {
    it('keeps a heading attached to the entries it introduces', () => {
      const chunks = chunkDocument('resume.pdf', RESUME);
      const withEducation = chunks.filter((c) => c.text.includes('Education'));

      expect(withEducation.length).toBeGreaterThan(0);
      expect(
        withEducation.some((c) => c.text.includes('University of Greenwich')),
      ).toBe(true);
    });

    it('places sibling entries of one section in a single chunk', () => {
      // The original bug: "list the universities" could only ever retrieve one of
      // them, because each was an isolated line competing for its own top-k slot.
      const chunks = chunkDocument('resume.pdf', RESUME);

      expect(
        chunks.some(
          (c) =>
            c.text.includes('University of Greenwich') &&
            c.text.includes('Uppsala University'),
        ),
      ).toBe(true);
    });

    it('starts a new chunk at a heading even when the budget has room left', () => {
      // Both sections together are well under one chunk's word budget, so only
      // heading detection can separate them. Without it, "where did they study"
      // retrieves the employment history too, diluting the match.
      const chunks = chunkDocument(
        'resume.pdf',
        [
          'Education',
          'University of Greenwich BSc Computer Science 2018 to 2021',
          'Experience',
          'HubEurope AB Backend Engineer 2024 to present',
        ].join('\n'),
      );

      expect(chunks).toHaveLength(2);
      expect(chunks[0].text).toContain('University of Greenwich');
      expect(chunks[0].text).not.toContain('HubEurope');
    });

    it('never emits a chunk that is only headings', () => {
      const chunks = chunkDocument(
        'resume.pdf',
        'Education\nExperience\nSkills\nWorked at HubEurope as a backend engineer for two years.',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('Education');
      expect(chunks[0].text).toContain('backend engineer');
    });

    it('attaches headings that trail at the end of a document to the last chunk', () => {
      const chunks = chunkDocument(
        'notes.pdf',
        'Worked at HubEurope as a backend engineer for two years.\nReferences',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('References');
    });

    it('does not treat a "key: value" line as a heading', () => {
      // Key-per-line documents use short lines for real content, not section starts.
      const chunks = chunkDocument(
        'contact.pdf',
        'Company: HubEurope AB\nLocation: Kungsgatan 12\nPhone: 073 123 4567',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toContain('Kungsgatan 12');
      expect(chunks[0].text).toContain('073 123 4567');
    });
  });

  describe('word budget', () => {
    it('keeps chunks within the target plus one overlap window', () => {
      const chunks = chunkDocument('long.pdf', prose(30));

      // Meaningful only if the document actually split.
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(countWords(chunk.text)).toBeLessThanOrEqual(
          TARGET_WORDS + OVERLAP_WORDS,
        );
      }
    });

    it('splits a single over-long line instead of emitting it whole', () => {
      const paragraph = Array.from({ length: 400 }, (_, i) => `word${i}`).join(
        ' ',
      );
      const chunks = chunkDocument('paper.pdf', paragraph);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(countWords(chunk.text)).toBeLessThanOrEqual(
          TARGET_WORDS + OVERLAP_WORDS,
        );
      }
    });

    it('terminates when the overlap is larger than the target', () => {
      // Guards the `Math.max(1, ...)` step floor: without it the window never
      // advances and the loop spins forever.
      const paragraph = Array.from({ length: 60 }, (_, i) => `word${i}`).join(
        ' ',
      );

      const chunks = chunkDocument('degenerate.pdf', paragraph, 5, 20);

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('overlap', () => {
    it('carries the tail of the previous section into the next chunk', () => {
      const chunks = chunkDocument('long.pdf', prose(30));

      for (let i = 1; i < chunks.length; i += 1) {
        const firstLine = chunks[i].text.split('\n')[0];
        expect(chunks[i - 1].text).toContain(firstLine);
      }
    });

    it('omits overlap entirely when it is disabled', () => {
      const chunks = chunkDocument('long.pdf', prose(30), TARGET_WORDS, 0);

      for (let i = 1; i < chunks.length; i += 1) {
        const firstLine = chunks[i].text.split('\n')[0];
        expect(chunks[i - 1].text).not.toContain(firstLine);
      }
    });
  });

  describe('content preservation', () => {
    it('emits every source line at least once', () => {
      const chunks = chunkDocument('resume.pdf', RESUME);
      const combined = chunks.map((c) => c.text).join('\n');

      for (const line of RESUME.split('\n')) {
        expect(combined).toContain(line);
      }
    });

    it('drops blank and whitespace-only lines', () => {
      const chunks = chunkDocument(
        'spaced.pdf',
        'First real line of the document here\n\n   \n\nSecond real line of the document here',
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(
        'First real line of the document here\nSecond real line of the document here',
      );
    });
  });

  describe('chunk identity', () => {
    it('numbers chunks positionally under the filename', () => {
      const chunks = chunkDocument('resume.pdf', prose(30));

      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
        expect(chunk.id).toBe(`resume.pdf::${i}`);
        expect(chunk.filename).toBe('resume.pdf');
      });
    });

    it('is deterministic for identical input', () => {
      // Ids are positional, so re-uploading a *shorter* document leaves orphaned
      // vectors behind unless the caller deletes first — see DocumentsService.
      expect(chunkDocument('resume.pdf', RESUME)).toEqual(
        chunkDocument('resume.pdf', RESUME),
      );
    });
  });

  describe('empty input', () => {
    it.each([
      ['an empty string', ''],
      ['whitespace only', '   \n\n\t  \n'],
    ])('returns no chunks for %s', (_label, text) => {
      expect(chunkDocument('empty.pdf', text)).toEqual([]);
    });
  });
});
