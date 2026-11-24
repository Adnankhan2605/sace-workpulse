import * as React from "react";
import { Eraser, Check, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MomSignaturePadProps {
  onSaveSignature: (file: File, label: string) => Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

const PEN_COLORS = [
  { id: "navy", label: "Executive Navy", hex: "#1e3a8a" },
  { id: "black", label: "Jet Black", hex: "#0f172a" },
  { id: "plum", label: "SACE Plum", hex: "#4a044e" },
] as const;

export function MomSignaturePad({ onSaveSignature, onCancel, saving }: MomSignaturePadProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawingRef = React.useRef(false);
  const [hasStroke, setHasStroke] = React.useState(false);
  const [penColor, setPenColor] = React.useState<string>(PEN_COLORS[0].hex);
  const [label, setLabel] = React.useState("Authorized Signature");

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pt = getPoint(e);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 3.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    drawingRef.current = true;
    setHasStroke(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const pt = getPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStroke) return;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png"),
    );
    if (!blob) return;
    const safeSlug =
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-") || "signature";
    const file = new File([blob], `${safeSlug}.png`, { type: "image/png" });
    await onSaveSignature(file, label.trim() || "Digital Signature");
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <PenTool className="h-3.5 w-3.5 text-primary" />
          Draw Digital Signature
        </div>
        <div className="flex items-center gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPenColor(c.hex)}
              title={c.label}
              aria-label={`Ink color ${c.label}`}
              className={`h-4 w-4 rounded-full border border-border transition-transform ${
                c.id === "navy"
                  ? "bg-blue-900"
                  : c.id === "black"
                    ? "bg-slate-900"
                    : "bg-fuchsia-950"
              } ${penColor === c.hex ? "ring-2 ring-primary ring-offset-1 scale-110" : "opacity-70 hover:opacity-100"}`}
            />
          ))}
        </div>
      </div>

      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Signature name (e.g. Managing Director)"
        className="h-8 text-xs bg-background"
        maxLength={80}
      />

      <div className="relative rounded-lg border border-dashed border-border bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={520}
          height={180}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-32 touch-none cursor-crosshair block"
        />
        {!hasStroke && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Sign here with mouse or touch
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleClear}
          className="h-8 text-xs gap-1"
        >
          <Eraser className="h-3.5 w-3.5" />
          Clear
        </Button>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasStroke || saving}
            onClick={() => void handleSave()}
            className="h-8 text-xs gap-1"
          >
            <Check className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Save Signature"}
          </Button>
        </div>
      </div>
    </div>
  );
}
