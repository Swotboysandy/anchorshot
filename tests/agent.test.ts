import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { AGENT_TOOLS, agentFromSettings, chatAgent } from '../server/agent';
import { agentAvailable, runAgentTurn } from '../src/services/voiceAgent';

afterEach(() => vi.unstubAllGlobals());

describe('voice agent server', () => {
  it('sends the prompt, conversation and studio tools to the model', async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'Ready.' } }] });
    const message = await chatAgent({ model: 'm', chat: { create } as never }).turn([{ role: 'user', content: 'Hello' }]);
    expect(message.content).toBe('Ready.');
    const body = create.mock.calls[0][0];
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(body.tools).toBe(AGENT_TOOLS);
  });

  it('needs the provider and the Meta key', () => {
    expect(agentFromSettings({ AGENT_PROVIDER: 'meta', META_API_KEY: '' })).toBeUndefined();
    expect(agentFromSettings({ AGENT_PROVIDER: '', META_API_KEY: 'k' })).toBeUndefined();
    expect(agentFromSettings({ AGENT_PROVIDER: 'meta', META_API_KEY: 'k' })?.model).toBe('muse-spark-1.3');
  });

  it('serves turns within the request limit, and validates input', async () => {
    const turn = vi.fn().mockResolvedValue({ role: 'assistant', content: 'Ready.' });
    const app = createApp({ settings: () => ({ key: '', requestLimit: 1 }), agent: { model: 'm', turn } });
    const health = await request(app).get('/api/health');
    expect(health.body.agentReady).toBe(true);
    const post = (body: object) => request(app).post('/api/agent/turn').set('X-Anchorshot-Session', health.body.sessionToken).send(body);
    expect((await post({ messages: [] })).status).toBe(400);
    expect((await post({ messages: [{ role: 'user', content: 'Hi' }] })).body.message.content).toBe('Ready.');
    expect((await post({ messages: [{ role: 'user', content: 'Hi' }] })).status).toBe(429);
    const none = createApp({ settings: () => ({ key: '', requestLimit: 1 }) });
    const token = (await request(none).get('/api/health')).body.sessionToken;
    expect((await request(none).post('/api/agent/turn').set('X-Anchorshot-Session', token).send({ messages: [{ role: 'user', content: 'Hi' }] })).status).toBe(501);
  });
});

describe('voice agent client', () => {
  const stubTurns = (...replies: object[]) => {
    const fetch = vi.fn(async (url: string) =>
      url === '/api/health' ? Response.json({ agentReady: true, sessionToken: 't' }) : Response.json({ message: replies.shift() }),
    );
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('runs requested studio tools, sends results back and returns the spoken reply', async () => {
    const fetch = stubTurns(
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'select_shot', arguments: '{"number":2}' } }] },
      { role: 'assistant', content: 'Shot two shows the cup.' },
    );
    expect(await agentAvailable()).toEqual({ ready: true, session: 't' });
    const select = vi.fn().mockReturnValue('The cup on the counter.');
    const messages = [{ role: 'user', content: 'Open shot two' }];
    expect(await runAgentTurn('t', messages, { select_shot: select })).toBe('Shot two shows the cup.');
    expect(select).toHaveBeenCalledWith({ number: 2 });
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'The cup on the counter.' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports an unknown or failing tool to the model instead of crashing', async () => {
    stubTurns(
      { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'nope', arguments: '{}' } }, { id: 'c2', function: { name: 'bad', arguments: '{}' } }] },
      { role: 'assistant', content: 'Sorry.' },
    );
    const messages = [{ role: 'user', content: 'x' }];
    const bad = () => {
      throw new Error('boom');
    };
    expect(await runAgentTurn('t', messages, { bad })).toBe('Sorry.');
    expect(messages[2]).toMatchObject({ content: 'Unknown tool nope.' });
    expect(messages[3]).toMatchObject({ content: 'That failed: boom' });
  });
});
