import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechRecognitionService } from '../src/services/speechRecognitionService';

afterEach(() => {
  speechRecognitionService.cancelListening();
  vi.unstubAllGlobals();
});

class FakeRecorder {
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

const stubBrowser = (transcribe: () => Response) => {
  const stopTrack = vi.fn();
  vi.stubGlobal('window', {});
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
  });
  vi.stubGlobal(
    'FileReader',
    class {
      result = '';
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.result = 'data:audio/webm;base64,dm9pY2U=';
        this.onload?.();
      }
    },
  );
  const fetch = vi.fn(async (url: string) =>
    url === '/api/health' ? Response.json({ sessionToken: 't', transcribeModel: 'scribe_v2' }) : transcribe(),
  );
  vi.stubGlobal('fetch', fetch);
  return { fetch, stopTrack };
};

const record = () =>
  new Promise<{ text?: string; error?: string }>((resolve) => {
    expect(
      speechRecognitionService.startListening({
        onResult: (text, isFinal) => isFinal && resolve({ text }),
        onError: (error) => resolve({ error }),
        onStateChange: (listening) => listening && speechRecognitionService.stopListening(),
      }),
    ).toBe(true);
  });

describe('dictation through the server transcription model', () => {
  it('records, uploads the clip and returns the model transcript', async () => {
    const { fetch, stopTrack } = stubBrowser(() => Response.json({ transcript: 'Keep the cup blue.' }));
    expect(await speechRecognitionService.connectBackend()).toBe('scribe_v2');
    expect(await record()).toEqual({ text: 'Keep the cup blue.' });
    const [, init] = fetch.mock.calls.find(([url]) => url === '/api/muse/transcribe')!;
    expect(JSON.parse(String(init?.body))).toEqual({ audio: 'data:audio/webm;base64,dm9pY2U=' });
    expect(init?.headers).toMatchObject({ 'X-Anchorshot-Session': 't' });
    expect(stopTrack).toHaveBeenCalled();
  });

  it('reports the server error instead of inventing text', async () => {
    stubBrowser(() => Response.json({ error: 'scribe_v2 heard no speech. Try recording again.' }, { status: 502 }));
    await speechRecognitionService.connectBackend();
    expect(await record()).toEqual({ error: 'scribe_v2 heard no speech. Try recording again.' });
  });
});


it('cancels an in-flight transcription without delivering its late result to another project', async () => {
  let finish!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { finish = resolve; });
  const { fetch, stopTrack } = stubBrowser(() => response as unknown as Response);
  await speechRecognitionService.connectBackend();
  const onResult = vi.fn();
  const onError = vi.fn();
  speechRecognitionService.startListening({ onResult, onError,
    onStateChange: listening => listening && speechRecognitionService.stopListening() });
  await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => url === '/api/muse/transcribe')).toBe(true));
  const [, init] = fetch.mock.calls.find(([url]) => url === '/api/muse/transcribe')!;
  speechRecognitionService.cancelListening();
  expect((init as RequestInit).signal?.aborted).toBe(true);
  finish(Response.json({ transcript: 'Late direction from the previous project' }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(onResult).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(stopTrack).toHaveBeenCalled();
});

it('releases a microphone permission result that arrives after cancellation', async () => {
  stubBrowser(() => Response.json({ transcript: 'unused' }));
  let allow!: (stream: unknown) => void;
  const stop = vi.fn();
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(resolve => { allow = resolve; }) } });
  await speechRecognitionService.connectBackend();
  const result = vi.fn();
  speechRecognitionService.startListening({ onResult: result });
  speechRecognitionService.cancelListening();
  allow({ getTracks: () => [{ stop }] });
  await vi.waitFor(() => expect(stop).toHaveBeenCalled());
  expect(result).not.toHaveBeenCalled();
  expect(speechRecognitionService.isListening()).toBe(false);
});


it('never starts a browser cloud recognizer when no transcription provider is connected', async () => {
  const nativeRecognizer = vi.fn(() => { throw new Error('Browser cloud recognition must not run'); });
  const mic = vi.fn();
  const fetch = vi.fn(async () => Response.json({ transcribeModel: null, sessionToken: 'offline' }));
  vi.stubGlobal('window', { SpeechRecognition: nativeRecognizer, webkitSpeechRecognition: nativeRecognizer });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: mic } });
  vi.stubGlobal('fetch', fetch);
  await speechRecognitionService.connectBackend();
  const onError = vi.fn();
  expect(speechRecognitionService.isSupported()).toBe(false);
  expect(speechRecognitionService.startListening({ onError })).toBe(false);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('Transcription is not connected'));
  expect(nativeRecognizer).not.toHaveBeenCalled();
  expect(mic).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('does not trust provider data returned by an unsuccessful health response', async () => {
  stubBrowser(() => Response.json({ transcript: 'unused' }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ transcribeModel: 'unavailable' }, { status: 503 })));
  expect(await speechRecognitionService.connectBackend()).toBeNull();
  expect(speechRecognitionService.isSupported()).toBe(false);
});
