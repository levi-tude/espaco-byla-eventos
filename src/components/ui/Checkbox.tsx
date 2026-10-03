import type { InputHTMLAttributes, ReactNode } from "react";

import { cx } from "@/components/ui/cx";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children: ReactNode;
  wrapperClassName?: string;
};

/** A linha inteira é tocável (≥ 44 px), não só a caixinha. */
export function Checkbox({ children, wrapperClassName, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cx(
        "flex min-h-11 cursor-pointer items-start gap-3 py-2.5 text-base text-foreground",
        wrapperClassName,
      )}
    >
      <input
        className={cx("mt-0.5 h-5 w-5 shrink-0 accent-byla-action", className)}
        type="checkbox"
        {...props}
      />
      <span>{children}</span>
    </label>
  );
}
