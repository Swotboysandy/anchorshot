import { speechService } from './speechService';

export type AgentTools = Record<string, (parameters: Record<string, unknown>) => string | Promise<string>>;

export interface AgentHandlers {
  onStatus: (status: string) => void;
  onMessage: (role: 'user' | 'agent', text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface AgentConversation {
  endSession: () => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}

type Message = Record<string, unknown> & { role: string };

const GREETING = 'Hi, I am your co-director. Tell me the scene, or ask me to read the storyboard.';
/** Quiet this long after speech ends the director's turn. */
const SILENCE_MS = 2000;
const SPEECH_LEVEL = 0.04;
/** Room noise is sampled this long, so a noisy room still counts as quiet. */
const CALIBRATE_MS = 500;
/** A turn ends here even if the room never goes quiet. */
const MAX_TURN_MS = 30_000;
const MAX_TOOL_ROUNDS = 5;

/** True when the local server can run the voice agent. */
export async function agentAvailable(): Promise<{ ready: boolean; session: string }> {
  try {
    const health = await (await fetch('/api/health')).json();
    return { ready: health?.agentReady === true, session: String(health?.sessionToken ?? '') };
  } catch {
    return { ready: false, session: '' };
  }
}

async function post(url: string, session: string, body: object) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': session },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The voice agent could not respond.');
  return data;
}

/**
 * One director turn: asks the model, runs the studio tools it requests, and repeats
 * until it answers in words. Appends everything to `messages`.
 */
export async function runAgentTurn(session: string, messages: Message[], tools: AgentTools): Promise<string> {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const { message } = await post('/api/agent/turn', session, { messages });
    messages.push(message);
    const calls: Array<{ id: string; function: { name: string; arguments: string } }> = message.tool_calls ?? [];
    if (!calls.length) return String(message.content ?? '').trim();
    for (const call of calls) {
      let content: string;
      try {
        const run = tools[call.function.name];
        content = run ? await run(JSON.parse(call.function.arguments || '{}')) : `Unknown tool ${call.function.name}.`;
      } catch (error) {
        content = `That failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  return 'I could not finish that. Please try again.';
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The recording could not be read.'));
    reader.readAsDataURL(blob);
  });

/**
 * Hands-free conversation: listens until the director pauses, transcribes with the
 * server's voice model, runs a turn, speaks the reply, and listens again. The
 * microphone is ignored while the agent speaks, so it does not hear itself.
 */
export async function startAgentConversation(
  session: string,
  tools: AgentTools,
  handlers: AgentHandlers,
): Promise<AgentConversation> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const level = () => {
    analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  };

  let ended = false;
  let speaking = false;
  let recorder: MediaRecorder | null = null;
  const messages: Message[] = [];

  const say = async (text: string) => {
    handlers.onMessage('agent', text);
    handlers.onStatus('Agent speaking.');
    speaking = true;
    await speechService.speakAndWait(text);
    speaking = false;
  };

  const listen = () =>
    new Promise<Blob | null>((resolve) => {
      const chunks: Blob[] = [];
      const active = new MediaRecorder(stream);
      recorder = active;
      let heard = false;
      let quietSince = 0;
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () => resolve(heard && !ended ? new Blob(chunks, { type: active.mimeType || 'audio/webm' }) : null);
      active.start();
      handlers.onStatus('Agent listening.');
      const startedAt = Date.now();
      let noise = 0;
      const watch = setInterval(() => {
        if (ended) {
          clearInterval(watch);
          if (active.state !== 'inactive') active.stop();
          return;
        }
        const now = level();
        if (Date.now() - startedAt < CALIBRATE_MS) {
          noise = Math.max(noise, now);
          return;
        }
        if (heard && Date.now() - startedAt > MAX_TURN_MS) {
          clearInterval(watch);
          active.stop();
          return;
        }
        if (now > Math.max(SPEECH_LEVEL, noise * 2)) {
          heard = true;
          quietSince = 0;
        } else if (heard) {
          quietSince ||= Date.now();
          if (Date.now() - quietSince > SILENCE_MS) {
            clearInterval(watch);
            active.stop();
          }
        }
      }, 100);
    });

  void (async () => {
    try {
      await say(GREETING);
      while (!ended) {
        const clip = await listen();
        if (ended) break;
        if (!clip) continue;
        handlers.onStatus('Agent thinking.');
        let transcript = '';
        try {
          transcript = (await post('/api/muse/transcribe', session, { audio: await toDataUrl(clip) })).transcript;
        } catch (error) {
          if (!ended) await say(`I could not transcribe that. ${error instanceof Error ? error.message : ''}`.trim());
          continue;
        }
        if (ended) break;
        if (!transcript) {
          await say('I did not catch any words. Please say that again.');
          continue;
        }
        handlers.onMessage('user', transcript);
        messages.push({ role: 'user', content: transcript });
        let reply: string;
        try {
          reply = await runAgentTurn(session, messages, tools);
        } catch (error) {
          messages.pop();
          reply = `I could not respond. ${error instanceof Error ? error.message : ''}`.trim();
        }
        if (!ended) await say(reply || 'I have no reply for that.');
      }
    } catch (error) {
      if (!ended) {
        handlers.onError(error instanceof Error ? error.message : 'The voice agent stopped.');
        handlers.onEnd();
      }
    }
  })();

  return {
    endSession: async () => {
      ended = true;
      speechService.stopSpeaking();
      if (recorder && recorder.state === 'recording') recorder.stop();
      stream.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => {});
    },
    getInputVolume: () => (speaking ? 0 : level()),
    getOutputVolume: () => (speaking ? 0.5 : 0),
  };
}
