import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechRecognitionService } from '../src/services/speechRecognitionService';

afterEach(() => {
  speechRecognitionService.stopListening();
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
