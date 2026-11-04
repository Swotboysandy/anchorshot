import { speechService } from './speechService';
import { classifyVoiceConfirmationReply, describeVoiceActionSummary, parseVoiceCommand } from './voiceCommandParser';

export type AgentTools = Record<string, (parameters: Record<string, unknown>) => string | Promise<string>>;

const READ_ONLY_AGENT_TOOLS = new Set([
  'describe_storyboard',
  'select_shot',
  'narrate_shot',
  'open_workspace',
  'toggle_mute',
  'set_direction',
]);

export function isMutatingAgentTool(name: string, parameters: Record<string, unknown> = {}): boolean {
  if (READ_ONLY_AGENT_TOOLS.has(name)) return false;
  if (name === 'run_command') {
    const cmd = typeof parameters.command === 'string' ? parameters.command : '';
    const intent = parseVoiceCommand(cmd);
    return !['playback', 'help', 'narrate', 'invalid_command'].includes(intent.kind);
  }
  return true;
}

export function describeAgentToolAction(name: string, parameters: Record<string, unknown> = {}): string {
  switch (name) {
    case 'generate_storyboard':
      return 'generate the storyboard video scenes';
    case 'edit_object':
      return `change the ${String(parameters.object || 'object')} (${String(parameters.instruction || 'edit')})${parameters.shot ? ` in Shot ${parameters.shot}` : ''}`;
    case 'run_command':
      return describeVoiceActionSummary(String(parameters.command || ''), true);
    case 'move_shot':
      return `move Shot ${String(parameters.number || 1)} ${String(parameters.direction || 'later')}`;
    case 'change_shot_length':
      return `adjust Shot ${String(parameters.number || 1)} duration by ${String(parameters.seconds || 0)} seconds`;
    case 'next_take':
      return `switch Shot ${String(parameters.number || 1)} to its next take`;
    case 'export_film':
      return 'export the film as an MP4 file';
    default:
      return `run ${name.replace(/_/g, ' ')}`;
  }
}

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
const SILENCE_MS = 1400;
const CONFIRM_SILENCE_MS = 950;
const SPEECH_LEVEL = 0.024;
/** Room noise is sampled this long, so a noisy room still counts as quiet. */
const CALIBRATE_MS = 180;
/** Consecutive 100 ms checks above the speech level before a turn begins. */
const SPEECH_TICKS = 2;
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

async function post(url: string, session: string, body: object, signal?: AbortSignal) {
  let res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': session },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    const refreshed = await agentAvailable();
    if (refreshed.session) {
      res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'X-Anchorshot-Session': refreshed.session },
        body: JSON.stringify(body),
      });
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The voice agent could not respond.');
  return data;
}

/**
 * One director turn: asks the model, runs the studio tools it requests, and repeats
 * until it answers in words. Appends everything to `messages`.
 */
