import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RecitationWordMatch } from '@slm/shared-types';

export interface AlignReferenceRequest {
  storedName: string;
  surah: number;
  ayahStart: number | null;
  ayahEnd: number | null;
}

export interface AlignedWord {
  ayah: number;
  position: number;
  text: string;
  start: number;
  end: number;
  match: RecitationWordMatch;
  heard: string | null;
  estimated: boolean;
}

export interface AlignReferenceResponse {
  modelId: string;
  modelRevision: string;
  durationSec: number;
  processingSec: number;
  matchRate: number;
  insertedCount: number;
  transcript: string;
  words: AlignedWord[];
}

/**
 * `retryable` separates "try again later" (service down, overloaded, timed out) from
 * "this input will never work" (bad range, missing file), so the queue doesn't spend
 * its retries on a request that is guaranteed to fail the same way.
 */
export class SpeechServiceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SpeechServiceError';
  }
}

export interface CheckAttemptRequest {
  audio: Buffer;
  mimeType: string;
  extension: string;
  surah: number;
  ayah: number;
}

export interface CheckAttemptResponse {
  surah: number;
  ayah: number;
  processingSec: number;
  transcript: string;
  words: {
    position: number;
    text: string;
    match: RecitationWordMatch;
    heard: string | null;
  }[];
  extraWords: string[];
}

// Transcription runs at a fraction of real time on CPU, so a whole long surah can
// legitimately take many minutes.
const ALIGN_TIMEOUT_MS = 60 * 60 * 1000;
// One ayah decodes in seconds, but the service handles one recording at a time, so a
// check can wait behind a reference that is still being processed.
const ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000;

function detailOf(body: unknown): string | undefined {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors: [{ loc, msg, ... }]
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d as { msg?: unknown }).msg)
      .filter((msg): msg is string => typeof msg === 'string')
      .join('; ');
  }
  return undefined;
}

@Injectable()
export class SpeechClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('SPEECH_SERVICE_URL') ?? 'http://localhost:8001'
    ).replace(/\/+$/, '');
  }

  alignReference(
    request: AlignReferenceRequest,
  ): Promise<AlignReferenceResponse> {
    return this.post<AlignReferenceResponse>(
      '/v1/references/align',
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      },
      ALIGN_TIMEOUT_MS,
    );
  }

  /** Checks a recording of one ayah. The audio is forwarded, never stored. */
  checkAttempt(request: CheckAttemptRequest): Promise<CheckAttemptResponse> {
    const form = new FormData();
    form.append(
      'audio',
      // Copied into a plain ArrayBuffer-backed view: a Node Buffer may sit on a
      // SharedArrayBuffer, which Blob does not accept. At most 10 MB.
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
      `attempt.${request.extension}`,
    );
    form.append('surah', String(request.surah));
    form.append('ayah', String(request.ayah));
    return this.post<CheckAttemptResponse>(
      '/v1/attempts/check',
      { body: form },
      ATTEMPT_TIMEOUT_MS,
    );
  }

  private async post<T>(
    path: string,
    init: Pick<RequestInit, 'headers' | 'body'>,
    timeoutMs: number,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new SpeechServiceError(
        `Speech service unreachable at ${this.baseUrl}: ${(error as Error).message}`,
        true,
      );
    }

    if (response.ok) return (await response.json()) as T;

    const body: unknown = await response.json().catch(() => null);
    const detail = detailOf(body) ?? response.statusText;
    // 408/429 and 5xx are transient; any other 4xx means this request is wrong.
    const retryable =
      response.status >= 500 ||
      response.status === 408 ||
      response.status === 429;
    throw new SpeechServiceError(
      `Speech service returned ${response.status}: ${detail}`,
      retryable,
      response.status,
    );
  }
}
