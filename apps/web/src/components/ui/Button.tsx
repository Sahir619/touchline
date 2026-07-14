"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost" | "gradient";
type ButtonSize = "md" | "lg";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  "inline-flex items-center justify-center gap-2 select-none " +
  "font-display font-semibold uppercase tracking-wide " +
  "rounded-[var(--radius-sm)] transition-colors duration-[var(--dur-micro)] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
  "disabled:opacity-50 disabled:pointer-events-none cursor-pointer";

const sizes: Record<ButtonSize, string> = {
  // touch target >= 44px
  md: "min-h-[44px] px-5 text-[15px]",
  lg: "min-h-[52px] px-7 text-base",
};

const variants: Record<ButtonVariant, string> = {
  // primary emerald with soft green glow
  primary:
    "bg-emerald text-on-emerald glow-emerald hover:bg-emerald-deep",
  // ghost — light-on-dark outline (matches the landing's working ghost CTA)
  ghost:
    "bg-transparent text-ink border border-[rgba(255,255,255,0.16)] hover:border-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.04)]",
  // gradient — on-chain only
  gradient:
    "on-chain text-on-emerald shadow-[0_8px_24px_rgba(3,225,255,0.28)] hover:brightness-[1.03]",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      // press scale .98 (framer honours prefers-reduced-motion via the spec's CSS)
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.4, 0, 0.2, 1] }}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    >
      {children}
    </motion.button>
  );
}

export default Button;
