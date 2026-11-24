import * as React from "react";
import {
  Mic,
  Square,
  Pause,
  Play,
  Upload,
  FileAudio,
  FileText,
  Loader2,
  Languages,
  CheckCircle2,
  RotateCcw,
  FilePlus2,
  AlertCircle,
} from "lucide-react";
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
import {
  LANGUAGE_HINTS,
  MAX_MOM_SOURCE_BYTES,
  SUPPORTED_MOM_SOURCE_ACCEPT,
  fileToBase64,
  formatFileBytes,
  parseJsonResponseSafe,
} from "@/lib/mom";
import { getClientSessionToken } from "@/lib/portal-session-client";
import type { MomDocument } from "@/lib/types";

interface MomCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (doc: MomDocument) => void;
  onCreateBlank: () => void;
}

function formatSecondsTimer(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function MomCreateDialog({
  open,
  onOpenChange,
  onCreated,
  onCreateBlank,
}: MomCreateDialogProps) {
  const [step, setStep] = React.useState<"choose" | "record" | "upload">("choose");
  const [titleHint, setTitleHint] = React.useState("");
  const [languageHint, setLanguageHint] = React.useState("auto");
  const [submitting, setSubmitting] = React.useState(false);
  const [progressNote, setProgressNote] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Audio recording state
  const [recordingState, setRecordingState] = React.useState<
    "idle" | "recording" | "paused" | "recorded"
  >("idle");
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const [audioLevel, setAudioLevel] = React.useState(0);
  const [recordedBlob, setRecordedBlob] = React.useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = React.useState<string | null>(null);

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<number | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const autoSubmitOnStopRef = React.useRef(false);

  // File upload state
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const cleanupMedia = React.useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    setAudioLevel(0);
  }, []);

  React.useEffect(() => {
    if (!open) {
      cleanupMedia();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
      setRecordedBlob(null);
      setRecordingState("idle");
      setElapsedSec(0);
      setSelectedFile(null);
      setTitleHint("");
      setLanguageHint("auto");
      setStep("choose");
      setSubmitting(false);
      setProgressNote("");
      setErrorMsg(null);
    }
  }, [open, cleanupMedia, recordedUrl]);

  React.useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const submitSourceToServer = React.useCallback(
    async (file: File, sourceType: "recording" | "upload") => {
      setSubmitting(true);
      setErrorMsg(null);
      setProgressNote(
        sourceType === "recording"
          ? "Transcribing every spoken word accurately & drafting structured MOM..."
          : "Analyzing uploaded media/document & drafting structured MOM...",
      );

      try {
        const base64Data = await fileToBase64(file);
        const token = getClientSessionToken();
        const res = await fetch("/api/mom/generate", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "x-sace-session": token } : {}),
          },
          body: JSON.stringify({
            base64Data,
            fileName: file.name,
            mimeType: file.type,
            sourceType,
            languageHint,
            title: titleHint.trim() || undefined,
          }),
        });

        const payload = await parseJsonResponseSafe<{
          ok?: boolean;
          document?: MomDocument;
          error?: string;
        }>(res, "Failed to generate MOM");
        if (!res.ok || !payload.ok || !payload.document) {
          throw new Error(payload.error || "Failed to generate MOM.");
        }

        toast.success("Minutes of the Meeting generated and ready to edit!");
        onCreated(payload.document);
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not generate MOM.";
        setErrorMsg(msg);
        toast.error(msg);
      } finally {
        setSubmitting(false);
        setProgressNote("");
      }
    },
    [languageHint, titleHint, onCreated, onOpenChange],
  );

  const startRecording = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Your browser does not support microphone audio recording.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const preferredTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: finalMime });
        cleanupMedia();
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setRecordingState("recorded");

        if (autoSubmitOnStopRef.current && blob.size > 0) {
          autoSubmitOnStopRef.current = false;
          const ext = finalMime.includes("mp4")
            ? "m4a"
            : finalMime.includes("ogg")
              ? "ogg"
              : "webm";
          const file = new File([blob], `meeting-recording-${Date.now()}.${ext}`, {
            type: finalMime,
          });
          void submitSourceToServer(file, "recording");
        }
      };

      // Live audio visualizer level
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]!;
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
          rafRef.current = window.requestAnimationFrame(updateLevel);
        };
        updateLevel();
      } catch {
        // Visualizer optional
      }

      recorder.start(500);
      setElapsedSec(0);
      setRecordingState("recording");
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      const msg =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Microphone permission was denied. Please allow microphone access in your browser."
          : "Could not access microphone. Please check your device audio settings.";
      toast.error(msg);
      cleanupMedia();
    }
  };

  const togglePauseRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (recordingState === "recording" && rec.state === "recording") {
      rec.pause();
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingState("paused");
    } else if (recordingState === "paused" && rec.state === "paused") {
      rec.resume();
      timerRef.current = window.setInterval(() => {
        setElapsedSec((prev) => prev + 1);
      }, 1000);
      setRecordingState("recording");
    }
  };

  const stopRecording = (autoGenerate: boolean) => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;
    autoSubmitOnStopRef.current = autoGenerate;
    rec.stop();
  };

  const handleGenerateFromRecorded = () => {
    if (!recordedBlob || recordedBlob.size === 0) {
      toast.error("No recorded audio found. Please record again.");
      return;
    }
    const mime = recordedBlob.type || "audio/webm";
    const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
    const file = new File([recordedBlob], `meeting-recording-${Date.now()}.${ext}`, { type: mime });
    void submitSourceToServer(file, "recording");
  };

  const handleResetRecording = () => {
    cleanupMedia();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedUrl(null);
    setRecordedBlob(null);
    setElapsedSec(0);
    setRecordingState("idle");
  };

  const handlePickFile = (file: File | null | undefined) => {
    if (!file) return;
    if (file.size <= 0) {
      toast.error("The selected file is empty.");
      return;
    }
    if (file.size > MAX_MOM_SOURCE_BYTES) {
      toast.error("File exceeds the 25 MB limit. Please upload a smaller audio or document file.");
      return;
    }
    setSelectedFile(file);
    setErrorMsg(null);
  };

  const handleGenerateFromUpload = () => {
    if (!selectedFile) {
      toast.error("Please select an audio file, PDF, or document first.");
      return;
    }
    void submitSourceToServer(selectedFile, "upload");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!submitting ? onOpenChange(next) : undefined)}>
      <DialogContent className="sm:max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">
            {step === "choose"
              ? "Create Minutes of the Meeting (MOM)"
              : step === "record"
                ? "Record Meeting Audio"
                : "Upload Audio, Document, or PDF"}
          </DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Choose how you want to create your MOM. Every spoken word and document detail is captured across any language."
              : step === "record"
                ? "Record your live meeting until you stop. Our multilingual transcription captures every word accurately and builds an editable MOM."
                : "Upload any audio recording, PDF, Word document, or notes file to automatically generate a structured, editable MOM."}
          </DialogDescription>
        </DialogHeader>

        {submitting ? (
          <div className="py-10 flex flex-col items-center justify-center text-center space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <div className="space-y-1 max-w-sm">
              <p className="text-sm font-semibold text-foreground">
                Generating Minutes of the Meeting
              </p>
              <p className="text-xs text-muted-foreground">{progressNote}</p>
            </div>
          </div>
        ) : step === "choose" ? (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStep("record")}
                className="group text-left rounded-xl border border-border bg-card hover:border-primary hover:bg-primary/[0.03] p-5 transition-colors flex flex-col gap-3"
              >
                <div className="h-11 w-11 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Mic className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Record Audio</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Record the live meeting until you click stop. Captures every word verbatim in
                    any language.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStep("upload")}
                className="group text-left rounded-xl border border-border bg-card hover:border-primary hover:bg-primary/[0.03] p-5 transition-colors flex flex-col gap-3"
              >
                <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Upload File</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    Upload any audio (MP3, WAV, M4A, WebM), PDF, Word (.docx/.doc), text, or scanned
                    notes.
                  </p>
                </div>
              </button>
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>Need to write minutes manually instead?</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1.5 text-primary"
                onClick={() => {
                  onOpenChange(false);
                  onCreateBlank();
                }}
              >
                <FilePlus2 className="h-3.5 w-3.5" />
                Blank MOM Editor
              </Button>
            </div>
          </div>
        ) : step === "record" ? (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mom-rec-title" className="text-xs">
                  Meeting Title (optional)
                </Label>
                <Input
                  id="mom-rec-title"
                  value={titleHint}
                  onChange={(e) => setTitleHint(e.target.value)}
                  placeholder="e.g. Weekly Operations Sync"
                  className="h-9 text-xs"
                  maxLength={160}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mom-rec-lang" className="text-xs flex items-center gap-1">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  Spoken Language
                </Label>
                <select
                  id="mom-rec-lang"
                  value={languageHint}
                  onChange={(e) => setLanguageHint(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {LANGUAGE_HINTS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-6 flex flex-col items-center justify-center text-center space-y-4">
              <div
                className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors ${
                  recordingState === "recording"
                    ? "bg-rose-600 text-white shadow-md"
                    : recordingState === "paused"
                      ? "bg-amber-500 text-white"
                      : recordingState === "recorded"
                        ? "bg-emerald-600 text-white"
                        : "bg-primary/10 text-primary"
                }`}
              >
                {recordingState === "recorded" ? (
                  <CheckCircle2 className="h-7 w-7" />
                ) : (
                  <Mic className="h-7 w-7" />
                )}
              </div>

              <div className="space-y-1">
                <p className="font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatSecondsTimer(elapsedSec)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {recordingState === "idle"
                    ? "Click Start Recording to begin capturing the meeting"
                    : recordingState === "recording"
                      ? "Recording in progress — every word is being captured"
                      : recordingState === "paused"
                        ? "Recording paused — resume or stop to generate MOM"
                        : "Recording complete — listen back or generate MOM"}
                </p>
              </div>

              {/* Live Voice Input Level Meter */}
              {(recordingState === "recording" || recordingState === "paused") && (
                <div className="w-full max-w-xs space-y-1">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-rose-500 transition-all duration-75"
                      style={{
                        width: `${recordingState === "paused" ? 0 : Math.max(6, audioLevel)}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {recordingState === "recorded" && recordedUrl && (
                <div className="w-full max-w-sm pt-1">
                  <audio controls src={recordedUrl} className="w-full h-9" />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {recordingState === "idle" && (
                  <Button type="button" onClick={() => void startRecording()} className="gap-1.5">
                    <Mic className="h-4 w-4" />
                    Start Recording
                  </Button>
                )}

                {(recordingState === "recording" || recordingState === "paused") && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={togglePauseRecording}
                      className="gap-1.5"
                    >
                      {recordingState === "recording" ? (
                        <>
                          <Pause className="h-4 w-4" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" /> Resume
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => stopRecording(false)}
                      className="gap-1.5"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop &amp; Preview
                    </Button>
                    <Button
                      type="button"
                      onClick={() => stopRecording(true)}
                      className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      <Square className="h-3.5 w-3.5" />
                      Stop &amp; Create MOM
                    </Button>
                  </>
                )}

                {recordingState === "recorded" && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleResetRecording}
                      className="gap-1.5"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Re-record
                    </Button>
                    <Button type="button" onClick={handleGenerateFromRecorded} className="gap-1.5">
                      Generate MOM from Recording
                    </Button>
                  </>
                )}
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={recordingState === "recording" || recordingState === "paused"}
                onClick={() => {
                  setErrorMsg(null);
                  setStep("choose");
                }}
              >
                Back
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Supports multilingual &amp; code-switched speech
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mom-up-title" className="text-xs">
                  Meeting Title (optional)
                </Label>
                <Input
                  id="mom-up-title"
                  value={titleHint}
                  onChange={(e) => setTitleHint(e.target.value)}
                  placeholder="Auto-detected if left blank"
                  className="h-9 text-xs"
                  maxLength={160}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mom-up-lang" className="text-xs flex items-center gap-1">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  Source Language
                </Label>
                <select
                  id="mom-up-lang"
                  value={languageHint}
                  onChange={(e) => setLanguageHint(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  {LANGUAGE_HINTS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_MOM_SOURCE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                handlePickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                handlePickFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-7 text-center transition-colors ${
                dragActive
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/25 hover:border-primary/60 hover:bg-muted/40"
              }`}
            >
              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    {selectedFile.type.startsWith("audio/") ? (
                      <FileAudio className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </div>
                  <p className="text-sm font-semibold text-foreground break-all">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatFileBytes(selectedFile.size)} · Click to choose a different file
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Upload className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    Click to select or drag &amp; drop a file
                  </p>
                  <p className="text-xs text-muted-foreground max-w-sm">
                    Audio (MP3, WAV, M4A, WebM, OGG, AAC, FLAC), PDF, Word (.docx / .doc), Text
                    (.txt, .md), or Scanned Notes (PNG/JPG) · up to 25 MB
                  </p>
                </div>
              )}
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setErrorMsg(null);
                  setStep("choose");
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={!selectedFile}
                onClick={handleGenerateFromUpload}
                className="gap-1.5"
              >
                Generate MOM
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
