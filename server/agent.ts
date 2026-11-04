import OpenAI from 'openai';
import { getCanonicalMetaModels, resolveUpstreamChatModel } from './models';

/**
 * Voice co-director behind `/api/agent/turn`: one model turn over the conversation
 * so far. The key stays on this server; the browser runs any requested studio
 * tool and sends its result back in the next turn.
 */
export type AgentMessage = OpenAI.Chat.ChatCompletionMessageParam;

export interface VoiceAgent {
  model: string;
  turn(messages: AgentMessage[], signal?: AbortSignal): Promise<OpenAI.Chat.ChatCompletionMessage>;
}

/** Validate browser history before reserving a paid request. Preserve tool/result pairs. */
export function validateAgentMessages(input: unknown): AgentMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > 80 || JSON.stringify(input).length > 64000)
    throw new Error('Send a conversation of at most 80 messages and 64,000 characters.');
  const pending = new Set<string>();
  const messages: AgentMessage[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') throw new Error('Invalid conversation message.');
    const message = value as Record<string, any>;
    const { role, content } = message;
    if (!['user', 'assistant', 'tool'].includes(role) || (content !== null && typeof content !== 'string') || (typeof content === 'string' && content.length > 12000))
      throw new Error('Conversation messages must contain bounded plain text.');
    if (role !== 'tool' && pending.size) throw new Error('Complete every tool result before the next message.');
    if (role === 'user') {
      if (typeof content !== 'string' || !content.trim()) throw new Error('The director message is empty.');
      messages.push({ role, content });
    } else if (role === 'tool') {
      if (typeof content !== 'string' || !pending.delete(message.tool_call_id)) throw new Error('The tool result has no matching request.');
      messages.push({ role, content, tool_call_id: message.tool_call_id });
    } else {
      let calls: OpenAI.Chat.ChatCompletionMessageToolCall[] | undefined;
      if (message.tool_calls !== undefined) {
        if (!Array.isArray(message.tool_calls) || !message.tool_calls.length || message.tool_calls.length > 8) throw new Error('Invalid agent tool calls.');
        calls = message.tool_calls.map((call: any) => {
          if (!call || typeof call.id !== 'string' || !call.id || call.id.length > 128 || pending.has(call.id) ||
              call.type !== 'function' || typeof call.function?.name !== 'string' || !/^[a-z_]{1,64}$/.test(call.function.name) ||
              typeof call.function.arguments !== 'string' || call.function.arguments.length > 8000)
            throw new Error('Invalid agent tool call.');
          const args = JSON.parse(call.function.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
          pending.add(call.id);
          return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
        });
      }
      if (!calls && (typeof content !== 'string' || !content.trim())) throw new Error('The agent reply is empty.');
      messages.push({ role, content, ...(calls ? { tool_calls: calls } : {}) });
    }
  }
  if (messages[0].role !== 'user' || pending.size) throw new Error('The conversation must start with the director and include every tool result.');
  return messages;
}

export const AGENT_PROMPT = `You are a spoken co-director inside a storyboard studio used by blind and low-vision filmmakers.
Your words are read aloud, so reply in one or two short plain sentences, with no markdown or lists.
Never describe visuals you were not told about; use describe_storyboard to read shots and their continuity status.
The director may not be able to see the screen, so call the matching tool straight away; the studio will read back mutating actions for the director's confirmation before executing them.
When the director gives scene direction, call set_direction with their words. If they also ask to make, create or generate it, call generate_storyboard in the same turn; otherwise offer to. This creates real videos, not sample storyboard drawings. Never claim a film is ready when generation reports missing configuration or a failure.
When the director asks to remake, regenerate, or redo an individual scene (such as "remake scene 2", "redo this shot", "regenerate scene 3"), call remake_shot with the shot number. Only call generate_storyboard if they explicitly ask to generate the whole film or remake all scenes.
Use select_shot to open a shot by number and read back what it returns. Use run_command for playback and continuity commands such as "play", "pause", "check continuity" or "the cup must be blue".
For a new colour use run_command, such as "make the dress red" or "make the dress red in shot 2". To change what an object is, or to add or replace something on it, use edit_object. Never regenerate the film for a change to one object.
Say plainly what the result reports, in your own words; never mention tools and never claim more than it says. A rule change does not repaint frames unless the result says so. If nothing changed, say so.`;

