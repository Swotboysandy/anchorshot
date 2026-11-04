/**
 * Dedicated Generation History Panel
 * Reference pins (docs/reference-repositories.json):
 * - shadcn-ui (https://github.com/shadcn-ui/ui @ b8d7baa15b1dca5716f13153e63795fc3d741f6b, MIT): Button/Input/Card list item layout
 * - opencut (https://github.com/OpenCut-app/OpenCut @ e668010778568641babef2cc40be4703ae6916d6, MIT): Media asset browser & thumbnail preview strip organization
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Film, History, Image as ImageIcon, Layers, Play, Plus, RotateCcw, Search, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import {
  describeGenerationPrompt,
  formatGenerationTimestamp,
  localAsset,
  localRequest,
  type LocalJob,
} from '../services/localGeneration';
import type { StoryboardShot } from '../types/framelock';

export interface GenerationHistoryEntry {
  id: string;
  jobId?: string;
  kind: 'image' | 'video';
  title: string;
  subject: string;
  framing?: string;
  setting?: string;
  cast: string[];
  identityKey: string;
  prompt: string;
  createdAt: string;
  formattedDate: string;
  thumbnailUrl: string;
  videoUrl?: string;
  durationSeconds?: number;
  model?: string;
  sequenceId?: string;
}

export interface GenerationSequenceGroup {
  id: string;
  title: string;
  createdAt: string;
  formattedDate: string;
  entries: GenerationHistoryEntry[];
}

interface GenerationHistoryPanelProps {
  shots: StoryboardShot[];
  activeShot: StoryboardShot | null;
  isProcessing: boolean;
  compact?: boolean;
  onRevisitEntry: (entry: GenerationHistoryEntry, mode: 'replace-active' | 'append-shot') => void;
  onRestoreSequence?: (entries: GenerationHistoryEntry[], sequenceTitle: string) => void;
}

export function buildHistoryEntries(
  jobs: LocalJob[],
  shots: StoryboardShot[] = []
): { entries: GenerationHistoryEntry[]; sequences: GenerationSequenceGroup[] } {
  const completedJobs = jobs.filter((job) => job.status === 'completed');
  const seenIds = new Set<string>();
  const rawEntries: GenerationHistoryEntry[] = [];

  for (const job of completedJobs) {
    seenIds.add(job.id);
    const descriptor = describeGenerationPrompt(job.prompt, job.kind);
    const createdAt = job.createdAt ?? '';
    const thumbnailUrl =
      job.kind === 'image'
        ? localAsset(job, 'generated-image.png')
        : localAsset(job, 'frame-000.png');
    const videoUrl = job.kind === 'video' ? localAsset(job, 'generated-video.mp4') : undefined;
    const durationSeconds =
      job.report && !('rawChangedOutside' in job.report) && typeof job.report.seconds === 'number'
        ? job.report.seconds
        : job.kind === 'video'
        ? 3.8
        : undefined;
    const model =
      job.report && !('rawChangedOutside' in job.report) && typeof job.report.model === 'string'
        ? job.report.model
        : job.kind === 'video'
        ? 'Wan 2.2 / AnimateDiff'
        : 'SD 1.5';

    rawEntries.push({
      id: job.id,
      jobId: job.id,
      kind: job.kind,
      title: descriptor.title,
      subject: descriptor.subject,
      framing: descriptor.framing,
      setting: descriptor.setting,
      cast: descriptor.cast,
      identityKey: descriptor.identityKey,
      prompt: job.prompt,
      createdAt,
      formattedDate: formatGenerationTimestamp(createdAt),
      thumbnailUrl,
      videoUrl,
      durationSeconds,
      model,
    });
  }

  // Include any generated or revised shots in the current project that aren't already represented by jobId
  for (const shot of shots) {
    for (const rev of shot.revisions ?? []) {
      const revKey = rev.generatedJobId || rev.revisionId;
      if (!revKey || seenIds.has(revKey)) continue;
      if (shot.mediaSource === 'sample' && rev.mediaSource !== 'generated' && shot.revisions.length <= 1) continue;
      seenIds.add(revKey);
      const kind: 'image' | 'video' = rev.videoUrl ? 'video' : 'image';
      const descriptor = describeGenerationPrompt(shot.promptDescription || rev.actionApplied, kind);
      const isoDate = new Date(rev.timestamp || Date.now()).toISOString();
      rawEntries.push({
        id: rev.revisionId,
        jobId: rev.generatedJobId,
        kind,
        title: `${descriptor.title} (Scene ${shot.shotNumber})`,
        subject: descriptor.subject,
        framing: descriptor.framing,
        setting: descriptor.setting,
        cast: descriptor.cast,
        identityKey: descriptor.identityKey,
        prompt: shot.promptDescription,
        createdAt: isoDate,
        formattedDate: formatGenerationTimestamp(isoDate),
        thumbnailUrl: rev.imageUrl || shot.currentImageUrl,
        videoUrl: rev.videoUrl,
        durationSeconds: shot.durationSeconds,
        model: rev.actionApplied?.split(';')[0] || 'Studio generation',
      });
    }
  }

  // Sort newest first
  rawEntries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Group consecutive multi-shot video generations that belong to the same scene run
  // (e.g. same IDENTITY LOCK block or generated within 6 minutes of each other)
  const sequences: GenerationSequenceGroup[] = [];
  const videoEntriesChronological = [...rawEntries]
    .filter((e) => e.kind === 'video' && e.jobId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let currentBucket: GenerationHistoryEntry[] = [];
  const flushBucket = () => {
    if (currentBucket.length >= 2) {
      const seqId = `seq-${currentBucket[0].id}`;
      const first = currentBucket[0];
      const latest = currentBucket[currentBucket.length - 1];
      const castLabel = first.cast.length > 0 ? first.cast.slice(0, 2).join(' & ') : '';
      const baseTitle = castLabel
        ? `${castLabel} — ${ first.subject }`
        : first.subject;
      for (const item of currentBucket) {
        item.sequenceId = seqId;
      }
      sequences.push({
        id: seqId,
        title: `${baseTitle} (${currentBucket.length} scenes)`,
        createdAt: latest.createdAt,
        formattedDate: latest.formattedDate,
        entries: [...currentBucket],
      });
    }
    currentBucket = [];
  };

  for (const entry of videoEntriesChronological) {
    if (currentBucket.length === 0) {
      currentBucket.push(entry);
      continue;
    }
    const prev = currentBucket[currentBucket.length - 1];
    const timeDiffMs = Math.abs(Date.parse(entry.createdAt) - Date.parse(prev.createdAt));
    const sameIdentity =
      Boolean(entry.identityKey) &&
      entry.identityKey === prev.identityKey &&
      entry.prompt.includes('IDENTITY LOCK');
    const closeInTime = Number.isFinite(timeDiffMs) && timeDiffMs <= 6 * 60 * 1000;

    if (currentBucket.length < 4 && (sameIdentity || closeInTime)) {
      currentBucket.push(entry);
    } else {
      flushBucket();
      currentBucket.push(entry);
    }
  }
  flushBucket();

  sequences.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { entries: rawEntries, sequences };
}

export function GenerationHistoryPanel({
  shots,
  activeShot,
  isProcessing,
  compact = false,
  onRevisitEntry,
  onRestoreSequence,
}: GenerationHistoryPanelProps) {
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'sequences' | 'video' | 'image'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [actionFeedback, setActionFeedback] = useState<string>('');

  const requestVersionRef = React.useRef(0);

  const fetchHistory = useCallback(async (silent = false) => {
    const version = ++requestVersionRef.current;
    if (!silent) setLoading(true);
    try {
      const recent = await localRequest<LocalJob[]>('/jobs');
      if (requestVersionRef.current !== version) return;
      setJobs(recent);
      setError('');
    } catch (err) {
      if (requestVersionRef.current !== version) return;
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Could not load generation history.');
      }
    } finally {
      if (requestVersionRef.current === version && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory(false);
    return () => {
      requestVersionRef.current++;
    };
  }, [fetchHistory, shots.length]);

  const { entries, sequences } = useMemo(
    () => buildHistoryEntries(jobs, shots),
    [jobs, shots]
  );

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filter === 'video' && entry.kind !== 'video') return false;
      if (filter === 'image' && entry.kind !== 'image') return false;
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.subject.toLowerCase().includes(q) ||
        (entry.setting?.toLowerCase().includes(q) ?? false) ||
        entry.cast.some((c) => c.toLowerCase().includes(q)) ||
        entry.prompt.toLowerCase().includes(q)
      );
    });
  }, [entries, filter, searchQuery]);

  useEffect(() => {
    if (!selectedId && filteredEntries.length > 0) {
      setSelectedId(filteredEntries[0].id);
    } else if (selectedId && !entries.some((e) => e.id === selectedId) && filteredEntries.length > 0) {
      setSelectedId(filteredEntries[0].id);
    }
  }, [filteredEntries, entries, selectedId]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? filteredEntries[0] ?? null,
    [entries, filteredEntries, selectedId]
  );

  const selectedSequence = useMemo(
    () =>
      selectedEntry?.sequenceId
        ? sequences.find((seq) => seq.id === selectedEntry.sequenceId) ?? null
        : null,
    [selectedEntry, sequences]
  );

  const activeJobIdsInStoryboard = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shots) {
      if (s.generatedJobId) map.set(s.generatedJobId, s.shotNumber);
      map.set(s.currentImageUrl, s.shotNumber);
    }
    return map;
  }, [shots]);

  const handleApply = (entry: GenerationHistoryEntry, mode: 'replace-active' | 'append-shot') => {
    onRevisitEntry(entry, mode);
    const targetLabel =
      mode === 'append-shot'
        ? `Added "${entry.subject}" as Scene ${shots.length + 1}.`
        : activeShot
        ? `Loaded "${entry.subject}" into Scene ${activeShot.shotNumber}.`
        : `Loaded "${entry.subject}" into your storyboard.`;
    setActionFeedback(targetLabel);
  };

  const handleRestoreSeq = (seq: GenerationSequenceGroup) => {
    if (!onRestoreSequence) return;
    onRestoreSequence(seq.entries, seq.title);
    setActionFeedback(`Restored ${seq.entries.length} scenes from "${seq.title}".`);
  };

  return (
    <section
      aria-label="Generation history"
      className="generation-history-panel flex flex-col gap-3 min-w-0 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow !mb-1">VERSION ARCHIVE</p>
          <h2 className="text-lg font-medium text-white flex items-center gap-2 m-0">
            <History size={17} aria-hidden="true" />
            Generation history
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="sample-badge" aria-label={`${entries.length} saved generations`}>
            {entries.length} {entries.length === 1 ? 'version' : 'versions'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => void fetchHistory(false)}
            disabled={loading}
            aria-label="Refresh generation history"
            title="Refresh generation history"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      <p className="text-xs text-[#A3A3A3] m-0 leading-relaxed">
        Browse previous video and frame generations with their creation time and preview. Select any version to inspect or revisit it in your storyboard.
      </p>

      {/* Search & Filter Controls */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            size={14}
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888] pointer-events-none"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by scene name, cast, or setting..."
            aria-label="Search generation history"
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#141414] border border-[#2E2E2E] text-xs text-white placeholder:text-[#777] focus:outline-none focus:border-[#777]"
          />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter generations by type">
          {(
            [
              ['all', `All (${entries.length})`],
              ...(sequences.length > 0 ? [['sequences', `Sequences (${sequences.length})`]] : []),
              ['video', `Videos (${entries.filter((e) => e.kind === 'video').length})`],
              ['image', `Images (${entries.filter((e) => e.kind === 'image').length})`],
            ] as Array<['all' | 'sequences' | 'video' | 'image', string]>
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              variant={filter === key ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs rounded-full"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {actionFeedback && (
        <p
          role="status"
          className="text-xs px-3 py-2 rounded-lg bg-[#1A1A1A] border border-[#3A3A3A] text-white m-0"
        >
          {actionFeedback}
        </p>
      )}

      {error && (
        <p role="alert" className="text-xs px-3 py-2 rounded-lg bg-[#1F1616] border border-[#522] text-[#F5A5A5] m-0">
          {error}
        </p>
      )}

      {/* Selected Entry Live Preview & Revisit Controls */}
      {selectedEntry && filter !== 'sequences' && (
        <div
          className="rounded-xl border border-[#333] bg-[#141414] p-3 flex flex-col gap-2.5"
          aria-label={`Selected generation preview: ${selectedEntry.title}`}
        >
          <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-black border border-[#262626]">
            {selectedEntry.kind === 'video' && selectedEntry.videoUrl ? (
              <video
                key={selectedEntry.id}
                src={selectedEntry.videoUrl}
                poster={selectedEntry.thumbnailUrl}
                controls
                preload="metadata"
                playsInline
                className="w-full h-full object-contain"
                aria-label={`Preview video for ${selectedEntry.title}`}
              />
            ) : (
              <img
                src={selectedEntry.thumbnailUrl}
                alt={`Preview thumbnail for ${selectedEntry.title}`}
                className="w-full h-full object-contain"
              />
            )}
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-white/15 text-[10px] font-mono uppercase tracking-wider text-white pointer-events-none">
              {selectedEntry.kind === 'video'
                ? `Video${selectedEntry.durationSeconds ? ` · ${selectedEntry.durationSeconds.toFixed(1)}s` : ''}`
                : 'Frame'}
            </span>
          </div>

          <div className="flex flex-col gap-1 min-w-0">
            <h3 className="text-sm font-medium text-white m-0 leading-snug break-words">
              {selectedEntry.title}
            </h3>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#A3A3A3]">
              <span className="inline-flex items-center gap-1">
                <Clock size={11} aria-hidden="true" />
                <time dateTime={selectedEntry.createdAt}>{selectedEntry.formattedDate}</time>
              </span>
              {selectedEntry.model && <span>· {selectedEntry.model}</span>}
              {selectedEntry.cast.length > 0 && <span>· Cast: {selectedEntry.cast.join(', ')}</span>}
            </div>
            {selectedEntry.setting && (
              <p className="text-[11px] text-[#8E8E8E] m-0">Setting: {selectedEntry.setting}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs flex-1 min-w-[140px]"
              disabled={isProcessing}
              onClick={() => handleApply(selectedEntry, 'replace-active')}
            >
              <RotateCcw size={13} />
              {activeShot
                ? `Revisit in Scene ${activeShot.shotNumber}`
                : 'Load into Storyboard'}
            </Button>
            {shots.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={isProcessing || shots.length >= 12}
                onClick={() => handleApply(selectedEntry, 'append-shot')}
                title="Append as a new scene at the end of the storyboard"
              >
                <Plus size={13} />
                Add as Scene {shots.length + 1}
              </Button>
            )}
            {selectedSequence && onRestoreSequence && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs w-full"
                disabled={isProcessing}
                onClick={() => handleRestoreSeq(selectedSequence)}
              >
                <Layers size={13} />
                Restore full {selectedSequence.entries.length}-scene sequence
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Sequence View */}
      {filter === 'sequences' ? (
        <div
          className="flex flex-col gap-2.5 max-h-[460px] overflow-y-auto pr-1"
          role="list"
          aria-label="Previous multi-scene generation sequences"
        >
          {sequences.map((seq) => (
            <div
              key={seq.id}
              role="listitem"
              className="rounded-xl border border-[#2E2E2E] bg-[#141414] p-3 flex flex-col gap-2.5 hover:border-[#555] transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-white m-0 leading-snug break-words">
                    {seq.title}
                  </h3>
                  <p className="text-[11px] text-[#999] m-0 mt-0.5 flex items-center gap-1">
                    <Clock size={11} aria-hidden="true" />
                    <time dateTime={seq.createdAt}>{seq.formattedDate}</time>
                  </p>
                </div>
                {onRestoreSequence && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2.5 text-xs shrink-0"
                    disabled={isProcessing}
                    onClick={() => handleRestoreSeq(seq)}
                  >
                    <RotateCcw size={12} />
                    Restore {seq.entries.length} scenes
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {seq.entries.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(item.id);
                      setFilter('all');
                    }}
                    className="group relative rounded overflow-hidden border border-[#333] bg-black text-left focus:outline-none focus:border-white"
                    title={`Scene ${idx + 1}: ${item.title}`}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      loading="lazy"
                      className="w-full aspect-video object-cover group-hover:opacity-90 transition-opacity"
                    />
                    <span className="block px-1.5 py-1 text-[10px] text-[#CCC] truncate bg-[#111]">
                      <b>0{idx + 1}</b> {item.subject}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Individual Generations List */
        <div
          className={`flex flex-col gap-2 ${compact ? 'max-h-[380px]' : 'max-h-[520px]'} overflow-y-auto pr-1`}
          role="list"
          aria-label="Previous generations list"
        >
          {loading && entries.length === 0 ? (
            <p className="text-xs text-[#888] py-4 text-center">Loading generation history…</p>
          ) : filteredEntries.length === 0 ? (
            <p className="text-xs text-[#888] py-4 text-center">
              {searchQuery
                ? 'No previous generations match your filter.'
                : 'No previous generations saved yet. Create a scene to populate your history.'}
            </p>
          ) : (
            filteredEntries.map((entry) => {
              const isSelected = selectedEntry?.id === entry.id;
              const inSceneNumber =
                (entry.jobId && activeJobIdsInStoryboard.get(entry.jobId)) ||
                activeJobIdsInStoryboard.get(entry.thumbnailUrl);

              return (
                <div
                  key={entry.id}
                  role="listitem"
                  className={`rounded-xl border p-2.5 flex items-center gap-3 transition-colors ${
                    isSelected
                      ? 'border-white bg-[#1F1F1F]'
                      : 'border-[#2B2B2B] bg-[#141414] hover:border-[#4A4A4A]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    aria-pressed={isSelected}
                    aria-label={`Select generation: ${entry.title}, created ${entry.formattedDate}`}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer text-inherit"
                  >
                    <div className="relative w-24 shrink-0 aspect-video rounded-md overflow-hidden bg-black border border-[#333]">
                      <img
                        src={entry.thumbnailUrl}
                        alt={`Thumbnail for ${entry.title}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded bg-black/80 text-[9px] font-mono text-white leading-none flex items-center gap-0.5">
                        {entry.kind === 'video' ? (
                          <>
                            <Play size={8} aria-hidden="true" />
                            {entry.durationSeconds ? `${entry.durationSeconds.toFixed(1)}s` : 'VID'}
                          </>
                        ) : (
                          <>
                            <ImageIcon size={8} aria-hidden="true" />
                            IMG
                          </>
                        )}
                      </span>
                    </div>

                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-xs font-medium text-white leading-snug line-clamp-2 break-words">
                        {entry.title}
                      </span>
                      <span className="text-[11px] text-[#9E9E9E] flex items-center gap-1">
                        <Clock size={10} aria-hidden="true" className="shrink-0" />
                        <time dateTime={entry.createdAt} className="truncate">
                          {entry.formattedDate}
                        </time>
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {inSceneNumber ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white font-medium">
                            Active in Scene {inSceneNumber}
                          </span>
                        ) : entry.sequenceId ? (
                          <span className="text-[10px] text-[#888]">Multi-shot sequence</span>
                        ) : null}
                      </div>
                    </div>
                  </button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-[11px] shrink-0"
                    disabled={isProcessing}
                    onClick={() => {
                      setSelectedId(entry.id);
                      handleApply(entry, 'replace-active');
                    }}
                    aria-label={`Revisit ${entry.title}`}
                  >
                    Revisit
                  </Button>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
