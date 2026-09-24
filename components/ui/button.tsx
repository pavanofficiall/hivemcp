import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants = cva('button', {
  variants: {
    variant: {
      default: 'button-primary',
      outline: 'button-outline',
      ghost: 'button-ghost',
      destructive: 'button-danger',
    },
    size: { default: '', sm: 'button-sm' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {
  asChild?: boolean;
}
export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant, size, className }))} {...props} />;
}
