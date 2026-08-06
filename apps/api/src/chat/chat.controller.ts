import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { ProviderName } from '@slm/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { RequestUser } from '../auth/types';
import { ChatService } from './chat.service';
import { MemoryService } from './memory.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly memoryService: MemoryService,
  ) {}

  @Post()
  async chat(
    @Body() body: { message: string; provider?: ProviderName },
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.chatService.handleChat(user.id, body.message, body.provider ?? 'GROQ');
    return { response: result.answer, sources: result.sources };
  }

  @Get('history')
  history(@CurrentUser() user: RequestUser) {
    return { history: this.memoryService.getAll(user.id) };
  }

  @Post('history/clear')
  clearHistory(@CurrentUser() user: RequestUser) {
    this.memoryService.clear(user.id);
    return { message: 'History cleared' };
  }
}
