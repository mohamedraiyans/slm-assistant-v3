export interface Chunk {
  id: string;
  filename: string;
  text: string;
  index: number;
}

/**
 * Splits text along line boundaries so distinct facts (e.g. one line per
 * FAQ answer) don't get blended into a single diluted embedding. A line
 * longer than chunkSize words is further split with a word-based sliding
 * window. Ported from v2's DocumentChunker for identical retrieval behavior.
 */
export function chunkDocument(
  filename: string,
  text: string,
  chunkSize = 150,
  overlap = 30,
): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const words = line.split(/\s+/);
    if (words.length <= chunkSize) {
      chunks.push({ id: `${filename}::${index}`, filename, text: line, index });
      index += 1;
      continue;
    }

    let start = 0;
    while (start < words.length) {
      const end = start + chunkSize;
      const chunkText = words.slice(start, end).join(' ');
      chunks.push({ id: `${filename}::${index}`, filename, text: chunkText, index });
      index += 1;
      if (end >= words.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
