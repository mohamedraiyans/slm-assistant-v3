export interface AudioFormat {
  extension: string;
  mimeType: string;
}

const MP3: AudioFormat = { extension: 'mp3', mimeType: 'audio/mpeg' };
const AAC: AudioFormat = { extension: 'aac', mimeType: 'audio/aac' };
const WAV: AudioFormat = { extension: 'wav', mimeType: 'audio/wav' };
const FLAC: AudioFormat = { extension: 'flac', mimeType: 'audio/flac' };
const OGG: AudioFormat = { extension: 'ogg', mimeType: 'audio/ogg' };
const M4A: AudioFormat = { extension: 'm4a', mimeType: 'audio/mp4' };
const WEBM: AudioFormat = { extension: 'webm', mimeType: 'audio/webm' };

export const SUPPORTED_AUDIO_LABEL = 'MP3, AAC, WAV, FLAC, OGG/Opus, M4A, WebM';

function ascii(bytes: Buffer, offset: number, text: string): boolean {
  return (
    bytes.length >= offset + text.length &&
    bytes.toString('latin1', offset, offset + text.length) === text
  );
}

/**
 * Identifies an audio container from its leading bytes. Both the file extension and
 * the browser-supplied MIME type are client-controlled, so neither is trusted: the
 * stored extension and the Content-Type served back are derived from this instead.
 * Returns null for anything unrecognised.
 */
export function detectAudioFormat(bytes: Buffer): AudioFormat | null {
  if (ascii(bytes, 0, 'ID3')) return MP3; // MP3 with an ID3v2 tag
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return WAV;
  if (ascii(bytes, 0, 'fLaC')) return FLAC;
  if (ascii(bytes, 0, 'OggS')) return OGG;
  if (ascii(bytes, 4, 'ftyp')) return M4A;
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3) return WEBM; // EBML header

  // Untagged MPEG streams start with an 11-bit frame sync. The two "layer" bits then
  // separate MPEG audio (layers I-III, non-zero) from ADTS AAC (always 00).
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    const layer = (bytes[1] >> 1) & 0b11;
    const version = (bytes[1] >> 3) & 0b11;
    if (layer !== 0 && version !== 0b01) return MP3; // 0b01 is a reserved version
    if (layer === 0 && (bytes[1] & 0xf6) === 0xf0) return AAC;
  }
  return null;
}
