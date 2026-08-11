import { Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { ProviderUsageService } from './provider-usage.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService, EncryptionService, ProviderUsageService],
  exports: [ProvidersService, ProviderUsageService],
})
export class ProvidersModule {}
