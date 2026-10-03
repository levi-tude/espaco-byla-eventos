import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useId } from "react";

import { cx } from "@/components/ui/cx";

/** 16 px evita o zoom automático do iPhone; 48 px de altura passa dos 44 px de toque. */
export const controlClasses =
  "w-full rounded-lg border border-byla-border bg-byla-input px-3 text-base text-foreground placeholder:text-byla-muted transition focus:border-byla-blue focus:outline-none focus:ring-2 focus:ring-byla-ring disabled:opacity-60 aria-invalid:border-byla-danger";

export const labelClasses = "text-sm font-medium text-foreground";

type FieldShellProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
};

function FieldShell({ id, label, hint, error, className, children }: FieldShellProps) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label className={labelClasses} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p className="text-sm text-byla-muted" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm font-medium text-byla-danger" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error: ReactNode) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  wrapperClassName?: string;
};

export function Field({ id, label, hint, error, wrapperClassName, className, ...props }: FieldProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <FieldShell className={wrapperClassName} error={error} hint={hint} id={inputId} label={label}>
      <input
        aria-describedby={describedBy(inputId, hint, error)}
        aria-invalid={error ? true : undefined}
        className={cx(controlClasses, "min-h-12", className)}
        id={inputId}
        {...props}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  wrapperClassName?: string;
};

export function TextAreaField({
  id,
  label,
  hint,
  error,
  wrapperClassName,
  className,
  ...props
}: TextAreaFieldProps) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <FieldShell className={wrapperClassName} error={error} hint={hint} id={inputId} label={label}>
      <textarea
        aria-describedby={describedBy(inputId, hint, error)}
        aria-invalid={error ? true : undefined}
        className={cx(controlClasses, "min-h-28 py-3", className)}
        id={inputId}
        {...props}
      />
    </FieldShell>
  );
}
