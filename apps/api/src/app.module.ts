import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '..', '..', '.env'),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    ChatModule,
    QuizModule,
    ProvidersModule,
    EvalModule,
  ],
})
export class AppModule {}
