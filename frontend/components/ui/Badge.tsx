import { cn } from "@/lib/cn";
import { HTMLAttributes } from "react";

type BadgeVariant = "default" | "success" | "warning" | "info" | "destructive";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:     "bg-gray-100 text-gray-700",
  success:     "bg-brand-100 text-brand-700",
  warning:     "bg-accent-100 text-accent-600",
  info:        "bg-blue-100 text-blue-700",
  destructive: "bg-red-100 text-red-700",
};

function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
