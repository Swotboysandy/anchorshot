// Adapted from prompt-kit components/ui/skeleton.tsx (MIT), pin 5a9496635cc0e1bf7679fe2a9e35d9b36b99c08a.
import type {ComponentProps} from 'react';
import {cn} from '../../lib/utils';
export function Skeleton({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('bg-white/10 motion-safe:animate-pulse rounded-md', className)} {...props} />;
}
