import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hover active:bg-accent-hover " +
    "border border-transparent px-6 py-3 font-semibold",
  secondary:
    "bg-surface text-text-primary border-[1.5px] border-border " +
    "hover:border-accent hover:text-accent px-6 py-[11px] font-medium",
  ghost:
    "bg-transparent text-accent border-[1.5px] border-accent " +
    "hover:bg-accent-light px-5 py-[10px] font-medium",
};

interface BaseProps {
  variant?: Variant;
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
}

type ButtonProps = BaseProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant = "primary",
  fullWidth,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={[
        "rounded-sm transition-colors text-[15px] tracking-[-0.01em]",
        "inline-flex items-center justify-center gap-2",
        VARIANT_CLASSES[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Link styled as a button. Use for navigation that doesn't need a form or
 * click handler; keeps the visual language consistent.
 */
export function LinkButton({
  to,
  variant = "primary",
  fullWidth,
  className = "",
  children,
}: BaseProps & { to: string }) {
  return (
    <Link
      to={to}
      className={[
        "rounded-sm transition-colors text-[15px] tracking-[-0.01em]",
        "inline-flex items-center justify-center gap-2",
        VARIANT_CLASSES[variant],
        fullWidth ? "w-full" : "",
        className,
      ].join(" ")}
    >
      {children}
    </Link>
  );
}
