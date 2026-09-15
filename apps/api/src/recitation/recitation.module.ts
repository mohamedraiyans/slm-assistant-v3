import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features/features.module';
import { RECITATION_QUEUE } from './recitation-queue';
import { RecitationController } from './recitation.controller';
import { RecitationProcessor } from './recitation.processor';
import { RecitationService } from './recitation.service';
import { SpeechClient } from './speech-client.service';

@Module({
  imports: [
    FeaturesModule,
    BullModule.registerQueue({ name: RECITATION_QUEUE }),
  ],
  controllers: [RecitationController],
  providers: [RecitationService, RecitationProcessor, SpeechClient],
})
export class RecitationModule {}
