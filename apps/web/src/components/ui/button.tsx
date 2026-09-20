import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'md' | 'lg' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink font-semibold active:brightness-90 disabled:bg-raised disabled:text-faint',
  secondary: 'bg-raised text-fg active:bg-line disabled:text-faint',
  ghost: 'bg-transparent text-fg active:bg-raised disabled:text-faint',
  outline: 'bg-transparent border border-line text-fg active:bg-raised disabled:text-faint',
  danger: 'bg-danger-deep text-danger font-semibold active:brightness-110 disabled:text-faint',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-[36px] px-3 text-[14px]',
  md: 'min-h-touch px-4 text-[15px]',
  lg: 'min-h-[52px] px-5 text-[16px]',
};

/** Bouton tactile : 44 px minimum en hauteur (section 13). */
export function Button({ variant = 'secondary', size = 'md', loading = false, block = false, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl transition-[filter,background-color] duration-100 select-none disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-4 rounded-full border-2 border-current border-r-transparent animate-spin', className)}
    />
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

/** Bouton icône carré de 44 px avec libellé accessible. */
export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn('inline-flex size-touch items-center justify-center rounded-xl text-fg active:bg-raised disabled:text-faint', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
