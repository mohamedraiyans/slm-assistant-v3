import type {
  RecitationWordMatch,
  RecitationWordTiming,
} from '@slm/shared-types';
import { type CheckedAttemptWord, judgeAttempt } from './practice-judge';

function reference(...matches: RecitationWordMatch[]): RecitationWordTiming[] {
  return matches.map((match, i) => ({
    ayah: 2,
    position: i + 1,
    text: `word-${i + 1}`,
    startSec: i,
    endSec: i + 0.8,
    match,
    estimated: match === 'MISSING',
  }));
}

function attempt(...matches: RecitationWordMatch[]): CheckedAttemptWord[] {
  return matches.map((match, i) => ({
    position: i + 1,
    match,
    heard: match === 'MISSING' ? null : `heard-${i + 1}`,
  }));
}

describe('judgeAttempt', () => {
  it('passes a recitation where every word was recognised', () => {
    const result = judgeAttempt(
      2,
      reference('EXACT', 'EXACT', 'FUZZY'),
      attempt('EXACT', 'FUZZY', 'EXACT'),
      [],
    );

    expect(result.passed).toBe(true);
    expect(result.words.map((w) => w.verdict)).toEqual([
      'CORRECT',
      'CORRECT',
      'CORRECT',
    ]);
  });

  it.each<RecitationWordMatch>(['MISSING', 'SUBSTITUTED'])(
    'flags a %s word the model reliably recognises as a mistake',
    (match) => {
      const result = judgeAttempt(
        2,
        reference('EXACT', 'EXACT'),
        attempt('EXACT', match),
        [],
      );

      expect(result.passed).toBe(false);
      expect(result.words[1].verdict).toBe('MISTAKE');
    },
  );

  it.each<RecitationWordMatch>(['MISSING', 'SUBSTITUTED'])(
    'does not blame the reciter for a word the model also got wrong in the reference (%s there)',
    (referenceMatch) => {
      // e.g. العالمين: misheard even in a professional recitation.
      const result = judgeAttempt(
        2,
        reference('EXACT', referenceMatch),
        attempt('EXACT', 'SUBSTITUTED'),
        [],
      );

      expect(result.words[1].verdict).toBe('UNCHECKED');
      expect(result.passed).toBe(true);
    },
  );

  it('still credits an unreliable word when it is recognised this time', () => {
    const result = judgeAttempt(
      2,
      reference('SUBSTITUTED'),
      attempt('EXACT'),
      [],
    );
    expect(result.words[0].verdict).toBe('CORRECT');
  });

  it('carries the reference timing so the correct word can be played', () => {
    const result = judgeAttempt(
      2,
      reference('EXACT', 'EXACT'),
      attempt('EXACT', 'MISSING'),
      [],
    );
    expect(result.words[1]).toMatchObject({
      text: 'word-2',
      startSec: 1,
      endSec: 1.8,
      heard: null,
    });
  });

  it('reports extra words without failing the attempt', () => {
    const result = judgeAttempt(2, reference('EXACT'), attempt('EXACT'), [
      'مالك',
    ]);
    expect(result).toMatchObject({ passed: true, extraWords: ['مالك'] });
  });

  it('matches words by position, not by array order', () => {
    const reversed = attempt('EXACT', 'MISSING').reverse();
    const result = judgeAttempt(2, reference('EXACT', 'EXACT'), reversed, []);
    expect(result.words.map((w) => w.verdict)).toEqual(['CORRECT', 'MISTAKE']);
  });

  it('refuses to judge when the two sides disagree about the ayah', () => {
    expect(() =>
      judgeAttempt(2, reference('EXACT', 'EXACT'), attempt('EXACT'), []),
    ).toThrow(/reference has 2 words but the attempt was checked against 1/);
  });
});
