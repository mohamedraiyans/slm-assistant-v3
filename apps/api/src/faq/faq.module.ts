import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { FaqService } from './faq.service';

@Module({
  imports: [RedisModule],
  providers: [FaqService],
  exports: [FaqService],
})
export class FaqModule {}
