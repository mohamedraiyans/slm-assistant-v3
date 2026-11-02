import { Module } from '@nestjs/common';
import { ProviderFactory } from '../chat/provider-factory.service';
import { ProvidersModule } from '../providers/providers.module';
import { GraphController } from './graph.controller';
import { GraphExtractorService } from './graph-extractor.service';
import { GraphService } from './graph.service';

@Module({
  imports: [ProvidersModule],
  controllers: [GraphController],
  // ProviderFactory is stateless, so GraphModule gets its own instance rather than
  // importing ChatModule (which would be circular via DocumentsModule).
  providers: [GraphService, GraphExtractorService, ProviderFactory],
  exports: [GraphService, GraphExtractorService],
})
export class GraphModule {}
