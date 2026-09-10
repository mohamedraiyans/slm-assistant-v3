export interface Chunk {
  id: string;
  filename: string;
  text: string;
  index: number;
}

const TARGET_WORDS = 70;
const OVERLAP_WORDS = 20;
const HEADING_MAX_WORDS = 4;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * A short, unpunctuated line such as "Education" or "Technical Skills" — i.e. the
 * start of a section rather than a fact in its own right. Lines containing a colon
 * ("Location: Kungsgatan 12") are excluded, since key-per-line files use that shape
 * for actual content.
 */
function isHeading(line: string): boolean {
  if (countWords(line) > HEADING_MAX_WORDS) return false;
  if (line.includes(':')) return false;
  return !/[.,;]$/.test(line);
}

/** Breaks a single over-long line (a PDF paragraph with no line breaks) into overlapping word windows. */
function splitLongLine(line: string, targetWords: number): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  // Guarantees forward progress even if targetWords is smaller than the overlap.
  const step = Math.max(1, targetWords - OVERLAP_WORDS);
  const pieces: string[] = [];

  for (let start = 0; start < words.length; start += step) {
    pieces.push(words.slice(start, start + targetWords).join(' '));
    if (start + targetWords >= words.length) break;
  }
  return pieces;
}

/** Trailing lines of a group, capped by word count so the carried context can't rival the chunk itself. */
function trailingContext(lines: string[], maxWords: number): string[] {
  const tail: string[] = [];
  let words = 0;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const lineWords = countWords(lines[i]);
    if (words + lineWords > maxWords) break;
    tail.unshift(lines[i]);
    words += lineWords;
  }
  return tail;
}

/**
 * Groups consecutive lines into chunks of roughly `targetWords`, starting a new
 * chunk at each section heading.
 *
 * The previous version made every line its own chunk, which worked for
 * key-per-line files but broke structured documents: a résumé's "Education"
 * heading became a contentless chunk that still ranked highly on topic words,
 * while the entries beneath it were separate, context-free lines competing
 * individually for a top-k slot — so "list the universities" could retrieve the
 * heading and one university while the other ranked far below the cutoff.
 */
export function chunkDocument(
  filename: string,
  text: string,
  targetWords = TARGET_WORDS,
  overlapWords = OVERLAP_WORDS,
): Chunk[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) =>
      countWords(line) <= targetWords ? [line] : splitLongLine(line, targetWords),
    );

  const groups: string[][] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const line of lines) {
    const words = countWords(line);
    const startsSection = isHeading(line) && current.length > 0;
    const exceedsBudget = current.length > 0 && currentWords + words > targetWords;

    if (startsSection || exceedsBudget) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
    current.push(line);
    currentWords += words;
  }
  if (current.length > 0) groups.push(current);

  // A heading immediately followed by another heading (or trailing at the end of
  // the file) would otherwise become a chunk with no body — attach it to the
  // section it introduces instead.
  const sections: string[][] = [];
  let pendingHeadings: string[] = [];
  for (const group of groups) {
    if (group.length === 1 && isHeading(group[0])) {
      pendingHeadings = [...pendingHeadings, ...group];
      continue;
    }
    sections.push(pendingHeadings.length > 0 ? [...pendingHeadings, ...group] : group);
    pendingHeadings = [];
  }
  if (pendingHeadings.length > 0) {
    if (sections.length > 0) sections[sections.length - 1].push(...pendingHeadings);
    else sections.push(pendingHeadings);
  }

  // Carry a bounded tail of the previous section forward so meaning that straddles
  // a boundary survives — capped by words, since a "line" may itself be a full
  // window split out of a long paragraph.
  return sections.map((section, index) => {
    const withOverlap =
      index > 0 && overlapWords > 0
        ? [...trailingContext(sections[index - 1], overlapWords), ...section]
        : section;

    return {
      id: `${filename}::${index}`,
      filename,
      text: withOverlap.join('\n'),
      index,
    };
  });
}
