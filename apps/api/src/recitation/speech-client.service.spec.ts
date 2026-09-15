import type { ConfigService } from '@nestjs/config';
import { SpeechClient, SpeechServiceError } from './speech-client.service';

const REQUEST = {
  storedName: '0b0e7a5c-1111-4222-8333-944455556666.mp3',
  surah: 1,
  ayahStart: null,
  ayahEnd: null,
};

function client(url?: string) {
  const config = { get: jest.fn().mockReturnValue(url) };
  return new SpeechClient(config as unknown as ConfigService);
}

function respond(status: number, body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

async function errorFrom(
  promise: Promise<unknown>,
): Promise<SpeechServiceError> {
  try {
    await promise;
  } catch (error) {
    return error as SpeechServiceError;
  }
  throw new Error('expected the request to fail');
}

afterEach(() => jest.restoreAllMocks());

describe('SpeechClient', () => {
  it('posts the request as JSON to the configured service', async () => {
    const fetchSpy = respond(200, { words: [] });
    await client('http://speech:8000/').alignReference(REQUEST);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://speech:8000/v1/references/align');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(REQUEST);
  });

  it('defaults to the local docker-compose port', async () => {
    const fetchSpy = respond(200, { words: [] });
    await client(undefined).alignReference(REQUEST);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      'http://localhost:8001/v1/references/align',
    );
  });

  it('applies a timeout so a hung service cannot stall the queue forever', async () => {
    const fetchSpy = respond(200, { words: [] });
    await client().alignReference(REQUEST);
    expect(fetchSpy.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns the parsed body on success', async () => {
    respond(200, { matchRate: 0.9, words: [] });
    await expect(client().alignReference(REQUEST)).resolves.toEqual({
      matchRate: 0.9,
      words: [],
    });
  });

  it('treats an unreachable service as retryable', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    const error = await errorFrom(client().alignReference(REQUEST));

    expect(error).toBeInstanceOf(SpeechServiceError);
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/unreachable/);
  });

  it.each([500, 502, 503, 408, 429])(
    'treats HTTP %i as retryable',
    async (status) => {
      respond(status, { detail: 'busy' });
      expect(
        (await errorFrom(client().alignReference(REQUEST))).retryable,
      ).toBe(true);
    },
  );

  it.each([400, 404, 422])('treats HTTP %i as permanent', async (status) => {
    respond(status, { detail: 'nope' });
    const error = await errorFrom(client().alignReference(REQUEST));
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(status);
  });

  it('surfaces the service detail message', async () => {
    respond(422, {
      detail: 'ayah range 1-8 is outside surah 1, which has 7 ayahs',
    });
    expect(
      (await errorFrom(client().alignReference(REQUEST))).message,
    ).toContain('ayah range 1-8 is outside surah 1, which has 7 ayahs');
  });

  it('flattens FastAPI validation errors into a readable message', async () => {
    respond(422, {
      detail: [
        {
          loc: ['body', 'surah'],
          msg: 'Input should be less than or equal to 114',
        },
        {
          loc: ['body', 'ayahStart'],
          msg: 'Input should be greater than or equal to 1',
        },
      ],
    });
    expect(
      (await errorFrom(client().alignReference(REQUEST))).message,
    ).toContain(
      'Input should be less than or equal to 114; Input should be greater than or equal to 1',
    );
  });

  it('copes with a non-JSON error body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    );
    const error = await errorFrom(client().alignReference(REQUEST));
    expect(error.message).toContain('502');
    expect(error.retryable).toBe(true);
  });
});
