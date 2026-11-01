import React, { useState } from 'react';
import { Plus, CheckCircle2 } from 'lucide-react';
import { ContinuityRule, DirectorPresetScenario } from '../types/framelock';
import { DIRECTOR_PRESETS } from '../services/metaModels';

interface ProjectRulesPanelProps {
  rules: ContinuityRule[];
  activePresetId: string;
  onSelectPreset: (preset: DirectorPresetScenario) => void;
  onAddOrUpdateRule: (targetObject: string, expectedValue: string) => void;
}

/** Story presets and continuity rules. Direction input and voice live in the Create composer. */
export const ProjectRulesPanel: React.FC<ProjectRulesPanelProps> = ({
  rules,
  activePresetId,
  onSelectPreset,
  onAddOrUpdateRule,
}) => {
  const [newRuleObject, setNewRuleObject] = useState('cup');
  const [newRuleColor, setNewRuleColor] = useState('blue');
  const [showAddRule, setShowAddRule] = useState(false);

  const handleRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleObject.trim() || !newRuleColor.trim()) return;
    onAddOrUpdateRule(newRuleObject.trim().toLowerCase(), newRuleColor.trim().toLowerCase());
    setShowAddRule(false);
  };

  return (
    <aside
      aria-label="Story presets and continuity rules"
      className="w-full xl:w-[340px] shrink-0 flex flex-col gap-5 bg-[#1E232B] border-2 border-[#323A46] rounded-lg p-5"
    >
      {/* Preset Sequence Selector */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#323A46]">
        <label htmlFor="preset-scenario-select" className="text-sm font-semibold text-[#E2E8F0]">
          Director Script Sequence
        </label>
        <select
          id="preset-scenario-select"
          value={activePresetId}
          onChange={(e) => {
            const found = DIRECTOR_PRESETS.find((p) => p.id === e.target.value);
            if (found) onSelectPreset(found);
          }}
          className="min-h-[44px] w-full px-3 py-2 bg-[#16191E] border-2 border-[#323A46] rounded text-white text-sm font-medium focus:border-[#38BDF8]"
        >
          {DIRECTOR_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.title} ({preset.genre})
            </option>
          ))}
        </select>
      </div>

      {/* Extracted Continuity Rules (`muse-spark-1.3`) */}
      <section aria-labelledby="continuity-rules-heading" className="flex flex-col gap-3 pt-2 border-t border-[#323A46]">
        <div className="flex items-center justify-between">
          <h3 id="continuity-rules-heading" className="text-base font-semibold text-white">
            Active Continuity Rules
          </h3>
          <button
            type="button"
            onClick={() => setShowAddRule((prev) => !prev)}
            className="min-h-[36px] px-2.5 py-1 bg-[#16191E] border border-[#4B5563] hover:border-[#38BDF8] rounded text-xs font-mono text-[#38BDF8] flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Set Rule</span>
          </button>
        </div>

        {showAddRule && (
          <form onSubmit={handleRuleSubmit} className="p-3 bg-[#16191E] border-2 border-[#4B5563] rounded flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="rule-obj-select" className="block text-xs font-mono text-[#E2E8F0] mb-1">
                  Target Prop
                </label>
                <select
                  id="rule-obj-select"
                  value={newRuleObject}
                  onChange={(e) => setNewRuleObject(e.target.value)}
                  className="w-full min-h-[38px] px-2 bg-[#121417] border border-[#4B5563] rounded text-sm text-white"
                >
                  <option value="cup">cup</option>
                  <option value="umbrella">umbrella</option>
                  <option value="jacket">jacket</option>
                </select>
              </div>
              <div>
                <label htmlFor="rule-color-select" className="block text-xs font-mono text-[#E2E8F0] mb-1">
                  Expected Color
                </label>
                <select
                  id="rule-color-select"
                  value={newRuleColor}
                  onChange={(e) => setNewRuleColor(e.target.value)}
                  className="w-full min-h-[38px] px-2 bg-[#121417] border border-[#4B5563] rounded text-sm text-white"
                >
                  <option value="blue">blue</option>
                  <option value="emerald">emerald</option>
                  <option value="amber">amber</option>
                  <option value="red">red</option>
                  <option value="purple">purple</option>
                  <option value="white">white</option>
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="min-h-[40px] w-full bg-[#38BDF8] text-[#121417] font-semibold text-sm rounded hover:bg-[#7DD3FC] transition-colors"
            >
              Enforce Rule &amp; Re-Audit Shots
            </button>
          </form>
        )}

        <ul className="flex flex-col gap-2" role="list">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="p-3 bg-[#16191E] border border-[#323A46] rounded flex items-start justify-between gap-2"
            >
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-white font-mono">
                  {rule.targetObject}.{rule.property} = &ldquo;{rule.expectedValue}&rdquo;
                </div>
                <div className="text-xs text-[#E2E8F0] flex items-center gap-1.5">
                  <span>Scope: {rule.scope === 'all_shots' ? 'All Shots' : 'Single Shot'}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">Rev {rule.revision}</span>
                </div>
              </div>
              <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
};
