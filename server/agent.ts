import OpenAI from 'openai';

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

export const AGENT_PROMPT = `You are a spoken co-director inside a storyboard studio used by blind and low-vision filmmakers.
Your words are read aloud, so reply in one or two short plain sentences, with no markdown or lists.
Never describe visuals you were not told about; use describe_storyboard to read shots and their continuity status.
When the director gives scene direction, call set_direction with their words, then offer to call generate_storyboard.
Use select_shot to open a shot by number and read back what it returns. Use run_command for playback and continuity commands such as "play", "pause", "check continuity" or "the cup must be blue".
Always tell the director what each tool reported.`;

const tool = (name: string, description: string, properties: Record<string, object> = {}): OpenAI.Chat.ChatCompletionTool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } },
});

/** Names match the studio actions the browser exposes in CleanStudio. */
export const AGENT_TOOLS = [
  tool('set_direction', "Save the director's spoken scene direction into the script.", { text: { type: 'string', description: "The direction, in the director's words." } }),
  tool('generate_storyboard', 'Build the storyboard shots from the current script.'),
  tool('run_command', 'Run a studio command such as play, pause, check continuity, or a continuity colour rule.', { command: { type: 'string', description: 'The command text.' } }),
  tool('select_shot', 'Open a shot by its number and get its spoken description.', { number: { type: 'number', description: 'Shot number, starting at 1.' } }),
  tool('describe_storyboard', 'List every shot with its continuity status and description.'),
];

type Chat = Pick<OpenAI['chat']['completions'], 'create'>;

export function chatAgent(options: { model: string; chat: Chat }): VoiceAgent {
  return {
    model: options.model,
    async turn(messages, signal) {
      const reply = await options.chat.create(
        { model: options.model, messages: [{ role: 'system', content: AGENT_PROMPT }, ...messages], tools: AGENT_TOOLS },
        { signal },
      );
      const message = reply.choices[0]?.message;
      if (!message) throw new Error(`${options.model} returned no reply.`);
      return message;
    },
  };
}

/** AGENT_PROVIDER=meta with META_API_KEY; AGENT_MODEL defaults to muse-spark-1.3. */
export function agentFromSettings(values: Record<string, string | undefined>): VoiceAgent | undefined {
  const pick = (name: string) => (process.env[name] ?? values[name] ?? '').trim();
  const apiKey = pick('META_API_KEY');
  if (pick('AGENT_PROVIDER') !== 'meta' || !apiKey) return undefined;
  const baseURL = pick('META_API_BASE_URL') || 'https://api.meta.ai/v1';
  const client = new OpenAI({ baseURL, apiKey, maxRetries: 0, timeout: 60_000 });
  return chatAgent({ model: pick('AGENT_MODEL') || 'muse-spark-1.3', chat: client.chat.completions });
}
