import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService, EncryptionService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
