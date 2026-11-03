import { describe, expect, it } from 'vitest';
import { speechRecognitionService } from '../src/services/speechRecognitionService';

describe('Speech Recognition Service & Local Testing Gateway', () => {
  it('exposes environment support detection cleanly', () => {
    // In Node / non-browser test runner, isSupported returns false safely without throwing
    expect(typeof speechRecognitionService.isSupported()).toBe('boolean');
    expect(speechRecognitionService.isListening()).toBe(false);
  });

  it('runs local speech simulation with word streaming and state transitions', async () => {
    const textToSimulate = 'The ceramic cup must be blue across all shots.';
    const receivedChunks: string[] = [];
    const stateTransitions: boolean[] = [];

    const result = await speechRecognitionService.simulateLocalSpeech(textToSimulate, {
      speedMs: 10,
      onResult: (text, isFinal) => {
        receivedChunks.push(text);
        if (isFinal) {
          expect(text).toBe(textToSimulate);
        }
      },
      onStateChange: (listening) => {
        stateTransitions.push(listening);
      },
    });

    expect(result).toBe(textToSimulate);
    expect(receivedChunks.length).toBeGreaterThanOrEqual(1);
    expect(receivedChunks[receivedChunks.length - 1]).toBe(textToSimulate);
    // Verified start (true) and stop (false) lifecycle
    expect(stateTransitions).toContain(true);
    expect(stateTransitions).toContain(false);
    expect(speechRecognitionService.isListening()).toBe(false);
  });

  it('gracefully handles unsupported environment without crashing', () => {
    let errorReceived = '';
    const started = speechRecognitionService.startListening({
      onError: (err) => {
        errorReceived = err;
      },
    });

    if (!speechRecognitionService.isSupported()) {
      expect(started).toBe(false);
      expect(errorReceived).toContain('Transcription is not connected');
      expect(speechRecognitionService.isListening()).toBe(false);
    }
  });
});
