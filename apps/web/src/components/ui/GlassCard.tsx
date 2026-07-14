import { cn } from "@/lib/cn";

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

/**
 * GlassCard — frosted, floating surface. Floating / overlay use ONLY
 * (nav, daily-challenge strip, pundit, sheets). Things you read are solid.
 */
export function GlassCard({
  as: Tag = "div",
  className,
  children,
  ...props
}: GlassCardProps) {
  return (
    <Tag className={cn("glass", className)} {...props}>
      {children}
    </Tag>
  );
}

export default GlassCard;
