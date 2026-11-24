import * as React from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * Custom pirate skull & crossbones emblem SVG designed for SACE Workpulse Battalion navigation.
 */
export function PirateEmblemIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden="true"
    >
      {/* Crossbones behind skull */}
      <path
        d="M4.5 19.5L19.5 4.5M19.5 19.5L4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="4.2" cy="4.2" r="1.1" fill="currentColor" opacity="0.7" />
      <circle cx="19.8" cy="4.2" r="1.1" fill="currentColor" opacity="0.7" />
      <circle cx="4.2" cy="19.8" r="1.1" fill="currentColor" opacity="0.7" />
      <circle cx="19.8" cy="19.8" r="1.1" fill="currentColor" opacity="0.7" />

      {/* Skull cranium */}
      <path
        d="M12 4.2C8.7 4.2 6.3 6.6 6.3 9.7C6.3 11.4 7.1 12.8 8.2 13.7V16.1C8.2 16.9 8.8 17.5 9.6 17.5H14.4C15.2 17.5 15.8 16.9 15.8 16.1V13.7C16.9 12.8 17.7 11.4 17.7 9.7C17.7 6.6 15.3 4.2 12 4.2Z"
        fill="currentColor"
      />
      {/* Eye sockets & pirate eyepatch */}
      <circle cx="9.8" cy="9.9" r="1.3" fill="#2D0029" />
      <circle cx="14.2" cy="9.9" r="1.3" fill="#2D0029" />
      <path d="M8.1 7.6L16.8 11.1" stroke="#2D0029" strokeWidth="1.1" strokeLinecap="round" />
      {/* Jaw / teeth notches */}
      <path
        d="M10.4 15.1V17.4M12 15.1V17.4M13.6 15.1V17.4"
        stroke="#2D0029"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BattalionNavItem({ active }: { active: boolean }) {
  return (
    <Link
      to="/battalion"
      className={cn(
        "group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
        active
          ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-xs"
          : "text-sidebar-foreground/85 hover:bg-[#5B00A3]/35 hover:text-white",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <PirateEmblemIcon
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-105",
            active ? "text-sidebar-primary-foreground" : "text-amber-300",
          )}
        />
        <span className="truncate">Battalion</span>
      </div>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
          active
            ? "border-sidebar-primary-foreground/30 bg-sidebar-primary-foreground/15 text-sidebar-primary-foreground"
            : "border-emerald-400/35 bg-emerald-500/20 text-emerald-300",
        )}
      >
        Live
      </span>
    </Link>
  );
}
