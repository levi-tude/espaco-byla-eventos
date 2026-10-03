import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

import { cx } from "@/components/ui/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-byla-action text-white hover:bg-byla-action-hover",
  secondary:
    "border border-byla-border bg-byla-surface text-foreground hover:border-byla-link/60 hover:text-byla-link",
  ghost: "text-foreground hover:bg-byla-overlay",
  danger: "bg-byla-danger-solid text-white hover:brightness-110",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-12 px-6 text-base",
};

type StyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: StyleOptions = {}) {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold no-underline transition",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue",
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  StyleOptions & {
    loading?: boolean;
    /** Texto mostrado enquanto `loading` (ex.: "Enviando…"). */
    loadingLabel?: string;
  };

export function Button({
  variant,
  size,
  fullWidth,
  className,
  loading = false,
  loadingLabel,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      type={type}
      {...props}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

type ButtonLinkProps = ComponentProps<typeof Link> & StyleOptions;

export function ButtonLink({ variant, size, fullWidth, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClasses({ variant, size, fullWidth, className })} {...props} />;
}
