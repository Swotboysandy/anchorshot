import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { agentFromSettings, elevenLabsAgent } from '../server/agent';

const startSession = vi.hoisted(() => vi.fn());
vi.mock('@elevenlabs/client', () => ({ Conversation: { startSession } }));
import { agentAvailable, startAgentConversation } from '../src/services/voiceAgent';

afterEach(() => {
  vi.unstubAllGlobals();
  startSession.mockReset();
});

describe('voice agent server', () => {
  it('asks ElevenLabs for a signed conversation link with the server key', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ signed_url: 'wss://api.elevenlabs.io/v1/convai/x?token=t' }));
    const url = await elevenLabsAgent({ apiKey: 'k', agentId: 'agent 1', fetch }).signedUrl();
    expect(url).toMatch(/^wss:\/\//);
    expect(fetch.mock.calls[0][0]).toBe('https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=agent%201');
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'xi-api-key': 'k' });
  });

  it('refuses replies without a usable link', async () => {
    const bad = vi.fn().mockResolvedValue(Response.json({ signed_url: 'http://example.test' }));
    await expect(elevenLabsAgent({ apiKey: 'k', agentId: 'a', fetch: bad }).signedUrl()).rejects.toThrow(/no conversation link/);
    const denied = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(elevenLabsAgent({ apiKey: 'k', agentId: 'a', fetch: denied }).signedUrl()).rejects.toThrow(/status 401/);
  });

  it('needs the provider, key and agent id', () => {
    expect(agentFromSettings({ AGENT_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' })).toBeUndefined();
    expect(agentFromSettings({ AGENT_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k', ELEVENLABS_AGENT_ID: 'a' })?.agentId).toBe('a');
  });

  it('serves links through /api/agent/session within the request limit', async () => {
    const signedUrl = vi.fn().mockResolvedValue('wss://link');
    const app = createApp({ settings: () => ({ key: '', requestLimit: 1 }), agent: { agentId: 'a', signedUrl } });
    const health = await request(app).get('/api/health');
    expect(health.body.agentReady).toBe(true);
    const post = () => request(app).post('/api/agent/session').set('X-Anchorshot-Session', health.body.sessionToken);
    expect((await post()).body).toEqual({ signedUrl: 'wss://link' });
    expect((await post()).status).toBe(429);
    const none = createApp({ settings: () => ({ key: '', requestLimit: 1 }) });
    const token = (await request(none).get('/api/health')).body.sessionToken;
    expect((await request(none).post('/api/agent/session').set('X-Anchorshot-Session', token)).status).toBe(501);
  });
});

describe('voice agent client', () => {
  it('starts a websocket conversation with the signed link and the app tools', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/health' ? Response.json({ agentReady: true, sessionToken: 't' }) : Response.json({ signedUrl: 'wss://link' }),
      ),
    );
    expect(await agentAvailable()).toEqual({ ready: true, session: 't' });
    startSession.mockResolvedValue({ endSession: vi.fn() });
    const tools = { describe_storyboard: () => 'empty' };
    const statuses: string[] = [];
    await startAgentConversation('t', tools, {
      onStatus: (s) => statuses.push(s),
      onMessage: () => {},
      onError: () => {},
      onEnd: () => {},
    });
    const options = startSession.mock.calls[0][0];
    expect(options).toMatchObject({ signedUrl: 'wss://link', connectionType: 'websocket', clientTools: tools });
    options.onModeChange({ mode: 'speaking' });
    expect(statuses).toEqual(['Agent speaking.']);
  });

  it('reports the server error and never opens a session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'No voice agent is connected.' }, { status: 501 })));
    await expect(
      startAgentConversation('t', {}, { onStatus() {}, onMessage() {}, onError() {}, onEnd() {} }),
    ).rejects.toThrow(/No voice agent/);
    expect(startSession).not.toHaveBeenCalled();
  });
});
