import * as React from "react";
import { CalendarClock, Check, Clock, Loader2, Radio, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApp } from "@/lib/store";
import {
  AVAILABLE_FOR_PRESETS,
  LIVE_STATUS_PRESETS,
  PRESENCE_SESSION_KEY,
  TIME_WINDOW_OPTIONS,
  toDatetimeLocalValue,
  type TimeWindowChoice,
} from "@/lib/battalion";
import { cn } from "@/lib/utils";

export interface PresenceSetupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMandatoryLoginPrompt?: boolean;
}

export function PresenceSetupModal({
  open,
  onOpenChange,
  isMandatoryLoginPrompt = false,
}: PresenceSetupModalProps) {
  const { myPresence, updatePresence } = useApp();

  const [durationMinutes, setDurationMinutes] = React.useState<TimeWindowChoice>(60);
  const [customStartTime, setCustomStartTime] = React.useState("");
  const [customEndTime, setCustomEndTime] = React.useState("");

  const [selectedAvailableFor, setSelectedAvailableFor] = React.useState<string>("1o1");
  const [customAvailableFor, setCustomAvailableFor] = React.useState("");

  const [selectedStatus, setSelectedStatus] = React.useState<string>("On Desk");
  const [customStatus, setCustomStatus] = React.useState("");

  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
    setCustomStartTime(
      myPresence?.availableFrom
        ? toDatetimeLocalValue(new Date(myPresence.availableFrom))
        : toDatetimeLocalValue(now),
    );
    setCustomEndTime(
      myPresence?.availableUntil && new Date(myPresence.availableUntil).getTime() > now.getTime()
        ? toDatetimeLocalValue(new Date(myPresence.availableUntil))
        : toDatetimeLocalValue(oneHourLater),
    );

    if (myPresence) {
      if (myPresence.isCustomAvailability) {
        setSelectedAvailableFor("Custom");
        setCustomAvailableFor(myPresence.availableFor);
      } else if ((AVAILABLE_FOR_PRESETS as readonly string[]).includes(myPresence.availableFor)) {
        setSelectedAvailableFor(myPresence.availableFor);
        setCustomAvailableFor("");
      } else {
        setSelectedAvailableFor("1o1");
      }

      if (myPresence.isCustomStatus) {
        setSelectedStatus("Custom");
        setCustomStatus(myPresence.status);
      } else if ((LIVE_STATUS_PRESETS as readonly string[]).includes(myPresence.status)) {
        setSelectedStatus(myPresence.status);
        setCustomStatus("");
      } else {
        setSelectedStatus("On Desk");
      }
    } else {
      setDurationMinutes(60);
      setSelectedAvailableFor("1o1");
      setCustomAvailableFor("");
      setSelectedStatus("On Desk");
      setCustomStatus("");
    }
  }, [open, myPresence]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const isCustomAvail = selectedAvailableFor === "Custom";
    const resolvedAvailableFor = isCustomAvail ? customAvailableFor.trim() : selectedAvailableFor;
    if (!resolvedAvailableFor) {
      toast.error("Please enter what you are available for.");
      return;
    }

    const isCustomStat = selectedStatus === "Custom";
    const resolvedStatus = isCustomStat ? customStatus.trim() : selectedStatus;
    if (!resolvedStatus) {
      toast.error("Please enter your custom live status.");
      return;
    }

    if (durationMinutes === "CUSTOM") {
      if (!customStartTime || !customEndTime) {
        toast.error("Please select both 'From' and 'Until' date/time values.");
        return;
      }
      if (new Date(customEndTime).getTime() <= new Date(customStartTime).getTime()) {
        toast.error("Custom 'Until' time must be later than 'From' time.");
        return;
      }
    }

    setSaving(true);
    const res = await updatePresence({
      status: resolvedStatus,
      isCustomStatus: isCustomStat,
      availableFor: resolvedAvailableFor,
      isCustomAvailability: isCustomAvail,
      durationMinutes,
      customStartTime:
        durationMinutes === "CUSTOM" ? new Date(customStartTime).toISOString() : null,
      customEndTime: durationMinutes === "CUSTOM" ? new Date(customEndTime).toISOString() : null,
    });
    setSaving(false);

    if (!res.ok) {
      toast.error(res.error ?? "Unable to save live presence.");
      return;
    }

    try {
      window.sessionStorage.setItem(PRESENCE_SESSION_KEY, "1");
    } catch {
      // Ignore storage access restrictions
    }

    toast.success(`Live status updated: ${resolvedStatus} · ${resolvedAvailableFor}`);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isMandatoryLoginPrompt && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        showCloseButton={!isMandatoryLoginPrompt}
        onEscapeKeyDown={(ev) => {
          if (isMandatoryLoginPrompt) ev.preventDefault();
        }}
        onPointerDownOutside={(ev) => {
          if (isMandatoryLoginPrompt) ev.preventDefault();
        }}
        className="max-h-[92vh] max-w-2xl overflow-y-auto rounded-2xl border-border bg-card p-0 shadow-xl"
      >
        <div className="bg-gradient-to-r from-[#2D0029] via-[#5B00A3] to-[#8A007E] px-6 py-5 text-white">
          <DialogHeader className="text-left">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-purple-200">
              <Radio className="h-3.5 w-3.5" />
              <span>
                {isMandatoryLoginPrompt ? "Shift Check-In · Presence Setup" : "Update Live Status"}
              </span>
            </div>
            <DialogTitle className="mt-1 text-xl font-bold text-white">
              Set Your Live Availability &amp; Status
            </DialogTitle>
            <DialogDescription className="text-xs text-purple-100/85">
              Let your Battalion teammates know your current work mode, availability window, and
              what you are open for. Your status expires automatically when the window ends.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSave} className="space-y-6 p-6">
          {/* 1. Time Window */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-[#8A007E] dark:text-purple-400" />
                Time Window
              </Label>
              <span className="text-[11px] text-muted-foreground">Auto-expires at window end</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TIME_WINDOW_OPTIONS.map((opt) => {
                const active = durationMinutes === opt.value;
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setDurationMinutes(opt.value)}
                    className={cn(
                      "flex items-center justify-center rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap",
                      active
                        ? "border-[#5B00A3] bg-[#5B00A3] text-white shadow-xs"
                        : "border-border bg-background text-foreground hover:border-[#8A007E]/60 hover:bg-muted/60",
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {durationMinutes === "CUSTOM" && (
              <div className="mt-3 grid gap-3 rounded-xl border border-border bg-muted/40 p-3.5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="presence-custom-from" className="text-xs font-medium">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5 text-[#8A007E] dark:text-purple-400" />
                      From
                    </span>
                  </Label>
                  <Input
                    id="presence-custom-from"
                    type="datetime-local"
                    value={customStartTime}
                    onChange={(e) => setCustomStartTime(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="presence-custom-until" className="text-xs font-medium">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5 text-[#8A007E] dark:text-purple-400" />
                      Until
                    </span>
                  </Label>
                  <Input
                    id="presence-custom-until"
                    type="datetime-local"
                    value={customEndTime}
                    onChange={(e) => setCustomEndTime(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              </div>
            )}
          </div>

          {/* 2. Available For */}
          <div className="space-y-2.5">
            <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-[#8A007E] dark:text-purple-400" />
              Available For
            </Label>
            <div className="flex flex-wrap gap-2">
              {[...AVAILABLE_FOR_PRESETS, "Custom"].map((option) => {
                const active = selectedAvailableFor === option;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setSelectedAvailableFor(option)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                      active
                        ? "border-[#8A007E] bg-[#8A007E] text-white shadow-xs"
                        : "border-border bg-background text-foreground hover:border-[#8A007E]/60 hover:bg-muted/60",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {selectedAvailableFor === "Custom" && (
              <Input
                value={customAvailableFor}
                onChange={(e) => setCustomAvailableFor(e.target.value)}
                placeholder="e.g. Sprint planning, Client onboarding review..."
                maxLength={60}
                className="h-9 text-xs"
                autoFocus
              />
            )}
          </div>

          {/* 3. Current Live Status */}
          <div className="space-y-2.5">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current Live Status
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[...LIVE_STATUS_PRESETS, "Custom"].map((statusOption) => {
                const active = selectedStatus === statusOption;
                return (
                  <button
                    key={statusOption}
                    type="button"
                    onClick={() => setSelectedStatus(statusOption)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors",
                      active
                        ? "border-[#5B00A3] bg-[#5B00A3]/15 text-[#5B00A3] dark:border-purple-400 dark:bg-[#5B00A3]/40 dark:text-white"
                        : "border-border bg-background text-foreground hover:border-[#8A007E]/50 hover:bg-muted/60",
                    )}
                  >
                    <span className="truncate">{statusOption}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
            {selectedStatus === "Custom" && (
              <Input
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                placeholder="e.g. Deep Work · No Slack, Reviewing Audits..."
                maxLength={60}
                className="h-9 text-xs"
                autoFocus
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            {!isMandatoryLoginPrompt && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={saving}
              className="gap-1.5 bg-gradient-to-r from-[#5B00A3] to-[#8A007E] text-white hover:opacity-95"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  {isMandatoryLoginPrompt ? "Confirm Status & Enter Portal" : "Update Live Status"}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
