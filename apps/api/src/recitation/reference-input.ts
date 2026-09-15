import { BadRequestException } from '@nestjs/common';

export const SURAH_COUNT = 114;
const TITLE_MAX_LENGTH = 120;

export interface ReferenceInput {
  title: string;
  surah: number;
  ayahStart: number | null;
  ayahEnd: number | null;
}

/** Multipart fields always arrive as strings; empty or missing means "not given". */
function optionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : NaN;
  if (!Number.isInteger(parsed))
    throw new BadRequestException(`${field} must be a whole number`);
  return parsed;
}

function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * Validates the metadata sent alongside a reference recording. Per-surah ayah counts
 * are checked later, once the canonical text is loaded; here we reject only what is
 * wrong for any surah.
 */
export function parseReferenceInput(
  body: Record<string, unknown>,
  originalName: string,
): ReferenceInput {
  const surah = optionalInt(body.surah, 'surah');
  if (surah === null || surah < 1 || surah > SURAH_COUNT) {
    throw new BadRequestException(`surah must be between 1 and ${SURAH_COUNT}`);
  }

  const ayahStart = optionalInt(body.ayahStart, 'ayahStart');
  const ayahEnd = optionalInt(body.ayahEnd, 'ayahEnd');
  if ((ayahStart === null) !== (ayahEnd === null)) {
    throw new BadRequestException(
      'Give both ayahStart and ayahEnd, or neither for the whole surah',
    );
  }
  if (
    ayahStart !== null &&
    ayahEnd !== null &&
    (ayahStart < 1 || ayahEnd < ayahStart)
  ) {
    throw new BadRequestException(
      'Ayah range must start at 1 or later and not end before it starts',
    );
  }

  const rawTitle = typeof body.title === 'string' ? body.title.trim() : '';
  const title = (rawTitle || stripExtension(originalName)).slice(
    0,
    TITLE_MAX_LENGTH,
  );

  return { title, surah, ayahStart, ayahEnd };
}
