import { Injectable } from '@nestjs/common';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * In-memory per-user conversation history. Intentionally not persisted —
 * ported 1:1 from v2's MemoryService; extend with a DB backend if
 * multi-session history is needed later.
 */
@Injectable()
export class MemoryService {
  private history = new Map<string, ChatMessage[]>();

  save(userId: string, role: ChatMessage['role'], content: string): void {
    const messages = this.history.get(userId) ?? [];
    messages.push({ role, content });
    this.history.set(userId, messages);
  }

  getAll(userId: string): ChatMessage[] {
    return [...(this.history.get(userId) ?? [])];
  }

  clear(userId: string): void {
    this.history.delete(userId);
  }
}
