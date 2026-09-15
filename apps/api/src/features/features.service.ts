import { Injectable, NotFoundException } from '@nestjs/common';
import type { FeatureKey, FeatureState } from '@slm/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { FEATURE_REGISTRY, isFeatureKey } from './feature-registry';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: FeatureKey): Promise<boolean> {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    return flag?.enabled ?? FEATURE_REGISTRY[key].defaultEnabled;
  }

  async list(): Promise<FeatureState[]> {
    const overrides = await this.prisma.featureFlag.findMany();
    const enabledByKey = new Map(
      overrides.map((flag) => [flag.key, flag.enabled]),
    );

    return (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).map((key) => {
      const { label, description, defaultEnabled } = FEATURE_REGISTRY[key];
      return {
        key,
        label,
        description,
        enabled: enabledByKey.get(key) ?? defaultEnabled,
      };
    });
  }

  async setEnabled(
    key: string,
    enabled: boolean,
    userId: string,
  ): Promise<FeatureState> {
    if (!isFeatureKey(key))
      throw new NotFoundException(`Unknown feature "${key}"`);

    await this.prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, updatedBy: userId },
      update: { enabled, updatedBy: userId },
    });
    const { label, description } = FEATURE_REGISTRY[key];
    return { key, label, description, enabled };
  }
}
