import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { VectorStoreService } from './vector-store.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, VectorStoreService],
  exports: [VectorStoreService],
})
export class DocumentsModule {}
