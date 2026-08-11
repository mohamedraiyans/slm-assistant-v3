import { Module } from '@nestjs/common';
import { FaqModule } from '../faq/faq.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  imports: [FaqModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, VectorStoreService],
  exports: [VectorStoreService],
})
export class DocumentsModule {}
