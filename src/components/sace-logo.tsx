import * as React from "react";
import { resolveEffectiveLogoSrc } from "@/lib/branding";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

interface SaceLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "badge" | "horizontal" | "full" | "wordmark";
  theme?: "purple" | "white" | "adaptive";
}

export function SaceLogo({
  className,
  size = "md",
  variant = "horizontal",
  theme = "adaptive",
  ...props
}: SaceLogoProps) {
  const { branding } = useApp();
  const sizeClasses = {
    sm: "h-7",
    md: "h-9",
    lg: "h-12",
    xl: "h-16",
  }[size];

  const logoSrc = resolveEffectiveLogoSrc(branding?.logoUrl);
  const orgName = branding?.organisationName?.trim() || "SACE Group";

  if (variant === "wordmark") {
    return (
      <div
        className={cn(
          "inline-flex items-center bg-white px-3 py-1.5 rounded-xl shadow-xs",
          sizeClasses,
          className,
        )}
        {...props}
      >
        {logoSrc ? (
          <img src={logoSrc} alt={orgName} className="h-full w-auto max-w-[200px] object-contain" />
        ) : (
          <span className="px-1 font-bold tracking-tight text-primary text-base">{orgName}</span>
        )}
      </div>
    );
  }

  if (variant === "badge") {
    return (
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-xl bg-white p-2 shadow-md ring-1 ring-border",
          sizeClasses,
          "aspect-video",
          className,
        )}
        {...props}
      >
        {logoSrc ? (
          <img src={logoSrc} alt={orgName} className="h-full w-full object-contain" />
        ) : (
          <span className="font-extrabold text-primary text-xs tracking-tight px-1 truncate">
            {orgName}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3", className)} {...props}>
      {logoSrc && (
        <div
          className={cn(
            "relative flex items-center justify-center overflow-hidden rounded-xl bg-white px-3 py-1.5 shadow-md shadow-black/5 ring-1 ring-border",
            sizeClasses,
            "shrink-0",
          )}
        >
          <img src={logoSrc} alt={orgName} className="h-full w-auto object-contain" />
        </div>
      )}
      <span className="font-bold tracking-tight text-foreground text-base">{orgName}</span>
    </div>
  );
}
