import { Injectable } from '@nestjs/common';
import type { ProviderName, ProviderUsageSnapshot, ProviderUsageWindow } from '@slm/shared-types';

interface HeaderNames {
  limit: string;
  remaining: string;
  reset: string;
}

const EMPTY_WINDOW: ProviderUsageWindow = { limit: null, remaining: null, resetHint: null };

// Groq and Azure OpenAI both speak the OpenAI-style x-ratelimit-* header set.
const OPENAI_STYLE = {
  requests: {
    limit: 'x-ratelimit-limit-requests',
    remaining: 'x-ratelimit-remaining-requests',
    reset: 'x-ratelimit-reset-requests',
  },
  tokens: {
    limit: 'x-ratelimit-limit-tokens',
    remaining: 'x-ratelimit-remaining-tokens',
    reset: 'x-ratelimit-reset-tokens',
  },
};

const HEADER_NAMES: Record<ProviderName, { requests: HeaderNames; tokens: HeaderNames }> = {
  GROQ: OPENAI_STYLE,
  AZURE_OPENAI: OPENAI_STYLE,
  ANTHROPIC: {
    requests: {
      limit: 'anthropic-ratelimit-requests-limit',
      remaining: 'anthropic-ratelimit-requests-remaining',
      reset: 'anthropic-ratelimit-requests-reset',
    },
    tokens: {
      limit: 'anthropic-ratelimit-tokens-limit',
      remaining: 'anthropic-ratelimit-tokens-remaining',
      reset: 'anthropic-ratelimit-tokens-reset',
    },
  },
};

/**
 * Tracks the most recently observed rate-limit headers per provider, captured
 * from the actual chat responses users trigger (see ProviderFactory's fetch
 * wrapper). In-memory and per-process — fine for a single api instance, but
 * won't be shared across replicas once this runs on Kubernetes (Phase 3).
 */
@Injectable()
export class ProviderUsageService {
  private snapshots = new Map<ProviderName, ProviderUsageSnapshot>();

  record(provider: ProviderName, headers: Headers): void {
    const names = HEADER_NAMES[provider];
    const requests = this.readWindow(headers, names.requests);
    const tokens = this.readWindow(headers, names.tokens);
    if (this.isEmpty(requests) && this.isEmpty(tokens)) return;

    const existing = this.snapshots.get(provider);
    this.snapshots.set(provider, {
      provider,
      requests: this.mergeWindow(existing?.requests, requests),
      tokens: this.mergeWindow(existing?.tokens, tokens),
      updatedAt: new Date().toISOString(),
    });
  }

  getMany(providers: ProviderName[]): ProviderUsageSnapshot[] {
    return providers.map(
      (provider) =>
        this.snapshots.get(provider) ?? {
          provider,
          requests: EMPTY_WINDOW,
          tokens: EMPTY_WINDOW,
          updatedAt: null,
        },
    );
  }

  private readWindow(headers: Headers, names: HeaderNames): ProviderUsageWindow {
    const limit = headers.get(names.limit);
    const remaining = headers.get(names.remaining);
    return {
      limit: limit !== null ? Number(limit) : null,
      remaining: remaining !== null ? Number(remaining) : null,
      resetHint: headers.get(names.reset),
    };
  }

  private isEmpty(window: ProviderUsageWindow): boolean {
    return window.limit === null && window.remaining === null;
  }

  private mergeWindow(prev: ProviderUsageWindow | undefined, next: ProviderUsageWindow): ProviderUsageWindow {
    return {
      limit: next.limit ?? prev?.limit ?? null,
      remaining: next.remaining ?? prev?.remaining ?? null,
      resetHint: next.resetHint ?? prev?.resetHint ?? null,
    };
  }
}
