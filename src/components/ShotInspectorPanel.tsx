import {LocalGenerationPanel} from './LocalGenerationPanel';
import {isGeneratedImage} from '../services/localGeneration';
import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Volume2,
  Wand2,
  RotateCcw,
  Layers,
  History,
  Cpu,
  Sliders,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { ModelInvocationRecord, StoryboardShot } from '../types/framelock';

interface ShotInspectorPanelProps {
  onUseLocalImage: (shotId: string, imageUrl: string, prompt: string) => void;
  activeShot: StoryboardShot | null;
  showSamMaskOverlay: boolean;
  showBeforeComparison?: boolean;
  isProcessing: boolean;
  modelLogs: ModelInvocationRecord[];
  onToggleSamMaskOverlay: () => void;
  onToggleBeforeComparison?: () => void;
  onNarrateShot: (shot: StoryboardShot) => void;
  onApplyProposedFix: (shotId: string, customColor?: string) => void;
  onDisambiguateShot?: (shotId: string, selectedObjectId: string) => void;
  onSegmentObjectManual: (shotId: string, targetObject: string) => void;
  onRevertShotRevision: (shotId: string, revisionId: string) => void;
  onUpdateShotPrompt: (shotId: string, newPrompt: string, newDuration: number) => void;
}

const COLOR_SWATCH_OPTIONS = [
  { name: 'blue', label: 'Cobalt Blue', hex: '#2563EB' },
  { name: 'emerald', label: 'Emerald Green', hex: '#10B981' },
  { name: 'amber', label: 'Amber Gold', hex: '#F59E0B' },
  { name: 'red', label: 'Crimson Red', hex: '#DC2626' },
  { name: 'purple', label: 'Royal Violet', hex: '#7C3AED' },
  { name: 'white', label: 'Ceramic White', hex: '#E2E8F0' },
];

