import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'motion/react';
import type { VoiceConversation } from '@elevenlabs/client';
import { VoiceOrb } from './agents/voice-orb';
import './voiceOverlay.css';
import { SPRING_PRESS } from '../lib/ease';
import { agentAvailable, startAgentConversation, type AgentTools } from '../services/voiceAgent';

const COLORS = ['#b7b7b7', '#ffffff', '#252525'] as const;
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** App actions the voice agent may call. Without a connected agent the orb only meters locally. */
  agentTools?: AgentTools;
};

/** Persistent entry to voice: an ElevenLabs agent when connected, otherwise local metering. */
export function VoiceOverlay({ open, onOpenChange, agentTools }: Props) {
  const reduced = useReducedMotion();
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState(false);
  const resources = useRef<{ stream: MediaStream; context: AudioContext } | null>(null);
  const generation = useRef(0);
  const conversation = useRef<VoiceConversation | null>(null);
  const frame = useRef(0);
  const agentActivity = useMotionValue(0);
  const [agentStatus, setAgentStatus] = useState('');
  const stop = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(frame.current);
    void conversation.current?.endSession().catch(() => {});
    conversation.current = null;
    agentActivity.set(0);
    setAgentStatus('');
    resources.current?.stream.getTracks().forEach((track) => track.stop());
    void resources.current?.context.close().catch(() => {});
    resources.current = null;
    setAnalyser(null);
    setPending(false);
  }, []);
  useEffect(() => {
    if (!open) {
      stop();
      setError('');
      setRenderError(false);
    }
  }, [open, stop]);
  useEffect(
    () => () => {
      generation.current++;
      cancelAnimationFrame(frame.current);
      void conversation.current?.endSession().catch(() => {});
      resources.current?.stream.getTracks().forEach((track) => track.stop());
      void resources.current?.context.close().catch(() => {});
    },
    [],
  );
  const startAgent = async (request: number, session: string) => {
    const active = await startAgentConversation(session, agentTools ?? {}, {
      onStatus: (status) => request === generation.current && setAgentStatus(status),
      onMessage: (role, text) =>
        request === generation.current && setAgentStatus(`${role === 'user' ? 'You' : 'Agent'}: ${text}`),
      onError: (message) => request === generation.current && setError(message),
      onEnd: () => request === generation.current && onOpenChange(false),
    });
    if (request !== generation.current) return void active.endSession();
    conversation.current = active;
    const meter = () => {
      agentActivity.set(Math.min(1, Math.max(active.getInputVolume(), active.getOutputVolume()) * 1.6));
      frame.current = requestAnimationFrame(meter);
    };
    meter();
  };
  const start = async () => {
    if (pending || analyser || conversation.current) return;
    const request = ++generation.current;
    setPending(true);
    setError('');
    const agent = agentTools ? await agentAvailable() : { ready: false, session: '' };
    if (agent.ready) {
      try {
        await startAgent(request, agent.session);
      } catch (reason) {
        if (request === generation.current)
          setError(reason instanceof Error ? reason.message : 'The voice agent could not start.');
      } finally {
        if (request === generation.current) setPending(false);
      }
      return;
    }
    let stream: MediaStream | null = null,
      context: AudioContext | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Microphone access is unavailable in this browser.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (request !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      await context.resume();
      if (request !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return;
      }
      const meter = context.createAnalyser();
      meter.fftSize = 256;
      context.createMediaStreamSource(stream).connect(meter);
      // Deliberately not connected to speakers and never recorded or uploaded.
      resources.current = { stream, context };
      setAnalyser(meter);
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close().catch(() => {});
      if (request === generation.current)
        setError(
          reason instanceof DOMException && reason.name === 'NotAllowedError'
            ? 'Microphone permission was denied. You can still type your direction.'
            : reason instanceof Error
              ? reason.message
              : 'Microphone could not start.',
        );
    } finally {
      if (request === generation.current) setPending(false);
    }
  };
  // Opening is a deliberate voice action; the browser still owns permission consent.
  useEffect(() => { if (open) void start(); }, [open]);
  const changeOpen = (next: boolean) => {
    if (!next) stop();
    onOpenChange(next);
  };
  return (
    <div className="voice-orb-only">
      <motion.button type="button" className="voice-orb-toggle"
        animate={{scale: reduced ? 1 : analyser ? 1.12 : 1}}
        whileHover={reduced ? undefined : {scale: analyser ? 1.16 : 1.04}}
        whileTap={reduced ? undefined : {scale: 0.92}}
        transition={reduced ? {duration:0} : SPRING_PRESS}
        title={open ? 'Stop voice chat' : 'Voice chat — click to start'}
        aria-label={open ? 'Stop voice chat' : 'Start voice chat'}
        aria-pressed={open} aria-describedby="voice-orb-status"
        onClick={() => changeOpen(!open)}
        onKeyDown={event => { if(event.key === 'Escape') changeOpen(false); }}>
        <motion.div animate={{rotate: !reduced && analyser ? 360 : 0}}
          transition={{duration: analyser && !reduced ? 14 : 0, repeat: analyser && !reduced ? Infinity : 0, ease:'linear'}}>
          <VoiceOrb colors={COLORS} analyser={analyser} active={!!analyser || !!agentStatus}
            activity={agentActivity}
            speed={1.15} className="w-24" aria-label="Voice orb"
            onError={() => {setRenderError(true);stop();}} />
        </motion.div>
      </motion.button>
      <span id="voice-orb-status" className="sr-only" role="status">
        {error || (renderError ? 'Orb unavailable' : pending ? 'Waiting for microphone permission' : agentStatus ? agentStatus : analyser ? 'Microphone on. Local audio meter active.' : 'Microphone off')}
      </span>
    </div>
  );
}
