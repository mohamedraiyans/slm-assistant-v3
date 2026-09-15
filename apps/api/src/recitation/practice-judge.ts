import type {
  PracticeAttemptResult,
  PracticeVerdict,
  RecitationWordMatch,
  RecitationWordTiming,
} from '@slm/shared-types';

export interface CheckedAttemptWord {
  position: number;
  match: RecitationWordMatch;
  heard: string | null;
}

const RECOGNISED: ReadonlySet<RecitationWordMatch> = new Set([
  'EXACT',
  'FUZZY',
]);

/**
 * Decides which words of a practice attempt count as the reciter's mistakes.
 *
 * The recognizer isn't perfect: on a professional recitation of Al-Fatiha it still
 * misheard two words. Correcting someone for a word they recited perfectly is worse
 * than not correcting at all, so a miss only counts as a mistake on a word the model
 * got right in the reference recording. Where the model failed there too, the word
 * is reported as unchecked instead.
 */
export function judgeAttempt(
  ayah: number,
  reference: RecitationWordTiming[],
  attempt: CheckedAttemptWord[],
  extraWords: string[],
): PracticeAttemptResult {
  const byPosition = new Map(attempt.map((word) => [word.position, word]));
  if (
    reference.length !== attempt.length ||
    reference.some((w) => !byPosition.has(w.position))
  ) {
    // Both sides come from the same canonical text; a mismatch means the speech
    // service and the stored timings disagree about the ayah, so no verdict is safe.
    throw new Error(
      `Ayah ${ayah}: reference has ${reference.length} words but the attempt was checked against ${attempt.length}`,
    );
  }

  const words = reference.map((ref) => {
    const checked = byPosition.get(ref.position)!;
    const verdict: PracticeVerdict = RECOGNISED.has(checked.match)
      ? 'CORRECT'
      : RECOGNISED.has(ref.match)
        ? 'MISTAKE'
        : 'UNCHECKED';
    return {
      position: ref.position,
      text: ref.text,
      verdict,
      heard: checked.heard,
      startSec: ref.startSec,
      endSec: ref.endSec,
    };
  });

  return {
    ayah,
    passed: words.every((word) => word.verdict !== 'MISTAKE'),
    words,
    extraWords,
  };
}
