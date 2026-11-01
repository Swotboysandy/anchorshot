"use client"

import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "./ui/prompt-input"
import { Button } from "./ui/button"
import { ArrowUp, Check, Mic, MoreHorizontal, Plus } from "lucide-react"
import { clsx } from "clsx"

type Props = {
  prompt: string;
  isLoading: boolean;
  setPrompt: (value: string) => void;
  onSubmit: (value: string) => void;
  onScript: () => void;
  onReview: () => void;
  onTools: () => void;
  onVoice: () => void;
  hasStory: boolean;
  isListening?: boolean;
};

// Upstream block structure/classes preserved. Demo handlers are replaced with app callbacks.
function CreationComposer({prompt,isLoading,setPrompt,onSubmit,onScript,onReview,onTools,onVoice,hasStory,isListening = false}:Props) {
  const handleSubmit = () => {
    if (!prompt.trim() || isLoading) return;
    onSubmit(prompt.trim());
    setPrompt("");
  };

  return (
    <div className="mx-auto max-w-3xl px-3 pb-3 md:px-5 md:pb-5">
      <PromptInput
        isLoading={isLoading}
        value={prompt}
        onValueChange={setPrompt}
        onSubmit={handleSubmit}
        className="border-input bg-popover relative z-10 w-full rounded-3xl border p-0 pt-1 shadow-xs"
      >
        <div className="flex flex-col">
          <PromptInputTextarea
            aria-label="Describe your video or edit"
            placeholder={isListening ? "Listening live... Speak your direction or click mic to stop" : "Describe your scene or an edit..."}
            className="min-h-[44px] pt-3 pl-4 text-base leading-[1.3] sm:text-base md:text-base"
          />

          <PromptInputActions className="mt-5 flex w-full items-center justify-between gap-2 px-3 pb-3">
            <div className="flex items-center gap-2">
              <PromptInputAction tooltip="Paste a script">
                <Button onClick={onScript} aria-label="Paste a script"
                  variant="outline"
                  size="icon"
                  className="size-9 rounded-full"
                >
                  <Plus size={18} />
                </Button>
              </PromptInputAction>

              <PromptInputAction tooltip="Review continuity">
                <Button disabled={!hasStory} onClick={onReview} aria-label="Review continuity" variant="outline" className="rounded-full">
                  <Check size={18} />
                  Review
                </Button>
              </PromptInputAction>

              <PromptInputAction tooltip="Open scene review tools">
                <Button disabled={!hasStory} onClick={onTools} aria-label="Open scene review tools"
                  variant="outline"
                  size="icon"
                  className="size-9 rounded-full"
                >
                  <MoreHorizontal size={18} />
                </Button>
              </PromptInputAction>
            </div>
            <div className="flex items-center gap-2">
              <PromptInputAction tooltip={isListening ? "Stop voice dictation" : "Voice input"}>
                <Button onClick={onVoice} aria-label={isListening ? "Stop voice dictation" : "Talk to Anchorshot"}
                  aria-pressed={isListening}
                  variant={isListening ? "default" : "outline"}
                  size="icon"
                  className={clsx(
                    "size-9 rounded-full transition-all duration-200",
                    isListening
                      ? "bg-white text-black hover:bg-neutral-200 border-2 border-white ring-2 ring-white/40"
                      : ""
                  )}
                >
                  <Mic size={18} className={isListening ? "stroke-[2.5]" : ""} />
                </Button>
              </PromptInputAction>

              <Button
                size="icon"
                disabled={!prompt.trim() || isLoading}
                aria-label="Apply direction" onClick={handleSubmit}
                className="size-9 rounded-full"
              >
                {!isLoading ? (
                  <ArrowUp size={18} />
                ) : (
                  <span className="size-3 rounded-xs bg-white" />
                )}
              </Button>
            </div>
          </PromptInputActions>
        </div>
      </PromptInput>
    </div>
  )
}

export { CreationComposer }
