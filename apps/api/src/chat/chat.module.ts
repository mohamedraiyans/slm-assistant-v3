import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { FaqModule } from '../faq/faq.module';
import { ProvidersModule } from '../providers/providers.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { MemoryService } from './memory.service';
import { ProviderFactory } from './provider-factory.service';

@Module({
  imports: [DocumentsModule, ProvidersModule, FaqModule],
  controllers: [ChatController],
  providers: [ChatService, MemoryService, ProviderFactory],
})
export class ChatModule {}
