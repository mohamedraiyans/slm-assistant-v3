import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { FaqService } from '../faq/faq.service';
import { PrismaService } from '../prisma/prisma.service';
import { chunkDocument } from './document-chunker';
import { extractText, SUPPORTED_EXTENSIONS } from './document-extractor';
import { VectorStoreService } from './vector-store.service';

const DOCS_DIR = join(process.cwd(), 'data', 'docs');

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vectorStore: VectorStoreService,
    private readonly faq: FaqService,
  ) {}

  async listDocuments() {
    return this.prisma.document.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async uploadDocument(rawFilename: string, buffer: Buffer, userId: string) {
    const filename = basename(rawFilename);
    const suffix = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(suffix)) {
      throw new BadRequestException(
        `Unsupported file type "${suffix}". Allowed: ${[...SUPPORTED_EXTENSIONS].join(', ')}`,
      );
    }

    await mkdir(DOCS_DIR, { recursive: true });
    const destPath = join(DOCS_DIR, filename);
    await writeFile(destPath, buffer);

    try {
      const text = await extractText(filename, buffer);
      const chunks = chunkDocument(filename, text);
      await this.vectorStore.addChunks(chunks);
      await this.faq.invalidateAll();

      return this.prisma.document.upsert({
        where: { filename },
        create: { filename, chunkCount: chunks.length, uploadedBy: userId },
        update: { chunkCount: chunks.length, uploadedBy: userId },
      });
    } catch (error) {
      await unlink(destPath).catch(() => undefined);
      throw new BadRequestException(`Could not read file: ${(error as Error).message}`);
    }
  }

  async removeDocument(rawFilename: string): Promise<void> {
    const filename = basename(rawFilename);
    const destPath = join(DOCS_DIR, filename);
    await unlink(destPath).catch(() => undefined);
    await this.vectorStore.deleteDocument(filename);
    await this.prisma.document.deleteMany({ where: { filename } });
    await this.faq.invalidateAll();
  }

  async readDocumentFile(rawFilename: string): Promise<Buffer> {
    const destPath = join(DOCS_DIR, basename(rawFilename));
    try {
      return await readFile(destPath);
    } catch {
      throw new NotFoundException('File not found');
    }
  }
}