const tool = (name: string, description: string, properties: Record<string, object> = {}): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } },
});

/** Names match the studio actions the browser exposes in CleanStudio. */
export const AGENT_TOOLS = [
  tool('set_direction', "Save the director's spoken scene direction into the script.", { text: { type: 'string', description: "The direction, in the director's words." } }),
  tool('generate_storyboard', 'Generate real scene videos from the current script and apply them to the film timeline. This can take several minutes; report only the actual returned result.'),
  tool('remake_shot', 'Remake or regenerate a single scene while keeping the rest of the storyboard intact. Use when the director asks to remake, regenerate, or redo one shot (or the active shot).', {
    shot: { type: 'number', description: 'Shot number, starting at 1. If 0 or omitted, remakes the currently highlighted shot.' },
    direction: { type: 'string', description: 'Optional new direction or prompt specifically for this scene.' },
  }),
  tool('run_command', 'Run a studio command such as play, pause, check continuity, or a continuity colour rule.', { command: { type: 'string', description: 'The command text.' } }),
  tool('select_shot', 'Open a shot by its number and get its spoken description.', { number: { type: 'number', description: 'Shot number, starting at 1.' } }),
  tool('describe_storyboard', 'List every shot with its continuity status and description.'),
  tool('edit_object', 'Change or replace one named object in a shot image, for example turn the dress into a raincoat. Only that object changes. Takes up to a minute.', {
    object: { type: 'string', description: 'The object to find, such as dress.' },
    instruction: { type: 'string', description: 'What it should become, in the director\'s words.' },
    shot: { type: 'number', description: 'Shot number, or 0 for the open shot.' },
  }),
  tool('open_workspace', 'Open a workspace.', { name: { type: 'string', enum: ['create', 'dream', 'review'] } }),
  tool('narrate_shot', 'Read the open shot aloud.'),
  tool('export_film', 'Export the film as an MP4 file.'),
  tool('toggle_mute', 'Mute or unmute spoken feedback. Use only when asked.'),
  tool('move_shot', 'Move a shot earlier or later in the film.', { number: { type: 'number' }, direction: { type: 'string', enum: ['earlier', 'later'] } }),
  tool('change_shot_length', 'Lengthen or shorten a shot by half a second per step.', { number: { type: 'number' }, seconds: { type: 'number', description: 'Change in seconds, such as 1 or -0.5.' } }),
  tool('next_take', 'Switch a shot to its next take.', { number: { type: 'number' } }),
];

type Chat = Pick<OpenAI['chat']['completions'], 'create'>;

export function chatAgent(options: { model: string; upstreamModel?: string; chat: Chat }): VoiceAgent {
  const targetModel = options.upstreamModel ?? options.model;
  return {
    model: options.model,
    async turn(messages, signal) {
      const reply = await options.chat.create(
        { model: targetModel, messages: [{ role: 'system', content: AGENT_PROMPT }, ...messages], tools: AGENT_TOOLS },
        { signal },
      );
      const message = reply.choices[0]?.message;
      if (!message) throw new Error(`${options.model} returned no reply.`);
      return message;
    },
  };
}

/** Explicit server-side provider configuration; never falls back to a different paid provider. */
export function agentFromSettings(values: Record<string, string | undefined>): VoiceAgent | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  const provider = pick('AGENT_PROVIDER');
  if (provider !== 'meta' && provider !== 'openai-compatible') return undefined;
  const apiKey = provider === 'meta' ? pick('META_API_KEY') : pick('AGENT_API_KEY');
  const baseURL = provider === 'meta' ? pick('META_API_BASE_URL') || 'https://api.meta.ai/v1' : pick('AGENT_BASE_URL');
  const canonicalSpark = getCanonicalMetaModels(values).spark;
  const model = pick('AGENT_MODEL') || (provider === 'meta' ? canonicalSpark : '');
  if (!apiKey || !baseURL || !model) return undefined;
  const upstreamModel = resolveUpstreamChatModel(baseURL, model, values);
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 60_000 });
  return chatAgent({ model, upstreamModel, chat: client.chat.completions });
}
