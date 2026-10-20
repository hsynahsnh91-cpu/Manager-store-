import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useI18n } from '../i18n';

const baseField =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 placeholder-slate-400 shadow-sm transition-colors ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ' +
  'dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-brand-400';

export interface FieldWrapperProps {
  label?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function FieldWrapper({ label, required, error, hint, children, className = '' }: FieldWrapperProps) {
  const { t } = useI18n();
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
          {required && <span className="text-rose-500"> *</span>}
          {!required && <span className="font-normal text-slate-400"> ({t('optional')})</span>}
        </span>
      )}
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, required, error, hint, icon, className = '', ...rest },
  ref,
) {
  const field = (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400">{icon}</span>
      )}
      <input
        ref={ref}
        className={`${baseField} ${icon ? 'ps-9' : ''} ${error ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20' : ''} ${rest.type === 'number' ? 'font-mono' : ''} ${className}`}
        {...rest}
      />
    </div>
  );
  if (label || error || hint) {
    return (
      <FieldWrapper label={label} required={required} error={error} hint={hint}>
        {field}
      </FieldWrapper>
    );
  }
  return field;
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, required, error, className = '', ...rest },
  ref,
) {
  const field = <textarea ref={ref} className={`${baseField} min-h-[72px] ${className}`} {...rest} />;
  if (label || error) {
    return (
      <FieldWrapper label={label} required={required} error={error}>
        {field}
      </FieldWrapper>
    );
  }
  return field;
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, required, error, placeholder, className = '', children, ...rest },
  ref,
) {
  const field = (
    <select ref={ref} className={`${baseField} cursor-pointer ${error ? 'border-rose-400' : ''} ${className}`} {...rest}>
      {placeholder && <option value="">{placeholder}</option>}
      {children}
    </select>
  );
  if (label || error) {
    return (
      <FieldWrapper label={label} required={required} error={error}>
        {field}
      </FieldWrapper>
    );
  }
  return field;
});
