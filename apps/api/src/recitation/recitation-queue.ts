import type { JobsOptions } from 'bullmq';

export const RECITATION_QUEUE = 'recitation-processing';
export const ALIGN_JOB = 'align-reference';

export interface AlignJobData {
  referenceId: string;
}

/**
 * Below this share of canonical words recognised, the recording almost certainly isn't
 * the surah or range it was tagged with (or is too noisy to use), so its timings
 * can't be trusted as ground truth.
 */
export const MIN_MATCH_RATE = 0.5;

export const ALIGN_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 15_000 },
  // Results live in Postgres, so finished jobs aren't needed; removing them also
  // frees the deterministic job id for a later reprocess.
  removeOnComplete: true,
  removeOnFail: true,
};

/** One job per reference: re-adding while one is queued or running is a no-op. */
export function alignJobId(referenceId: string): string {
  return `align-${referenceId}`;
}
