import { BadRequestException } from '@nestjs/common';
import { parseReferenceInput } from './reference-input';

const parse = (body: Record<string, unknown>, originalName = 'Al-Fatiha.mp3') =>
  parseReferenceInput(body, originalName);

describe('parseReferenceInput', () => {
  describe('surah', () => {
    it('parses the string form multipart forms always send', () => {
      expect(parse({ surah: '112' }).surah).toBe(112);
    });

    it.each(['1', '114'])('accepts the boundary surah %s', (surah) => {
      expect(() => parse({ surah })).not.toThrow();
    });

    it.each([
      ['missing', {}],
      ['empty', { surah: '' }],
      ['zero', { surah: '0' }],
      ['beyond the last surah', { surah: '115' }],
      ['fractional', { surah: '2.5' }],
      ['not a number', { surah: 'fatiha' }],
      ['a non-scalar', { surah: ['1'] }],
    ])('rejects a %s surah', (_case, body) => {
      expect(() => parse(body)).toThrow(BadRequestException);
    });
  });

  describe('ayah range', () => {
    it('treats an omitted range as the whole surah', () => {
      expect(parse({ surah: '1' })).toMatchObject({
        ayahStart: null,
        ayahEnd: null,
      });
    });

    it('treats blank range fields as omitted', () => {
      expect(parse({ surah: '1', ayahStart: '', ayahEnd: '' })).toMatchObject({
        ayahStart: null,
        ayahEnd: null,
      });
    });

    it('accepts a single-ayah range', () => {
      expect(
        parse({ surah: '2', ayahStart: '255', ayahEnd: '255' }),
      ).toMatchObject({
        ayahStart: 255,
        ayahEnd: 255,
      });
    });

    it.each([
      ['only a start', { ayahStart: '3' }],
      ['only an end', { ayahEnd: '7' }],
    ])('rejects a half-specified range (%s)', (_case, range) => {
      expect(() => parse({ surah: '1', ...range })).toThrow(
        /both ayahStart and ayahEnd/,
      );
    });

    it('rejects a range that ends before it starts', () => {
      expect(() => parse({ surah: '1', ayahStart: '5', ayahEnd: '2' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects ayah zero', () => {
      expect(() => parse({ surah: '1', ayahStart: '0', ayahEnd: '3' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('title', () => {
    it('trims the provided title', () => {
      expect(
        parse({ surah: '1', title: '  Mishary - Al-Fatiha  ' }).title,
      ).toBe('Mishary - Al-Fatiha');
    });

    it('falls back to the filename without its extension', () => {
      expect(
        parse({ surah: '1', title: '   ' }, 'sudais.fatiha.mp3').title,
      ).toBe('sudais.fatiha');
    });

    it('keeps a dotfile-style name intact rather than producing an empty title', () => {
      expect(parse({ surah: '1' }, '.mp3').title).toBe('.mp3');
    });

    it('caps the title length', () => {
      expect(parse({ surah: '1', title: 'x'.repeat(500) }).title).toHaveLength(
        120,
      );
    });
  });
});