export async function runAgentTurn(session: string, messages: Message[], tools: AgentTools, signal?: AbortSignal): Promise<string> {
  // Drop complete old turns, never an assistant/tool pair in isolation.
  while (messages.length > 60 || JSON.stringify(messages).length > 48000) {
    const nextTurn = messages.findIndex((message, index) => index > 0 && message.role === 'user');
    if (nextTurn < 0) break;
    messages.splice(0, nextTurn);
  }
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    signal?.throwIfAborted();
    const { message } = await post('/api/agent/turn', session, { messages }, signal);
    signal?.throwIfAborted();
    if (!message || message.role !== 'assistant' || (message.content != null && typeof message.content !== 'string') ||
        (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 8)))
      throw new Error('The voice agent returned an invalid reply.');
    const calls: Array<{ id: string; function: { name: string; arguments: string } }> = message.tool_calls ?? [];
    if (calls.some(call => !call || typeof call.id !== 'string' || !call.function || typeof call.function.name !== 'string' || typeof call.function.arguments !== 'string'))
      throw new Error('The voice agent returned an invalid tool request.');
    messages.push({
      role: 'assistant',
      content: typeof message.content === 'string' ? message.content : null,
      ...(calls.length
        ? {
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.function.name, arguments: call.function.arguments },
            })),
          }
        : {}),
    });
    if (!calls.length) return String(message.content ?? '').trim();
    for (const call of calls) {
      signal?.throwIfAborted();
      let content: string;
      try {
        const run = tools[call.function.name];
        content = run ? await run(JSON.parse(call.function.arguments || '{}')) : `Unknown tool ${call.function.name}.`;
      } catch (error) {
        content = `That failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
    if (messages.some((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('CONFIRMATION_REQUIRED:'))) {
      const gatedMsg = messages
        .filter((m) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('CONFIRMATION_REQUIRED:'))
        .map((m) => String(m.content).replace(/^CONFIRMATION_REQUIRED:\s*/, ''))
        .join(' ');
      messages.push({ role: 'assistant', content: gatedMsg });
      return gatedMsg;
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
  let context: AudioContext | undefined;
  let analyser: AnalyserNode;
  try {
    context = new AudioContext();
    await context.resume();
    analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    await context?.close().catch(() => {});
    throw error;
  }
  const samples = new Float32Array(analyser.fftSize);
  const level = () => {
    analyser.getFloatTimeDomainData(samples);
    return Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
  };

  const controller = new AbortController();
  let ended = false;
  let speaking = false;
  let recorder: MediaRecorder | null = null;
  let watch: ReturnType<typeof setInterval> | undefined;
  const messages: Message[] = [];

  const say = async (text: string) => {
    handlers.onMessage('agent', text);
    handlers.onStatus('Agent speaking.');
    speaking = true;
    await speechService.speakAndWait(text);
    speaking = false;
  };

  const listen = (quickConfirm = false) =>
    new Promise<Blob | null>((resolve, reject) => {
      const chunks: Blob[] = [];
      const active = new MediaRecorder(stream);
      recorder = active;
      let heard = false;
      let quietSince = 0;
      const requiredTicks = quickConfirm ? 1 : SPEECH_TICKS;
      const silenceTargetMs = quickConfirm ? CONFIRM_SILENCE_MS : SILENCE_MS;
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onstop = () => {
        clearInterval(watch);
        resolve(heard && !ended ? new Blob(chunks, { type: active.mimeType || 'audio/webm' }) : null);
      };
      active.onerror = () => {
        clearInterval(watch);
        reject(new Error('The microphone recording failed.'));
      };
      active.start();
      handlers.onStatus(quickConfirm ? 'Agent listening for "yes" or "repeat"...' : 'Agent listening.');
      const startedAt = Date.now();
      let noise = 0;
      let loudTicks = 0;
      watch = setInterval(() => {
        if (ended) {
          clearInterval(watch);
          if (active.state !== 'inactive') active.stop();
          return;
        }
        const now = level();
        if (Date.now() - startedAt < CALIBRATE_MS) {
          noise = Math.min(0.025, Math.max(noise, now));
          return;
        }
        if (Date.now() - startedAt > MAX_TURN_MS) {
          clearInterval(watch);
          active.stop();
          return;
        }
        if (now > Math.max(SPEECH_LEVEL, noise * 1.8)) {
          // A click or cough is too brief to count as the director speaking.
          if (++loudTicks >= requiredTicks && !heard) {
            heard = true;
          }
          quietSince = 0;
        } else if (!heard) {
          loudTicks = 0;
        } else {
          quietSince ||= Date.now();
          if (Date.now() - quietSince > silenceTargetMs) {
            clearInterval(watch);
            active.stop();
          }
        }
      }, 90);
    });

  const endSession = async () => {
    if (ended) return;
    ended = true;
    controller.abort();
    clearInterval(watch);
    speechService.stopSpeaking();
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* cleanup still stops the tracks below */ }
    }
    stream.getTracks().forEach(track => track.stop());
    await context?.close().catch(() => {});
  };

  void (async () => {
    let pendingActions: Array<{
      name: string;
      parameters: Record<string, unknown>;
      heardTranscript: string;
      summary: string;
    }> = [];
    let lastHeardTranscript = '';

    const gatedTools = new Proxy({} as AgentTools, {
      get: (_, prop) => {
        const name = String(prop);
        const target = tools[name];
        if (!target) return undefined;
        return async (parameters: Record<string, unknown>) => {
          if (isMutatingAgentTool(name, parameters)) {
            const summary = describeAgentToolAction(name, parameters);
            pendingActions.push({
              name,
              parameters,
              heardTranscript: lastHeardTranscript,
              summary,
            });
            const allSummaries = pendingActions.map((a) => a.summary).join(' and ');
            return `CONFIRMATION_REQUIRED: I heard "${lastHeardTranscript}". That will ${allSummaries}. Say "yes" to confirm, or say "repeat" if there was a mistake.`;
          }
          return await target(parameters);
        };
      },
    });

    try {
      await say(GREETING);
      while (!ended) {
        const clip = await listen(pendingActions.length > 0);
        if (ended) break;
        if (!clip) continue;
        handlers.onStatus('Agent thinking.');
        let transcript = '';
        try {
          transcript = (await post('/api/muse/transcribe', session, { audio: await toDataUrl(clip) }, controller.signal)).transcript;
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          // Brief noise never reaches here, so a director who spoke must not be met with silence.
          if (!ended) await say(/heard no speech/i.test(message) ? 'I did not catch that. Please say it again.' : `I could not transcribe that. ${message}`.trim());
          continue;
        }
        if (ended) break;
        if (!transcript) continue;
        handlers.onMessage('user', transcript);

        if (pendingActions.length > 0) {
          const decision = classifyVoiceConfirmationReply(transcript);
          if (decision === 'confirm') {
            const actionsToRun = [...pendingActions];
            pendingActions = [];
            handlers.onStatus(`Confirmed: ${actionsToRun.map((a) => a.summary).join(', ')}...`);
            try {
              const results: string[] = [];
              for (const actionToRun of actionsToRun) {
                const run = tools[actionToRun.name];
                const resText = run ? await run(actionToRun.parameters) : `Unknown tool ${actionToRun.name}.`;
                results.push(String(resText));
              }
              const combinedResult = results.join(' ');
              messages.push(
                { role: 'user', content: transcript },
                { role: 'assistant', content: combinedResult }
              );
              if (!ended) await say(combinedResult);
            } catch (err) {
              const errMsg = `That failed: ${err instanceof Error ? err.message : String(err)}`;
              if (!ended) await say(errMsg);
            }
            continue;
          }
          if (decision === 'repeat' || decision === 'cancel') {
            pendingActions = [];
            messages.push(
              { role: 'user', content: transcript },
              { role: 'assistant', content: 'Cancelled. Please repeat your instruction.' }
            );
            if (!ended) await say('Okay, I cancelled that action. Please repeat your instruction.');
            continue;
          }
          // If the director spoke a brand-new instruction instead of yes/repeat, clear the old pending actions and process the new utterance.
          pendingActions = [];
        }

        lastHeardTranscript = transcript;
        messages.push({ role: 'user', content: transcript });
        let reply: string;
        try {
          reply = await runAgentTurn(session, messages, gatedTools, controller.signal);
        } catch (error) {
          reply = `I could not respond. ${error instanceof Error ? error.message : ''}`.trim();
          if (!ended) messages.push({ role: 'assistant', content: reply });
        }
        if (!ended) await say(reply || 'I have no reply for that.');
      }
    } catch (error) {
      if (!ended) {
        await endSession();
        handlers.onError(error instanceof Error ? error.message : 'The voice agent stopped.');
        handlers.onEnd();
      }
    }
  })();

  return {
    endSession,
    getInputVolume: () => (ended || speaking ? 0 : level()),
    getOutputVolume: () => (!ended && speaking ? 0.5 : 0),
  };
}
