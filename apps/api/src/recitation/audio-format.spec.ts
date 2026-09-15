import { detectAudioFormat } from './audio-format';

const bytes = (...values: number[]) => Buffer.from(values);
const withAscii = (offset: number, text: string, length = 16) => {
  const buffer = Buffer.alloc(length);
  buffer.write(text, offset, 'latin1');
  return buffer;
};

describe('detectAudioFormat', () => {
  it.each([
    ['MP3 with an ID3v2 tag', withAscii(0, 'ID3'), 'mp3', 'audio/mpeg'],
    [
      'WAV',
      Buffer.concat([withAscii(0, 'RIFF', 8), withAscii(0, 'WAVE', 8)]),
      'wav',
      'audio/wav',
    ],
    ['FLAC', withAscii(0, 'fLaC'), 'flac', 'audio/flac'],
    ['OGG (Vorbis/Opus)', withAscii(0, 'OggS'), 'ogg', 'audio/ogg'],
    ['M4A (ftyp box at offset 4)', withAscii(4, 'ftyp'), 'm4a', 'audio/mp4'],
    [
      'WebM (EBML header)',
      bytes(0x1a, 0x45, 0xdf, 0xa3, 0),
      'webm',
      'audio/webm',
    ],
  ])('recognises %s', (_name, input, extension, mimeType) => {
    expect(detectAudioFormat(input)).toEqual({ extension, mimeType });
  });

  describe('bare MPEG frame sync (no container header)', () => {
    it('treats MPEG-1 Layer III as MP3', () => {
      expect(detectAudioFormat(bytes(0xff, 0xfb, 0x90, 0x00))?.extension).toBe(
        'mp3',
      );
    });

    it('treats MPEG-2 Layer III as MP3', () => {
      expect(detectAudioFormat(bytes(0xff, 0xf3, 0x90, 0x00))?.extension).toBe(
        'mp3',
      );
    });

    it('treats ADTS (layer bits 00) as AAC rather than MP3', () => {
      expect(detectAudioFormat(bytes(0xff, 0xf1, 0x50, 0x80))?.extension).toBe(
        'aac',
      );
    });

    it('rejects the reserved MPEG version even though the sync bits match', () => {
      expect(detectAudioFormat(bytes(0xff, 0xeb, 0x90, 0x00))).toBeNull();
    });
  });

  it('judges by content, not by what the file claims to be', () => {
    // A PDF renamed to .mp3 still starts with %PDF.
    expect(detectAudioFormat(withAscii(0, '%PDF-1.7'))).toBeNull();
  });

  it('requires both halves of the RIFF/WAVE header', () => {
    // RIFF alone is also AVI and WebP.
    expect(
      detectAudioFormat(
        Buffer.concat([withAscii(0, 'RIFF', 8), withAscii(0, 'AVI ', 8)]),
      ),
    ).toBeNull();
  });

  it.each([
    ['an empty buffer', Buffer.alloc(0)],
    ['a single byte', bytes(0xff)],
    ['a truncated magic number', withAscii(0, 'fLa', 3)],
  ])('returns null for %s instead of reading out of bounds', (_name, input) => {
    expect(detectAudioFormat(input)).toBeNull();
  });
});
