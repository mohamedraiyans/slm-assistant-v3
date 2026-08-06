import { extname } from 'node:path';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';

export const SUPPORTED_EXTENSIONS = new Set(['.txt', '.pdf', '.docx']);

export async function extractText(filename: string, buffer: Buffer): Promise<string> {
  const suffix = extname(filename).toLowerCase();

  if (suffix === '.txt') {
    return buffer.toString('utf-8').trim();
  }

  if (suffix === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  if (suffix === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  throw new Error(`Unsupported file type: ${suffix}`);
}
