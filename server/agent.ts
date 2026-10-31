/**
 * Voice-agent role behind `/api/agent/session`. The browser never sees the API
 * key: it asks this server for a short-lived signed URL for one conversation.
 */
export interface VoiceAgent {
  agentId: string;
  signedUrl(signal?: AbortSignal): Promise<string>;
}

export function elevenLabsAgent(options: { apiKey: string; agentId: string; fetch?: typeof fetch }): VoiceAgent {
  const send = options.fetch ?? fetch;
  return {
    agentId: options.agentId,
    async signedUrl(signal) {
      const res = await send(
        `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(options.agentId)}`,
        { headers: { 'xi-api-key': options.apiKey }, signal },
      );
      if (!res.ok) throw new Error(`ElevenLabs agent session failed with status ${res.status}.`);
      const url = ((await res.json()) as { signed_url?: unknown }).signed_url;
      if (typeof url !== 'string' || !url.startsWith('wss://'))
        throw new Error('ElevenLabs returned no conversation link.');
      return url;
    },
  };
}

/** AGENT_PROVIDER=elevenlabs with ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID. */
export function agentFromSettings(values: Record<string, string | undefined>): VoiceAgent | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  const [apiKey, agentId] = [pick('ELEVENLABS_API_KEY'), pick('ELEVENLABS_AGENT_ID')];
  if (pick('AGENT_PROVIDER') !== 'elevenlabs' || !apiKey || !agentId) return undefined;
  return elevenLabsAgent({ apiKey, agentId });
}
