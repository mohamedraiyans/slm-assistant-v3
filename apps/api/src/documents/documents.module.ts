import { Module } from '@nestjs/common';
import { FaqModule } from '../faq/faq.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { KnowledgeBaseRetriever } from './knowledge-base-retriever';
import { VectorStoreService } from './vector-store.service';

@Module({
  imports: [FaqModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, VectorStoreService, KnowledgeBaseRetriever],
  exports: [VectorStoreService, KnowledgeBaseRetriever],
})
export class DocumentsModule {}
