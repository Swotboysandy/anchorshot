import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechService } from '../src/services/speechService';

afterEach(() => {
  speechService.stopSpeaking();
  vi.unstubAllGlobals();
});

const stubBrowser = (speak: () => Response) => {
  const browserSpeak = vi.fn();
  const played: string[] = [];
  vi.stubGlobal('window', { speechSynthesis: { cancel: vi.fn(), speak: browserSpeak, getVoices: () => [] } });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:clip', revokeObjectURL: vi.fn() });
  vi.stubGlobal(
    'Audio',
    class {
      playbackRate = 1;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public src: string) {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
      pause() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/health' ? Response.json({ sessionToken: 't', narrationModel: 'eleven_flash_v2_5' }) : speak(),
    ),
  );
  return { browserSpeak, played };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('narration through the server voice', () => {
  it('plays the server clip when a narration voice is connected', async () => {
    const { played, browserSpeak } = stubBrowser(() => new Response('mp3', { headers: { 'content-type': 'audio/mpeg' } }));
    expect(await speechService.connectBackend()).toBe('eleven_flash_v2_5');
    speechService.speak('Shot one, wide framing.');
    await settle();
    await settle();
    expect(played).toEqual(['blob:clip']);
    expect(browserSpeak).not.toHaveBeenCalled();
  });

  it('falls back to the browser voice when the server cannot narrate', async () => {
    const { played } = stubBrowser(() => Response.json({ error: 'budget' }, { status: 429 }));
    vi.stubGlobal('SpeechSynthesisUtterance', class {});
    await speechService.connectBackend();
    speechService.speak('Shot two.');
    await settle();
    await settle();
    expect(played).toEqual([]);
  });
});
