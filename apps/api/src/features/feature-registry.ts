import type { FeatureKey } from '@slm/shared-types';

export interface FeatureDefinition {
  label: string;
  description: string;
  /** Applies until an admin toggles the feature for the first time. */
  defaultEnabled: boolean;
}

/**
 * Every optional feature the app knows about. Flags live in code rather than being
 * free-form rows, so a typo'd key fails to compile instead of silently creating a
 * flag nothing reads — the database only stores an admin's override.
 */
export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDefinition> = {
  recitation: {
    label: 'Recitation practice',
    description:
      'Upload reference recitations and get corrected while reciting.',
    defaultEnabled: false,
  },
};

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.hasOwn(FEATURE_REGISTRY, value);
}
