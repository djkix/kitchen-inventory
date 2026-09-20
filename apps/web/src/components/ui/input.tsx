import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  /** Marque « à vérifier » (reconnaissance à confiance moyenne, section 17). */
  review?: boolean;
  className?: string;
}

const CONTROL =
  'w-full min-h-touch rounded-xl border bg-surface px-3.5 text-[16px] text-fg placeholder:text-faint focus:border-accent focus:outline-none disabled:text-faint';

export function FieldShell({ label, hint, error, review, className, htmlFor, children }: FieldProps & { htmlFor: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-center gap-2 text-[14px] text-muted">
        <span>{label}</span>
        {review && <span className="rounded-md bg-soon-deep px-1.5 py-0.5 text-[12px] font-medium text-soon">à vérifier</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[13px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = FieldProps & InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, review, className, id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell label={label} hint={hint} error={error} review={review} className={className} htmlFor={inputId}>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, error ? 'border-danger' : review ? 'border-soon/60' : 'border-line')}
        {...rest}
      />
    </FieldShell>
  );
});

type TextareaProps = FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, hint, error, review, className, id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell label={label} hint={hint} error={error} review={review} className={className} htmlFor={inputId}>
      <textarea ref={ref} id={inputId} aria-invalid={error ? true : undefined} className={cn(CONTROL, 'py-2.5', error ? 'border-danger' : 'border-line')} {...rest} />
    </FieldShell>
  );
});

type SelectProps = FieldProps & SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }>; placeholder?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, review, className, id, options, placeholder, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <FieldShell label={label} hint={hint} error={error} review={review} className={className} htmlFor={inputId}>
      <select
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, 'appearance-none', error ? 'border-danger' : review ? 'border-soon/60' : 'border-line')}
        {...rest}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, hint, className, id, ...rest }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label htmlFor={inputId} className={cn('flex min-h-touch items-center gap-3 rounded-xl px-1', className)}>
      <input ref={ref} id={inputId} type="checkbox" className="size-5 shrink-0 accent-accent" {...rest} />
      <span className="flex flex-col">
        <span className="text-[15px]">{label}</span>
        {hint && <span className="text-[13px] text-faint">{hint}</span>}
      </span>
    </label>
  );
});
