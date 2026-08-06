import { BadRequestException, Injectable } from '@nestjs/common';
import type { ProviderCredentialPublic, ProviderName } from '@slm/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from './encryption.service';

const VALID_PROVIDERS: ProviderName[] = ['GROQ', 'AZURE_OPENAI', 'ANTHROPIC'];

export interface CreateProviderCredentialInput {
  provider: ProviderName;
  label: string;
  value: string;
  extraConfig?: Record<string, unknown>;
}

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  async create(input: CreateProviderCredentialInput, createdBy: string): Promise<ProviderCredentialPublic> {
    if (!VALID_PROVIDERS.includes(input.provider)) {
      throw new BadRequestException(`Unknown provider "${input.provider}"`);
    }
    if (!input.label?.trim() || !input.value?.trim()) {
      throw new BadRequestException('label and value are required');
    }

    const credential = await this.prisma.providerCredential.create({
      data: {
        provider: input.provider,
        label: input.label.trim(),
        encryptedValue: this.encryption.encrypt(input.value),
        extraConfig: (input.extraConfig ?? undefined) as never,
        createdBy,
      },
    });
    return this.toPublic(credential);
  }

  async findAll(): Promise<ProviderCredentialPublic[]> {
    const credentials = await this.prisma.providerCredential.findMany({ orderBy: { createdAt: 'desc' } });
    return credentials.map((credential) => this.toPublic(credential));
  }

  async findActiveProviderNames(): Promise<ProviderName[]> {
    const credentials = await this.prisma.providerCredential.findMany({
      where: { isActive: true },
      select: { provider: true },
      distinct: ['provider'],
    });
    return credentials.map((c) => c.provider as ProviderName);
  }

  async remove(id: string): Promise<void> {
    await this.prisma.providerCredential.delete({ where: { id } });
  }

  async getDecryptedActiveCredential(
    provider: ProviderName,
  ): Promise<{ apiKey: string; extraConfig: Record<string, unknown> | null } | null> {
    const credential = await this.prisma.providerCredential.findFirst({
      where: { provider, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!credential) return null;
    return {
      apiKey: this.encryption.decrypt(credential.encryptedValue),
      extraConfig: (credential.extraConfig as Record<string, unknown> | null) ?? null,
    };
  }

  private toPublic(credential: {
    id: string;
    provider: string;
    label: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ProviderCredentialPublic {
    return {
      id: credential.id,
      provider: credential.provider as ProviderName,
      label: credential.label,
      isActive: credential.isActive,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString(),
    };
  }
}
