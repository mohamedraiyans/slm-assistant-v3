import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module';
import { RecitationController } from './recitation.controller';
import { RecitationService } from './recitation.service';

@Module({
  imports: [FeaturesModule],
  controllers: [RecitationController],
  providers: [RecitationService],
})
export class RecitationModule {}
