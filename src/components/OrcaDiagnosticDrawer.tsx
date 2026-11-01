import React, { useState, useEffect } from 'react';
import { orcaTracker, type OrcaLogEntry } from '../services/orcaTracker';
import { Bug, X, Copy, Trash2, CheckCircle2, AlertTriangle, AlertCircle, Terminal, Globe } from 'lucide-react';
import { Button } from './ui/button';

export const OrcaDiagnosticDrawer: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<OrcaLogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'error' | 'network' | 'generation'>('all');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLogs(orcaTracker.getLogs());
    return orcaTracker.subscribe((updated) => setLogs(updated));
  }, []);

  const errors = logs.filter(l => l.level === 'error');
  const filtered = logs.filter(l => {
    if (filter === 'error') return l.level === 'error';
    if (filter === 'network') return l.level === 'network' || l.category === 'network';
    if (filter === 'generation') return l.category === 'generation' || l.category === 'sam';
    return true;
  });

  const handleCopyDump = () => {
    navigator.clipboard.writeText(orcaTracker.dump());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      {/* Floating Status Pill */}
      <div className="fixed bottom-3 right-4 z-50 flex items-center gap-2">
        <button
          onClick={() => setIsOpen((prev) => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-medium shadow-lg transition-all border ${
            errors.length > 0
              ? 'bg-[#450a0a]/90 border-[#ef4444] text-[#fca5a5] hover:bg-[#7f1d1d]'
              : 'bg-[#0f172a]/90 border-[#334155] text-[#94a3b8] hover:bg-[#1e293b]'
          }`}
          aria-label="Open Orca Diagnostic Tracker"
        >
          <Bug size={14} className={errors.length > 0 ? 'text-[#ef4444] animate-pulse' : 'text-[#38bdf8]'} />
          <span>Orca Tracker:</span>
          {errors.length > 0 ? (
            <span className="font-bold text-[#f87171]">{errors.length} error{errors.length > 1 ? 's' : ''}</span>
          ) : (
            <span className="text-[#34d399]">Healthy</span>
          )}
          <span className="text-[10px] opacity-60">({logs.length})</span>
        </button>
      </div>

      {/* Drawer Overlay */}
      {isOpen && (
        <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-[#090d16] border-l border-[#1e293b] shadow-2xl flex flex-col text-[#e2e8f0]">
          {/* Header */}
          <div className="p-4 border-b border-[#1e293b] flex items-center justify-between bg-[#0f172a]/80">
            <div className="flex items-center gap-2">
              <Bug size={18} className="text-[#38bdf8]" />
              <div>
                <h3 className="text-sm font-semibold text-white tracking-wide">Orca Browser Diagnostics</h3>
                <p className="text-[11px] text-[#94a3b8] font-mono">Real-time error & network telemetry for Orca Browser</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyDump}
                className="h-7 text-xs gap-1 border-[#334155] hover:bg-[#1e293b]"
              >
                {copied ? <CheckCircle2 size={12} className="text-[#34d399]" /> : <Copy size={12} />}
                {copied ? 'Copied Dump' : 'Copy Dump'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => orcaTracker.clear()}
                className="h-7 text-xs gap-1 text-[#94a3b8] hover:text-[#ef4444]"
              >
                <Trash2 size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="size-7 text-[#94a3b8] hover:text-white"
              >
                <X size={15} />
              </Button>
            </div>
          </div>

          {/* Quick Filter Tabs */}
          <div className="px-4 py-2 bg-[#0d131f] border-b border-[#1e293b] flex items-center gap-2 text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded ${filter === 'all' ? 'bg-[#1e293b] text-white font-semibold' : 'text-[#94a3b8] hover:text-white'}`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => setFilter('error')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 ${filter === 'error' ? 'bg-[#7f1d1d]/50 text-[#fca5a5] font-semibold' : 'text-[#94a3b8] hover:text-white'}`}
            >
              <AlertCircle size={12} className="text-[#ef4444]" />
              Errors ({errors.length})
            </button>
            <button
              onClick={() => setFilter('network')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 ${filter === 'network' ? 'bg-[#1e293b] text-white font-semibold' : 'text-[#94a3b8] hover:text-white'}`}
            >
              <Globe size={12} />
              Network
            </button>
            <button
              onClick={() => setFilter('generation')}
              className={`px-2.5 py-1 rounded flex items-center gap-1 ${filter === 'generation' ? 'bg-[#1e293b] text-white font-semibold' : 'text-[#94a3b8] hover:text-white'}`}
            >
              <Terminal size={12} />
              AI & SAM
            </button>
          </div>

          {/* Log Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 font-mono text-xs">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-[#64748b]">
                <CheckCircle2 size={32} className="mx-auto mb-2 text-[#34d399]/60" />
                <p>No issues logged matching this filter.</p>
              </div>
            ) : (
              filtered.map((log) => (
                <div
                  key={log.id}
                  className={`p-2.5 rounded border ${
                    log.level === 'error'
                      ? 'bg-[#1c0e11] border-[#7f1d1d] text-[#fecaca]'
                      : log.level === 'warn'
                      ? 'bg-[#1c160e] border-[#78350f] text-[#fef08a]'
                      : log.level === 'network'
                      ? 'bg-[#0f172a] border-[#1e293b] text-[#cbd5e1]'
                      : 'bg-[#131b2e] border-[#1e293b] text-[#e2e8f0]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-[#94a3b8] mb-1">
                    <span className="flex items-center gap-1.5">
                      {log.level === 'error' ? (
                        <AlertCircle size={11} className="text-[#ef4444]" />
                      ) : log.level === 'warn' ? (
                        <AlertTriangle size={11} className="text-[#f59e0b]" />
                      ) : log.level === 'network' ? (
                        <Globe size={11} className="text-[#38bdf8]" />
                      ) : (
                        <Terminal size={11} className="text-[#a78bfa]" />
                      )}
                      <span className="uppercase font-bold tracking-wider">{log.category}</span>
                    </span>
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-[12px] break-words whitespace-pre-wrap">{log.message}</p>
                  {log.details && (
                    <details className="mt-1.5 text-[11px] text-[#94a3b8]">
                      <summary className="cursor-pointer text-[10px] text-[#64748b] hover:text-[#94a3b8]">View Details Payload</summary>
                      <pre className="mt-1 p-2 bg-[#06090e] rounded overflow-x-auto text-[#cbd5e1]">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    </details>
                  )}
                  {log.stack && (
                    <details className="mt-1 text-[10px] text-[#f87171]">
                      <summary className="cursor-pointer text-[#ef4444] hover:underline">Stack Trace</summary>
                      <pre className="mt-1 p-2 bg-[#06090e] rounded overflow-x-auto text-[#fca5a5]">
                        {log.stack}
                      </pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
};
