import * as React from "react"

import { cn } from "../../lib/utils"

// Source: shadcn-ui apps/v4/registry/new-york-v4/ui/progress.tsx @ b8d7baa (MIT).
// Deviations: role="progressbar" instead of the Radix primitive, to avoid a new
// dependency; no value renders a pulsing full bar for work of unknown length.
function Progress({ className, value, ...props }: React.ComponentProps<"div"> & { value?: number }) {
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 bg-primary transition-all", value === undefined && "animate-pulse motion-reduce:animate-none")}
        style={{ transform: `translateX(-${100 - (value ?? 100)}%)` }}
      />
    </div>
  )
}

export { Progress }
