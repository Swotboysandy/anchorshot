import { Conversation, type VoiceConversation } from '@elevenlabs/client';

export type AgentTools = Record<string, (parameters: Record<string, unknown>) => string | Promise<string>>;

export interface AgentHandlers {
  onStatus: (status: string) => void;
  onMessage: (role: 'user' | 'agent', text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

/** Agent replies can carry voice direction such as [gentle], which is not speech. */
export const cleanCaption = (text: string) => text.replace(/\[[a-z][a-z -]*\]\s*/gi, '').trim();

/** True when the local server can open an ElevenLabs agent conversation. */
export async function agentAvailable(): Promise<{ ready: boolean; session: string }> {
  try {
    const health = await (await fetch('/api/health')).json();
    return { ready: health?.agentReady === true, session: String(health?.sessionToken ?? '') };
  } catch {
    return { ready: false, session: '' };
  }
}

/**
 * Starts one voice conversation. The server signs the link, so the API key stays
 * on the server; app actions are exposed to the agent as client tools.
 */
export async function startAgentConversation(
  session: string,
  tools: AgentTools,
  handlers: AgentHandlers,
): Promise<VoiceConversation> {
  const res = await fetch('/api/agent/session', {
    method: 'POST',
    headers: { 'X-Anchorshot-Session': session },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.signedUrl !== 'string')
    throw new Error(body.error || 'The voice agent could not start.');
  return Conversation.startSession({
    signedUrl: body.signedUrl,
    connectionType: 'websocket',
    textOnly: false,
    clientTools: tools,
    onConnect: () => handlers.onStatus('Agent connected. Speak your direction.'),
    onModeChange: ({ mode }) => handlers.onStatus(mode === 'speaking' ? 'Agent speaking.' : 'Agent listening.'),
    onMessage: ({ message, source }) => handlers.onMessage(source === 'user' ? 'user' : 'agent', cleanCaption(message)),
    onError: (message) => handlers.onError(message),
    onDisconnect: () => handlers.onEnd(),
  });
}
