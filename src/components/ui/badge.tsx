import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'

import { cn } from '@/lib/utils.ts'

/**
 * shadcn's badge, used here for exactly one thing: WHO answers a row.
 *
 * Three words — read, you, the owner — and they are not decoration. They are the
 * whole permission model of this app said on the row it applies to: a derived
 * item is read off a tracker and cannot be ticked from anywhere, an agent item
 * is asserted over MCP under an agent's own name, and the owner's item is a gate
 * that only a person at this machine can close. A reader who cannot see which is
 * which reads sixteen identical boxes and learns to tick them all.
 *
 * `whitespace-nowrap` is deliberate at 220px: a badge that wraps to two lines
 * reads as two badges.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center rounded border px-1.5 py-px text-[0.65rem] font-medium leading-4 whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        outline: 'text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
