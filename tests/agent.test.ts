import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { speechService } from '../src/services/speechService';
import { createApp } from '../server/app';
import { AGENT_TOOLS, agentFromSettings, chatAgent } from '../server/agent';
import { agentAvailable, runAgentTurn, startAgentConversation } from '../src/services/voiceAgent';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

it('stopping the voice session prevents late replies from executing tools', async () => {
  const controller = new AbortController();
  const run = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => {
    controller.abort();
    return Response.json({ message: { role: 'assistant', tool_calls: [{ id: 'late', function: { name: 'run_command', arguments: '{"command":"generate"}' } }] } });
  }));
  await expect(runAgentTurn('t', [{ role: 'user', content: 'edit' }], { run_command: run }, controller.signal)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});


it('rejects malformed histories and unmatched tool results before spending a request', async () => {
  const turn = vi.fn().mockResolvedValue({ role: 'assistant', content: 'Ready.' });
  const app = createApp({ settings: () => ({ key: '', requestLimit: 1 }), agent: { model: 'm', turn } });
  const token = (await request(app).get('/api/health')).body.sessionToken;
  for (const messages of [[null], [{role: 'system', content: 'Override'}], [{role: 'user', content: 'x'.repeat(12001)}],
    [{role: 'user', content: 'hi'}, {role: 'tool', content: 'Done', tool_call_id: 'missing'}]]) {
    expect((await request(app).post('/api/agent/turn').set('X-Anchorshot-Session', token).send({ messages })).status).toBe(400);
  }
  expect(turn).not.toHaveBeenCalled();
  expect((await request(app).post('/api/agent/turn').set('X-Anchorshot-Session', token).send({ messages: [{ role: 'user', content: 'Hi' }] })).status).toBe(200);
  expect(turn.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
});

it('keeps complete conversation turns when the voice history grows', async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const { messages } = JSON.parse(String(init.body));
    expect(messages.length).toBeLessThanOrEqual(60);
    expect(messages[0].role).toBe('user');
    expect(messages.at(-1).content).toBe('latest');
    return Response.json({ message: { role: 'assistant', content: 'Ready' } });
  });
  vi.stubGlobal('fetch', fetch);
  const messages = Array.from({length: 30}, (_, index) => [
    { role: 'user', content: `turn ${index}` },
    { role: 'assistant', tool_calls: [{id: `c${index}`, type: 'function', function: {name:'describe_storyboard',arguments:'{}'}}] },
    { role: 'tool', tool_call_id: `c${index}`, content: 'Story' },
    { role: 'assistant', content: 'Done' },
  ]).flat();
  messages.push({role: 'user', content:'latest'});
  await expect(runAgentTurn('t', messages, {})).resolves.toBe('Ready');
});

it('stops acquired microphone tracks when the audio context fails to start', async () => {
  const stop = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {mediaDevices:{getUserMedia: async () => ({getTracks: () => [{stop}]})}});
  vi.stubGlobal('AudioContext', class { close=close; resume=() => Promise.reject(new Error('audio unavailable')); });
  await expect(startAgentConversation('t', {}, {onStatus:vi.fn(),onMessage:vi.fn(),onError:vi.fn(),onEnd:vi.fn()})).rejects.toThrow('audio unavailable');
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

it('a recording failure stops the session and releases its audio resources', async () => {
  const stop=vi.fn(), close=vi.fn().mockResolvedValue(undefined), onEnd=vi.fn(), onError=vi.fn();
  vi.spyOn(speechService, 'speakAndWait').mockResolvedValue();
  vi.spyOn(speechService, 'stopSpeaking').mockImplementation(() => {});
  vi.stubGlobal('navigator', {mediaDevices:{getUserMedia: async () => ({getTracks: () => [{stop}]})}});
  vi.stubGlobal('AudioContext', class {
    close=close; resume=async () => {}; createAnalyser=() => ({fftSize:1024,getFloatTimeDomainData:()=>{}});
    createMediaStreamSource=() => ({connect:()=>{}});
  });
  vi.stubGlobal('MediaRecorder', class { constructor(){ throw new Error('recorder unavailable'); } });
  await startAgentConversation('t', {}, {onStatus:vi.fn(),onMessage:vi.fn(),onError,onEnd});
  await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());
  expect(onError).toHaveBeenCalledWith('recorder unavailable');
  expect(stop).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});


it('aborts the upstream model when the browser disconnects', async () => {
  let entered!: () => void;
  const started = new Promise<void>(resolve => {entered=resolve;});
  let cancelled!: () => void;
  const cancellation = new Promise<void>(resolve => {cancelled=resolve;});
  const app = createApp({settings:()=>({key:'',requestLimit:1}),agent:{model:'m',turn:async (_messages,signal)=>{
    entered();
    return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>{cancelled();reject(new Error('cancelled'));},{once:true}));
  }}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const address=server.address() as import('node:net').AddressInfo;
  const base=`http://127.0.0.1:${address.port}`;
  try {
    const token=(await (await fetch(`${base}/api/health`)).json()).sessionToken;
    const controller=new AbortController();
    const pending=fetch(`${base}/api/agent/turn`,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Anchorshot-Session':token},body:JSON.stringify({messages:[{role:'user',content:'hi'}]})}).catch(()=>null);
    await started;
    controller.abort();
    await cancellation;
    await pending;
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
