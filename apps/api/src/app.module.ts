import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DocumentsModule } from './documents/documents.module';
import { ChatModule } from './chat/chat.module';
import { QuizModule } from './quiz/quiz.module';
import { ProvidersModule } from './providers/providers.module';
import { EvalModule } from './eval/eval.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { FaqModule } from './faq/faq.module';
import { FeaturesModule } from './features/features.module';
import { RecitationModule } from './recitation/recitation.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '..', '..', '.env'),
    }),
    RedisModule,
    // Background jobs share the Redis instance used by the FAQ cache, resolved from the
    // same REDIS_URL (BullMQ hands the url straight to ioredis, as RedisModule does).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        },
      }),
    }),
    FaqModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    ChatModule,
    QuizModule,
    ProvidersModule,
    EvalModule,
    FeaturesModule,
    RecitationModule,
  ],
})
export class AppModule {}
