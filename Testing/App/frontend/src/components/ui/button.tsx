import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { DisabledAction } from '@/components/ui/disabled-action';
import { explainButtonProps } from '@/lib/disabled-action';
import { answerSuccessSurface, layout } from '@/config/layout';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[transform,opacity] outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        storefront: layout.storefront.actionOrange,
        storefrontDark: layout.storefront.actionDark,
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        success: `${answerSuccessSurface} hover:bg-emerald-100 dark:hover:bg-emerald-900`,
        error: 'bg-destructive text-white hover:bg-destructive/90 dark:text-red-950',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: layout.control.sizes,
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  disabledReason,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { disabledReason?: string }) {
  const control = (
    <ButtonPrimitive
      data-slot="button"
      data-control-size={size ?? 'default'}
      className={cn(
        buttonVariants({ variant, size }),
        className,
        layout.control.sizes[size ?? 'default'],
      )}
      {...explainButtonProps(props, disabledReason)}
    />
  );
  return props.disabled && disabledReason ? (
    <DisabledAction reason={disabledReason}>{control}</DisabledAction>
  ) : (
    control
  );
}

export { Button, buttonVariants };
