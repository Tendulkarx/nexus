/**
 * Small local design-system primitives built on class-variance-authority +
 * Tailwind, matching the exact prop surface the app's views are written against.
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../cn";

// ── Text ─────────────────────────────────────────────────────────────────

const textVariants = cva("", {
  variants: {
    variant: {
      default: "text-sm",
      strong: "text-sm font-semibold",
      small: "text-xs",
      "small-strong": "text-xs font-semibold",
    },
    color: {
      primary: "text-primary",
      secondary: "text-secondary",
      tertiary: "text-tertiary",
      quaternary: "text-quaternary",
    },
  },
  defaultVariants: { variant: "default", color: "primary" },
});

interface TextProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "color">,
    VariantProps<typeof textVariants> {
  as?: React.ElementType;
  truncate?: boolean;
}

export function Text({ as: As = "span", variant, color, truncate, className, ...props }: TextProps) {
  return <As className={cn(textVariants({ variant, color }), truncate && "truncate", className)} {...props} />;
}

// ── Badge ────────────────────────────────────────────────────────────────

type BadgeColor = "blue" | "green" | "purple" | "orange" | "secondary" | "primary" | "red" | "yellow" | "magenta";

const BADGE_COLORS: Record<BadgeColor, string> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  green: "bg-green-500/15 text-green-600 dark:text-green-400",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  magenta: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  primary: "bg-accent/15 text-accent",
  secondary: "bg-control text-secondary",
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: BadgeColor;
  size?: "small" | "default";
}

export function Badge({ color = "secondary", size = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium",
        size === "small" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs",
        BADGE_COLORS[color],
        className,
      )}
      {...props}
    />
  );
}

// ── Button ───────────────────────────────────────────────────────────────

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-medium font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        accent: "bg-accent text-white hover:bg-accent/90",
        filled: "bg-control hover:bg-control/80 text-primary",
        glass: "bg-white/10 hover:bg-white/20 text-primary backdrop-blur",
        transparent: "hover:bg-control-subtle text-primary",
        destructive: "bg-red-600 text-white hover:bg-red-600/90",
      },
      size: {
        small: "h-7 px-2.5 text-xs",
        medium: "h-8 px-3 text-sm",
        large: "h-9 px-3.5 text-sm",
        default: "h-8 px-3 text-sm",
      },
      iconOnly: {
        true: "px-0 aspect-square",
        false: "",
      },
    },
    defaultVariants: { variant: "filled", size: "medium", iconOnly: false },
  },
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, iconOnly, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, iconOnly }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

// ── Input ────────────────────────────────────────────────────────────────

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: "default" | "filled";
  size?: "small" | "default";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ variant = "default", size = "default", className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-medium border border-field bg-transparent outline-none transition-colors",
        "focus:border-accent focus:ring-1 focus:ring-accent/40",
        "placeholder:text-tertiary",
        variant === "filled" && "bg-control border-transparent",
        size === "small" ? "h-7 px-2 text-xs" : "h-8 px-2.5 text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

// ── Label ────────────────────────────────────────────────────────────────

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("flex items-center gap-1.5 text-sm text-secondary", className)} {...props} />;
}

// ── Status ───────────────────────────────────────────────────────────────

interface StatusProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "error" | "warning" | "info";
}

export function Status({ variant = "info", className, ...props }: StatusProps) {
  const colors: Record<NonNullable<StatusProps["variant"]>, string> = {
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
    warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    info: "bg-control text-secondary",
  };
  return (
    <div
      className={cn("rounded-medium px-2 py-1 text-xs font-medium", colors[variant], className)}
      {...props}
    />
  );
}
