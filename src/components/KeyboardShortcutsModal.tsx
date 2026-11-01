import React, { useEffect, useRef } from 'react';
import { X, Keyboard, Mic } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUT_ITEMS = [
  { key: '[V]', action: 'Start / Stop Voice Dictation (`muse-voice-transcribe-1.0`)' },
  { key: '[SPACE]', action: 'Play / Pause Animatic Sequence with Spoken Narration' },
  { key: '[←] / [→]', action: 'Select Previous / Next Storyboard Shot & Read Status Aloud' },
  { key: '[Alt+←] / [Alt+→]', action: 'Move / Reorder Active Shot earlier or later in montage' },
  { key: '[ [ ] / [ ] ]', action: 'Trim / Extend Shot Duration by -0.5s or +0.5s (Pacing)' },
  { key: '[1] – [4]', action: 'Jump Directly to Shot 1 through Shot 4' },
  { key: '[N]', action: 'Narrate Active Shot Visual Description & Continuity State (`speechSynthesis`)' },
  { key: '[T]', action: 'Cycle Shot Takes / Revision Stack (Take 1, Take 2...)' },
  { key: '[Y]', action: 'Accept & Apply Proposed SAM 3.1 Continuity Fix on Active Shot' },
  { key: '[B]', action: 'Compare Before / After SAM 3.1 Repair (Interactive Split Wipe)' },
  { key: '[M]', action: 'Toggle SAM 3.1 Segmentation Bounding Box & Alpha Mask Overlay' },
  { key: '[A]', action: 'Run Full Sequence Continuity Audit (`muse-spark-1.3`)' },
  { key: '[G]', action: 'Regenerate Storyboard Sequence from Current Transcript (`muse-image-1.0`)' },
  { key: '[?]', action: 'Open / Close Accessible Keyboard & Voice Reference Dialog' },
];

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocusedElement.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-2xl bg-[#1E232B] border-2 border-[#4B5563] rounded-lg p-6 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-[#323A46] pb-4">
          <div className="flex items-center gap-2.5">
            <Keyboard className="w-6 h-6 text-[#38BDF8]" aria-hidden="true" />
            <h2 id="shortcuts-modal-title" className="text-2xl font-bold text-white">
              Accessible Keyboard &amp; Voice Controls
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close Keyboard Shortcuts Dialog"
            className="min-h-[44px] px-3 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-white flex items-center gap-1.5 text-sm font-semibold"
          >
            <span>Close</span>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SHORTCUT_ITEMS.map((item) => (
            <div
              key={item.key}
              className="p-3 bg-[#16191E] border border-[#323A46] rounded flex items-center justify-between gap-3"
            >
              <span className="text-sm text-[#E2E8F0]">{item.action}</span>
              <kbd className="px-2.5 py-1 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] border border-[#323A46] rounded whitespace-nowrap shrink-0">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="p-4 bg-[#16191E] border-2 border-[#323A46] rounded flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-[#34D399]">
            <Mic className="w-4 h-4" aria-hidden="true" />
            <span>Supported Natural Voice Directives (`muse-spark-1.3`)</span>
          </div>
          <p className="text-sm text-[#E2E8F0]">
            Speak or type phrases like: <code className="text-[#38BDF8]">&ldquo;Fix shot 2&rdquo;</code>,{' '}
            <code className="text-[#38BDF8]">&ldquo;Make the cup emerald across all shots&rdquo;</code>,{' '}
            <code className="text-[#38BDF8]">&ldquo;Narrate all shots&rdquo;</code>, or{' '}
            <code className="text-[#38BDF8]">&ldquo;Audit continuity&rdquo;</code>.
          </p>
        </div>
      </div>
    </div>
  );
};