export const ShotInspectorPanel: React.FC<ShotInspectorPanelProps> = ({
  onUseLocalImage,
  activeShot,
  showSamMaskOverlay,
  showBeforeComparison = false,
  isProcessing,
  modelLogs,
  onToggleSamMaskOverlay,
  onToggleBeforeComparison,
  onNarrateShot,
  onApplyProposedFix,
  onDisambiguateShot,
  onSegmentObjectManual,
  onRevertShotRevision,
  onUpdateShotPrompt,
}) => {
  const [selectedFixColor, setSelectedFixColor] = useState<string>('blue');
  const [editedPrompt, setEditedPrompt] = useState<string>('');
  const [editedDuration, setEditedDuration] = useState<number>(3.5);
  const [lastSyncedPrompt, setLastSyncedPrompt] = useState('');
  const [lastSyncedShotId, setLastSyncedShotId] = useState<string | null>(null);

  if (activeShot && (activeShot.id !== lastSyncedShotId || activeShot.promptDescription !== lastSyncedPrompt)) {
    setLastSyncedShotId(activeShot.id);
    setLastSyncedPrompt(activeShot.promptDescription);
    setEditedPrompt(activeShot.promptDescription);
    setEditedDuration(activeShot.durationSeconds);
    if (activeShot.proposedFix?.targetColor) {
      setSelectedFixColor(activeShot.proposedFix.targetColor);
    }
  }

  if (!activeShot) {
    return (
      <aside
        aria-label="Shot Continuity Inspector"
        className="w-full xl:w-[360px] shrink-0 bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-5 flex flex-col justify-center items-center text-center gap-3"
      >
        <p className="text-base text-[#E2E8F0]">
          Select any storyboard frame using mouse, touch, or keyboard keys <kbd className="font-mono text-[#38BDF8]">[1-4]</kbd> to inspect continuity and SAM 3.1 masks.
        </p>
      </aside>
    );
  }

  const isMismatch = activeShot.status === 'mismatch';
  const isUncertain = activeShot.status === 'uncertain';
  const isRepaired = activeShot.currentImageUrl !== activeShot.originalImageUrl;
  const currentMask = activeShot.proposedFix?.mask;

  return (
    <aside
      aria-label={`Inspector for Shot ${activeShot.shotNumber}`}
      className="w-full xl:w-[360px] shrink-0 bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-5 flex flex-col gap-5"
    >
      <details className="generation-disclosure"><summary>Generate new media</summary><LocalGenerationPanel isProcessing={isProcessing} shotId={activeShot.id} shotNumber={activeShot.shotNumber} initialPrompt={activeShot.promptDescription} onUseImage={onUseLocalImage} /></details>
      {/* Top Shot Status Header */}
      <div className="flex flex-col gap-3 border-b border-[#323A46] pb-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-xs font-mono text-[#94A3B8] block">
              SELECTED SCENE
            </span>
            <h2 className="text-xl font-bold text-white">
              Scene {activeShot.shotNumber}
            </h2>
          </div>

          <button
            type="button"
            onClick={() => onNarrateShot(activeShot)}
            className="min-h-[44px] px-3.5 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-white text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Volume2 className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
            <span>Narrate</span>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-[#0F172A] text-[#38BDF8] rounded">
              [N]
            </kbd>
          </button>
        </div>

        {/* High-Contrast Status Banner */}
        {isGeneratedImage(activeShot.currentImageUrl) ? <p className="text-sm text-[#FDE047]">Generated image — continuity unreviewed. Sample masks cannot be applied to this image.</p> : isMismatch ? (
          <div
            role="region"
            aria-live="polite"
            aria-label="Continuity Discrepancy Alert"
            className="p-3.5 bg-[#16191E] border-2 border-[#F59E0B] rounded flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold text-[#FDE047]">
                <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0" aria-hidden="true" />
                <span>Continuity Discrepancy Flagged</span>
              </span>
              <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#FDE047] rounded">
                [Y] to Fix
              </kbd>
            </div>
            <p className="text-sm text-[#E2E8F0] leading-relaxed">
              {activeShot.discrepancyMessage}
            </p>
          </div>
        ) : isUncertain ? (
          <div
            role="region"
            aria-live="polite"
            aria-label="Continuity Ambiguity Alert"
            className="p-3.5 bg-[#16191E] border-2 border-[#38BDF8] rounded flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold text-[#38BDF8]">
                <HelpCircle className="w-5 h-5 text-[#38BDF8] shrink-0" aria-hidden="true" />
                <span>Ambiguous Occlusion (Uncertain)</span>
              </span>
              <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
                [Y] Confirm
              </kbd>
            </div>
            <p className="text-sm text-[#E2E8F0] leading-relaxed">
              {activeShot.discrepancyMessage}
            </p>
          </div>
        ) : (
          <div
            role="region"
            aria-live="polite"
            aria-label="Continuity Verified"
            className="p-3.5 bg-[#16191E] border-2 border-[#10B981] rounded flex items-center justify-between gap-2"
          >
            <span className="flex items-center gap-2 text-sm font-bold text-white">
              <CheckCircle2 className="w-5 h-5 text-[#10B981] shrink-0" aria-hidden="true" />
              <span>Continuity Rules Verified</span>
            </span>
            <span className="text-xs font-mono text-[#34D399]">FIXTURE RULES</span>
          </div>
        )}

        {/* Role 3 Pixel-Diff Verification Proof Card */}
        {activeShot.pixelVerification && (() => {
          const driftClean =
            activeShot.pixelVerification.passed ??
            activeShot.pixelVerification.changedOutsideMask === 0;
          return (
            <div
              role="region"
              aria-label="Outside-Mask Pixel Drift Verification"
              className={`p-3 bg-[#16191E] border ${
                driftClean ? 'border-[#10B981]' : 'border-[#F59E0B]'
              } rounded flex flex-col gap-1.5 text-xs font-mono`}
            >
              <div
                className={`flex items-center justify-between ${
                  driftClean ? 'text-[#34D399]' : 'text-[#FDE047]'
                } font-bold`}
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {driftClean
                      ? '0 OUTSIDE-MASK PIXEL DRIFT'
                      : `${activeShot.pixelVerification.changedOutsideMask} OUTSIDE-MASK PIXELS CHANGED`}
                  </span>
                </span>
                <span>{activeShot.pixelVerification.outsideDriftPercent}% DRIFT</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[#E2E8F0] pt-1">
                <span>Inside Mask Changed:</span>
                <span className="text-right font-bold">
                  {activeShot.pixelVerification.changedInsideMask.toLocaleString()} px
                </span>
                <span>Outside Mask Changed:</span>
                <span
                  className={`text-right font-bold ${
                    driftClean ? 'text-[#34D399]' : 'text-[#FDE047]'
                  }`}
                >
                  {activeShot.pixelVerification.changedOutsideMask} px
                </span>
                <span>Mask Reference:</span>
                <span className="text-right text-[#38BDF8] truncate">
                  {activeShot.pixelVerification.maskRef}
                </span>
                <span>Rule Revision:</span>
                <span className="text-right">Rev {activeShot.pixelVerification.ruleRevision}</span>
              </div>
              {isRepaired && onToggleBeforeComparison && (
                <button
                  type="button"
                  onClick={onToggleBeforeComparison}
                  aria-pressed={showBeforeComparison}
                  className="mt-1.5 min-h-[36px] w-full px-2.5 py-1 bg-[#1E232B] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-white flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-[#38BDF8]" aria-hidden="true" />
                    <span>
                      {showBeforeComparison ? 'Showing BEFORE Repair' : 'Compare Before / After'}
                    </span>
                  </span>
                  <kbd className="text-[#38BDF8]">[B]</kbd>
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* SAM 3.1 Segmentation & Pixel Recolor Studio */}
      {!isGeneratedImage(activeShot.currentImageUrl) && <section aria-labelledby="sam-studio-heading" className="flex flex-col gap-3 border-b border-[#323A46] pb-4">
        <div className="flex items-center justify-between">
          <h3 id="sam-studio-heading" className="text-base font-semibold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
            <span>Anchor selection</span>
          </h3>
          <button
            type="button"
            onClick={onToggleSamMaskOverlay}
            aria-pressed={showSamMaskOverlay}
            className="min-h-[36px] px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-white flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <span>{showSamMaskOverlay ? 'Hide Mask' : 'Show Mask'}</span>
            <kbd className="text-[#38BDF8]">[M]</kbd>
          </button>
        </div>

        {currentMask ? (
          <div className="p-3 bg-[#16191E] border border-[#323A46] rounded flex flex-col gap-1.5 text-xs font-mono text-[#E2E8F0] tabular-nums">
            <div className="flex items-center justify-between gap-2">
              <span>TARGET: &ldquo;{activeShot.proposedFix?.targetObject || 'cup'}&rdquo;</span>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                  currentMask.provenance === 'live-sam-3.1'
                    ? 'border border-[#10B981] bg-[#064E3B] text-[#34D399]'
                    : 'border border-[#F59E0B] bg-[#451A03] text-[#FDE047]'
                }`}
              >
                {currentMask.provenance === 'live-sam-3.1' ? 'LIVE SAM 3.1' : 'OFFLINE FIXTURE'}
              </span>
            </div>
            <div className="text-[#34D399]">Fixture mask / IoU not measured</div>
            <div className="text-[#38BDF8] truncate">
              MASK REF: {currentMask.maskRef}
            </div>
            <div className="text-[#94A3B8]">
              BBOX: X:{currentMask.box.x}% Y:{currentMask.box.y}% W:{currentMask.box.width}% H:{currentMask.box.height}%
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              onSegmentObjectManual(activeShot.id, activeShot.proposedFix?.targetObject || 'cup')
            }
            disabled={isProcessing}
            className="min-h-[44px] w-full px-3 py-2 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors"
          >
            <Layers className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
            <span>Run SAM 3.1 Object Segmentation</span>
          </button>
        )}

        {activeShot.status === 'uncertain' && (
          <div
            role="region"
            aria-label="Ambiguity Resolution"
            className="p-3 bg-[#16191E] border-2 border-[#38BDF8] rounded flex flex-col gap-2"
          >
            <span className="text-sm font-bold text-[#38BDF8]">Ambiguity Resolution</span>
            <p className="text-sm text-[#E2E8F0] leading-relaxed">
              Select a candidate mask to lock this selection and resolve the uncertain shot.
            </p>
            {(activeShot.proposedFix?.candidates ?? []).length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {(activeShot.proposedFix?.candidates ?? []).map((candidate, idx) => (
                  <button
                    key={candidate.objectId}
                    type="button"
                    aria-label={`Lock candidate object ${candidate.objectId}`}
                    onClick={() => {
                      if (onDisambiguateShot) {
                        onDisambiguateShot(activeShot.id, candidate.objectId);
                      } else {
                        onApplyProposedFix(activeShot.id, selectedFixColor);
                      }
                    }}
                    disabled={isProcessing}
                    className={`min-h-[40px] w-full px-3 py-1.5 font-bold text-xs font-mono rounded transition-colors disabled:opacity-50 flex items-center justify-between ${
                      idx === 0
                        ? 'bg-[#38BDF8] hover:bg-[#7DD3FC] active:bg-[#0284C7] text-[#121417]'
                        : 'bg-[#1E232B] border border-[#38BDF8] hover:bg-[#0F172A] text-[#E2E8F0]'
                    }`}
                  >
                    <span>
                      {idx === 0
                        ? `Confirm Primary Candidate (${candidate.objectId})`
                        : `Lock Alternate Candidate (${candidate.objectId})`}
                    </span>
                    <span>{(candidate.confidence * 100).toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const candidateObjectId = activeShot.proposedFix?.mask?.objectId ?? '0';
                  if (onDisambiguateShot) {
                    onDisambiguateShot(activeShot.id, candidateObjectId);
                  } else {
                    onApplyProposedFix(activeShot.id, selectedFixColor);
                  }
                }}
                disabled={isProcessing}
                className="min-h-[44px] w-full px-3 py-2 bg-[#38BDF8] hover:bg-[#7DD3FC] active:bg-[#0284C7] text-[#121417] font-bold text-sm rounded transition-colors disabled:opacity-50"
              >
                Confirm Primary Candidate Mask [Y]
              </button>
            )}
          </div>
        )}

        {/* Target Color Swatch Selector for Masked Recolor */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-mono text-[#E2E8F0]">
            SELECT TARGET CONTINUITY COLOR:
          </span>
          <div className="grid grid-cols-3 gap-2">
            {COLOR_SWATCH_OPTIONS.map((swatch) => {
              const isSelected = selectedFixColor === swatch.name;
              return (
                <button
                  key={swatch.name}
                  type="button"
                  onClick={() => setSelectedFixColor(swatch.name)}
                  aria-pressed={isSelected}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded border-2 flex items-center gap-2 text-xs font-semibold transition-colors ${
                    isSelected
                      ? 'bg-[#121417] border-[#38BDF8] text-white'
                      : 'bg-[#16191E] border-[#323A46] text-[#E2E8F0] hover:border-[#4B5563]'
                  }`}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-xs border border-white shrink-0"
                    style={{ backgroundColor: swatch.hex }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{swatch.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary Action: Apply SAM 3.1 Masked Recolor */}
        <button
          type="button"
          onClick={() => onApplyProposedFix(activeShot.id, selectedFixColor)}
          disabled={isProcessing}
          className="min-h-[48px] w-full px-4 py-2.5 bg-[#38BDF8] hover:bg-[#7DD3FC] active:bg-[#0284C7] text-[#121417] font-bold text-sm rounded flex items-center justify-between transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2 whitespace-nowrap">
            <Wand2 className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
            <span>
              Apply SAM 3.1 Recolor ({selectedFixColor.toUpperCase()})
            </span>
          </span>
          <kbd className="px-2 py-0.5 text-xs font-mono font-bold bg-[#0F172A] text-[#38BDF8] rounded">
            [Y]
          </kbd>
        </button>
      </section>}

      {/* Shot Prompt & Timing Editor (`muse-image-1.0`) */}
      <section aria-labelledby="shot-params-heading" className="flex flex-col gap-2.5 border-b border-[#323A46] pb-4">
        <h3 id="shot-params-heading" className="text-base font-semibold text-white flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
          <span>Shot Prompt &amp; Duration</span>
        </h3>
        <label htmlFor="inspector-prompt-input" className="sr-only">
          Shot Prompt Description
        </label>
        <textarea
          id="inspector-prompt-input"
          rows={2}
          value={editedPrompt}
          onChange={(e) => setEditedPrompt(e.target.value)}
          className="w-full p-2.5 bg-[#16191E] border-2 border-[#323A46] rounded text-sm text-white focus:border-[#38BDF8]"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="inspector-duration-input" className="text-xs font-mono text-[#E2E8F0]">
              DURATION (S):
            </label>
            <input
              id="inspector-duration-input"
              type="number"
              min={1}
              max={15}
              step={0.5}
              value={editedDuration}
              onChange={(e) => setEditedDuration(parseFloat(e.target.value) || 3.5)}
              className="w-20 min-h-[38px] px-2 bg-[#16191E] border-2 border-[#323A46] rounded text-sm font-mono text-white tabular-nums"
            />
          </div>
          <button
            type="button"
            onClick={() => onUpdateShotPrompt(activeShot.id, editedPrompt, editedDuration)}
            className="min-h-[38px] px-3 py-1.5 bg-[#16191E] border-2 border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-semibold text-white transition-colors whitespace-nowrap"
          >
            Update Shot
          </button>
        </div>
      </section>

      {/* Revision History Stack */}
      <section aria-labelledby="revision-history-heading" className="flex flex-col gap-2.5 border-b border-[#323A46] pb-4">
        <h3 id="revision-history-heading" className="text-base font-semibold text-white flex items-center gap-2">
          <History className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
          <span>Frame Revision History ({activeShot.revisions.length})</span>
        </h3>
        <ul className="flex flex-col gap-2 max-h-36 overflow-y-auto pr-1" role="list">
          {activeShot.revisions.map((rev, idx) => {
            const isCurrent = rev.imageUrl === activeShot.currentImageUrl;
            return (
              <li
                key={rev.revisionId}
                className={`p-2.5 rounded border flex items-center justify-between gap-2 ${
                  isCurrent
                    ? 'bg-[#16191E] border-[#38BDF8]'
                    : 'bg-[#121417] border-[#323A46]'
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-xs font-mono font-bold text-white">
                    Rev {idx + 1}: {rev.actionApplied}
                  </span>
                  <span className="text-xs font-mono text-[#94A3B8] tabular-nums">
                    {new Date(rev.timestamp).toLocaleTimeString()}
                    {rev.pixelVerification && (
                      <span className="block">
                        Mask check:{' '}
                        {(rev.pixelVerification.passed ??
                        rev.pixelVerification.changedOutsideMask === 0)
                          ? 'PASS'
                          : 'FAIL'}{' '}
                        /{' '}
                        {rev.pixelVerification.changedOutsideMask ??
                          rev.pixelVerification.changedOutside}{' '}
                        outside pixels changed /{' '}
                        {rev.pixelVerification.changedInsideMask ??
                          rev.pixelVerification.changedInside}{' '}
                        selected pixels edited
                      </span>
                    )}
                  </span>
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => onRevertShotRevision(activeShot.id, rev.revisionId)}
                    className="min-h-[34px] px-2.5 py-1 bg-[#1E232B] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#38BDF8] flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Restore</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Meta Model API Execution Log */}
      <section aria-labelledby="model-telemetry-heading" className="flex flex-col gap-2">
        <h3 id="model-telemetry-heading" className="text-sm font-semibold text-[#E2E8F0] flex items-center gap-2">
          <Cpu className="w-4 h-4 text-[#38BDF8]" aria-hidden="true" />
          <span>Offline Fixture Pipeline Log</span>
        </h3>
        <div className="bg-[#16191E] border border-[#323A46] rounded p-2.5 max-h-36 overflow-y-auto flex flex-col gap-2 font-mono text-xs">
          {modelLogs.slice(0, 5).map((log) => (
            <div key={log.id} className="border-b border-[#323A46]/60 pb-1.5 last:border-none last:pb-0">
              <div className="flex items-center justify-between text-[#38BDF8]">
                <span className="font-bold">{log.model}</span>
                <span className="text-[#94A3B8] tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
              <div className="text-[#E2E8F0] leading-snug">{log.summary}</div>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
};
