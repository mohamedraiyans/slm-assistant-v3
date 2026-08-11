import { Injectable, NotFoundException } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatGroq } from '@langchain/groq';
import { AzureChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { ProviderName } from '@slm/shared-types';
import { ProviderUsageService } from '../providers/provider-usage.service';
import { ProvidersService } from '../providers/providers.service';

@Injectable()
export class ProviderFactory {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly providerUsage: ProviderUsageService,
  ) {}

  /**
   * Wraps global fetch so every real call to a provider's API also records
   * its rate-limit headers, without LangChain's own invoke() surfacing them.
   */
  private usageTrackingFetch(provider: ProviderName): typeof fetch {
    return async (...args: Parameters<typeof fetch>) => {
      const response = await globalThis.fetch(...args);
      this.providerUsage.record(provider, response.headers);
      return response;
    };
  }

  async build(provider: ProviderName): Promise<BaseChatModel> {
    const credential = await this.providersService.getDecryptedActiveCredential(provider);
    if (!credential) {
      throw new NotFoundException(
        `No active ${provider} key configured. An admin needs to add one under Provider Keys.`,
      );
    }

    switch (provider) {
      case 'GROQ':
        return new ChatGroq({
          apiKey: credential.apiKey,
          model: (credential.extraConfig?.model as string) ?? 'llama-3.3-70b-versatile',
          temperature: 0.3,
          maxTokens: 512,
          fetch: this.usageTrackingFetch(provider),
        });
      case 'AZURE_OPENAI':
        return new AzureChatOpenAI({
          azureOpenAIApiKey: credential.apiKey,
          azureOpenAIApiInstanceName: credential.extraConfig?.instanceName as string,
          azureOpenAIApiDeploymentName: credential.extraConfig?.deploymentName as string,
          azureOpenAIApiVersion: (credential.extraConfig?.apiVersion as string) ?? '2024-10-21',
          temperature: 0.3,
          maxTokens: 512,
          configuration: { fetch: this.usageTrackingFetch(provider) },
        });
      case 'ANTHROPIC':
        return new ChatAnthropic({
          apiKey: credential.apiKey,
          model: (credential.extraConfig?.model as string) ?? 'claude-3-5-haiku-latest',
          temperature: 0.3,
          maxTokens: 512,
          clientOptions: { fetch: this.usageTrackingFetch(provider) },
        });
      default:
        throw new NotFoundException(`Unknown provider "${provider}"`);
    }
  }
}
