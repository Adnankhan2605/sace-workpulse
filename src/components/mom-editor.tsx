import * as React from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  FileCode2,
  FileDown,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Lock,
  Minus,
  Move,
  PenTool,
  Plus,
  Printer,
  Quote,
  Redo2,
  RotateCw,
  Save,
  Share2,
  Stamp,
  Strikethrough,
  Table2,
  Trash2,
  Type as TypeIcon,
  Underline,
  Undo2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MomSignaturePad } from "@/components/mom-signature-pad";
import {
  MAX_MOM_ASSET_BYTES,
  fileToBase64,
  parseJsonResponseSafe,
  sanitizeMomHtml,
} from "@/lib/mom";
import {
  exportMomAsHtml,
  exportMomAsMarkdown,
  exportMomAsPdf,
  exportMomAsText,
  exportMomAsWord,
  printMomDocument,
} from "@/lib/mom-export";
import { getClientSessionToken } from "@/lib/portal-session-client";
import type {
  MomActionItem,
  MomBrandAsset,
  MomDocument,
  MomOverlayElement,
  User,
} from "@/lib/types";

interface MomEditorProps {
  doc: MomDocument;
  brandAssets: MomBrandAsset[];
  teamUsers: User[];
  canEdit: boolean;
  onSaveDoc: (nextDoc: MomDocument) => Promise<void>;
  onDeleteDoc: (docId: string) => Promise<void>;
  onAssetUploaded: (asset: MomBrandAsset) => void;
  onAssetDeleted: (assetId: string) => void;
}

export function MomEditor({
  doc,
  brandAssets,
  teamUsers,
  canEdit,
  onSaveDoc,
  onDeleteDoc,
  onAssetUploaded,
  onAssetDeleted,
}: MomEditorProps) {
  const [draft, setDraft] = React.useState<MomDocument>(doc);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [participantInput, setParticipantInput] = React.useState("");
  const [showTranscript, setShowTranscript] = React.useState(false);

  // Draggable overlay state
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = React.useState<string | null>(null);
  const dragInfoRef = React.useRef<{
    overlayId: string;
    startClientX: number;
    startClientY: number;
    origXPct: number;
    origYPct: number;
  } | null>(null);

  // Brand assets upload state
  const [uploadingKind, setUploadingKind] = React.useState<
    "letterhead" | "stamp" | "signature" | null
  >(null);
  const [letterheadUploadMode, setLetterheadUploadMode] = React.useState<"header" | "fullpage">(
    "header",
  );
  const [showSignaturePad, setShowSignaturePad] = React.useState(false);
  const letterheadInputRef = React.useRef<HTMLInputElement | null>(null);
  const stampInputRef = React.useRef<HTMLInputElement | null>(null);
  const signatureInputRef = React.useRef<HTMLInputElement | null>(null);

  // Dialogs
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportUseLetterhead, setExportUseLetterhead] = React.useState(doc.letterheadEnabled);
  const [exportingFormat, setExportingFormat] = React.useState<string | null>(null);
  const [shareOpen, setShareOpen] = React.useState(false);

  // Sync draft when switching documents
  React.useEffect(() => {
    setDraft(doc);
    setDirty(false);
    setSelectedOverlayId(null);
    setExportUseLetterhead(doc.letterheadEnabled);
    if (editorRef.current && editorRef.current.innerHTML !== doc.contentHtml) {
      editorRef.current.innerHTML = sanitizeMomHtml(doc.contentHtml);
    }
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep contentEditable initialized on mount
  React.useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = sanitizeMomHtml(draft.contentHtml);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateDraft = React.useCallback((updater: (prev: MomDocument) => MomDocument) => {
    setDraft((prev) => updater(prev));
    setDirty(true);
  }, []);

  const letterheads = React.useMemo(
    () => brandAssets.filter((a) => a.kind === "letterhead"),
    [brandAssets],
  );
  const stamps = React.useMemo(() => brandAssets.filter((a) => a.kind === "stamp"), [brandAssets]);
  const signatures = React.useMemo(
    () => brandAssets.filter((a) => a.kind === "signature"),
    [brandAssets],
  );

  const activeLetterhead = React.useMemo(() => {
    if (!draft.letterheadAssetId) return letterheads[0] ?? null;
    return letterheads.find((a) => a.id === draft.letterheadAssetId) ?? letterheads[0] ?? null;
  }, [draft.letterheadAssetId, letterheads]);

  // Rich text CMS commands
  const execCmsCommand = (command: string, value?: string) => {
    if (!canEdit || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(command, false, value);
    const nextHtml = sanitizeMomHtml(editorRef.current.innerHTML);
    updateDraft((prev) => ({ ...prev, contentHtml: nextHtml }));
  };

  const insertHtmlSnippet = (snippet: string) => {
    if (!canEdit || !editorRef.current) return;
    editorRef.current.focus();
    document.execCommand("insertHTML", false, snippet);
    const nextHtml = sanitizeMomHtml(editorRef.current.innerHTML);
    updateDraft((prev) => ({ ...prev, contentHtml: nextHtml }));
  };

  const handleInsertTable = () => {
    insertHtmlSnippet(
      `<table><thead><tr><th>Topic</th><th>Key Discussion</th><th>Decision / Owner</th></tr></thead><tbody><tr><td>Item 1</td><td>Details...</td><td>Owner</td></tr><tr><td>Item 2</td><td>Details...</td><td>Owner</td></tr></tbody></table><p><br/></p>`,
    );
  };

  const handleInsertCallout = () => {
    insertHtmlSnippet(
      `<blockquote><strong>Key Decision / Highlight:</strong> Enter important note or resolution here.</blockquote><p><br/></p>`,
    );
  };

  const handleAppendTranscript = () => {
    if (!draft.verbatimTranscript?.trim() || !editorRef.current) return;
    const escaped = draft.verbatimTranscript
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
    const nextHtml = sanitizeMomHtml(
      `${editorRef.current.innerHTML}<h2>Verbatim Transcript</h2><p>${escaped}</p>`,
    );
    editorRef.current.innerHTML = nextHtml;
    updateDraft((prev) => ({ ...prev, contentHtml: nextHtml }));
    toast.success("Verbatim transcript appended to the MOM body.");
  };

  // Participants
  const handleAddParticipant = () => {
    const clean = participantInput.trim();
    if (!clean) return;
    if (draft.participants.includes(clean)) {
      setParticipantInput("");
      return;
    }
    updateDraft((prev) => ({ ...prev, participants: [...prev.participants, clean] }));
    setParticipantInput("");
  };

  const handleRemoveParticipant = (name: string) => {
    updateDraft((prev) => ({
      ...prev,
      participants: prev.participants.filter((p) => p !== name),
    }));
  };

  // Action Items
  const handleAddActionItem = () => {
    const newItem: MomActionItem = {
      id: `ai-${Date.now()}`,
      task: "",
      owner: "",
      deadline: draft.meetingDate || new Date().toISOString().slice(0, 10),
      status: "Open",
    };
    updateDraft((prev) => ({ ...prev, actionItems: [...prev.actionItems, newItem] }));
  };

  const handleUpdateActionItem = (id: string, patch: Partial<MomActionItem>) => {
    updateDraft((prev) => ({
      ...prev,
      actionItems: prev.actionItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
  };

  const handleRemoveActionItem = (id: string) => {
    updateDraft((prev) => ({
      ...prev,
      actionItems: prev.actionItems.filter((item) => item.id !== id),
    }));
  };

  // Upload reusable Letterhead / Stamp / Signature
  const uploadAssetFile = async (
    file: File,
    kind: "letterhead" | "stamp" | "signature",
    customName?: string,
    lhMode?: "header" | "fullpage",
  ) => {
    if (file.size > MAX_MOM_ASSET_BYTES) {
      toast.error("Asset image exceeds the 10 MB limit.");
      return;
    }
    setUploadingKind(kind);
    try {
      const base64Data = await fileToBase64(file);
      const token = getClientSessionToken();
      const res = await fetch("/api/mom/assets", {
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
          kind,
          name: customName,
          letterheadMode: kind === "letterhead" ? (lhMode ?? letterheadUploadMode) : undefined,
        }),
      });
      const payload = await parseJsonResponseSafe<{
        ok?: boolean;
        asset?: MomBrandAsset;
        error?: string;
      }>(res, "Failed to upload asset");
      if (!res.ok || !payload.ok || !payload.asset) {
        throw new Error(payload.error || "Failed to upload asset.");
      }

      const savedAsset = payload.asset;
      onAssetUploaded(savedAsset);

      if (kind === "letterhead") {
        updateDraft((prev) => ({
          ...prev,
          letterheadEnabled: true,
          letterheadAssetId: savedAsset.id,
          letterheadMode: savedAsset.letterheadMode ?? "header",
        }));
        setExportUseLetterhead(true);
        toast.success("Organization letterhead saved & applied (reusable on all future MOMs).");
      } else {
        // Automatically drop newly uploaded stamp/signature onto MOM so user can drag it immediately
        placeOverlayAsset(savedAsset);
        toast.success(
          kind === "stamp"
            ? "Digital stamp saved & placed on MOM — drag anywhere to position."
            : "Digital signature saved & placed on MOM — drag anywhere to position.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload asset.");
    } finally {
      setUploadingKind(null);
    }
  };

  const handleDeleteBrandAsset = async (asset: MomBrandAsset) => {
    try {
      const token = getClientSessionToken();
      const res = await fetch(`/api/mom/assets/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
        credentials: "include",
        ...(token ? { headers: { "x-sace-session": token } } : {}),
      });
      const payload = await parseJsonResponseSafe<{ ok?: boolean; error?: string }>(
        res,
        "Failed to delete asset",
      );
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to delete asset.");
      }
      onAssetDeleted(asset.id);
      if (draft.letterheadAssetId === asset.id) {
        updateDraft((prev) => ({
          ...prev,
          letterheadAssetId: null,
          letterheadEnabled: false,
        }));
      }
      toast.success("Asset removed from library.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete asset.");
    }
  };

  // Place draggable Stamp / Signature onto MOM sheet
  const placeOverlayAsset = (asset: MomBrandAsset) => {
    if (!canEdit) return;
    const isStamp = asset.kind === "stamp";
    const offsetIndex = (draft.overlays.length % 4) * 4;
    const newOverlay: MomOverlayElement = {
      id: `ov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: isStamp ? "stamp" : "signature",
      assetId: asset.id,
      label: asset.name,
      url: asset.url,
      xPct: isStamp ? Math.min(72, 64 - offsetIndex) : Math.min(68, 12 + offsetIndex),
      yPct: Math.min(82, 74 - offsetIndex),
      widthPct: isStamp ? 19 : 24,
      rotation: isStamp ? -8 : 0,
      opacity: isStamp ? 0.9 : 1,
    };
    updateDraft((prev) => ({ ...prev, overlays: [...prev.overlays, newOverlay] }));
    setSelectedOverlayId(newOverlay.id);
  };

  const updateOverlay = (overlayId: string, patch: Partial<MomOverlayElement>) => {
    updateDraft((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) => (o.id === overlayId ? { ...o, ...patch } : o)),
    }));
  };

  const removeOverlay = (overlayId: string) => {
    updateDraft((prev) => ({
      ...prev,
      overlays: prev.overlays.filter((o) => o.id !== overlayId),
    }));
    if (selectedOverlayId === overlayId) setSelectedOverlayId(null);
  };

  // Drag overlay anywhere across the entire A4 MOM sheet
  const handleOverlayPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    overlay: MomOverlayElement,
  ) => {
    if (!canEdit) return;
    e.stopPropagation();
    setSelectedOverlayId(overlay.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragInfoRef.current = {
      overlayId: overlay.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origXPct: overlay.xPct,
      origYPct: overlay.yPct,
    };
  };

  const handleOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragInfoRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;

    const rect = sheet.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const dxPct = ((e.clientX - drag.startClientX) / rect.width) * 100;
    const dyPct = ((e.clientY - drag.startClientY) / rect.height) * 100;

    const nextX = Math.max(0, Math.min(92, Number((drag.origXPct + dxPct).toFixed(2))));
    const nextY = Math.max(0, Math.min(92, Number((drag.origYPct + dyPct).toFixed(2))));

    setDraft((prev) => ({
      ...prev,
      overlays: prev.overlays.map((o) =>
        o.id === drag.overlayId ? { ...o, xPct: nextX, yPct: nextY } : o,
      ),
    }));
    setDirty(true);
  };

  const handleOverlayPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragInfoRef.current) return;
    dragInfoRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture already released
    }
  };

  // Save MOM to PostgreSQL
  const handleSave = async (overrideDoc?: MomDocument) => {
    const toSave: MomDocument = {
      ...(overrideDoc ?? draft),
      contentHtml: sanitizeMomHtml(
        editorRef.current?.innerHTML ?? (overrideDoc ?? draft).contentHtml,
      ),
    };
    setSaving(true);
    try {
      await onSaveDoc(toSave);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // Export / Print handler
  const runExport = async (format: "pdf" | "doc" | "html" | "md" | "txt" | "print") => {
    const liveDoc: MomDocument = {
      ...draft,
      contentHtml: sanitizeMomHtml(editorRef.current?.innerHTML ?? draft.contentHtml),
      letterheadEnabled: exportUseLetterhead,
      letterheadAssetId: exportUseLetterhead ? (activeLetterhead?.id ?? null) : null,
    };

    if (exportUseLetterhead && !activeLetterhead) {
      toast.error("Please upload an Organization Letterhead first, or switch letterhead off.");
      return;
    }

    setExportingFormat(format);
    try {
      if (format === "pdf") {
        await exportMomAsPdf(liveDoc, activeLetterhead, exportUseLetterhead);
        toast.success("Downloaded MOM as PDF.");
      } else if (format === "doc") {
        await exportMomAsWord(liveDoc, activeLetterhead, exportUseLetterhead);
        toast.success("Downloaded MOM as Word Document (.doc).");
      } else if (format === "html") {
        await exportMomAsHtml(liveDoc, activeLetterhead, exportUseLetterhead);
        toast.success("Downloaded MOM as HTML document.");
      } else if (format === "md") {
        exportMomAsMarkdown(liveDoc);
        toast.success("Downloaded MOM as Markdown (.md).");
      } else if (format === "txt") {
        exportMomAsText(liveDoc);
        toast.success("Downloaded MOM as Plain Text (.txt).");
      } else if (format === "print") {
        await printMomDocument(liveDoc, activeLetterhead, exportUseLetterhead);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportingFormat(null);
    }
  };

  const selectedOverlay = draft.overlays.find((o) => o.id === selectedOverlayId) ?? null;
  const effectiveLetterheadMode =
    draft.letterheadMode ?? activeLetterhead?.letterheadMode ?? "header";

  return (
    <div className="space-y-4">
      {/* Hidden File Inputs for Reusable Organization Assets */}
      <input
        ref={letterheadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadAssetFile(f, "letterhead", undefined, letterheadUploadMode);
        }}
      />
      <input
        ref={stampInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadAssetFile(f, "stamp");
        }}
      />
      <input
        ref={signatureInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadAssetFile(f, "signature");
        }}
      />

      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground capitalize">
              {draft.sourceType === "recording"
                ? "Audio Recording"
                : draft.sourceType === "upload"
                  ? "Uploaded Source"
                  : "Manual Draft"}
            </span>
            {draft.detectedLanguage && (
              <>
                <span aria-hidden="true">·</span>
                <span>{draft.detectedLanguage}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {draft.visibility === "team"
                ? "Shared with Entire Team"
                : draft.visibility === "selected"
                  ? `Shared with ${draft.sharedWithIds.length} member${draft.sharedWithIds.length === 1 ? "" : "s"}`
                  : "Private"}
            </span>
            {dirty && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  Unsaved changes
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              type="button"
              size="sm"
              onClick={() => void handleSave()}
              disabled={saving}
              className="gap-1.5 whitespace-nowrap shrink-0"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save MOM"}
            </Button>
          )}
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShareOpen(true)}
              className="gap-1.5 whitespace-nowrap shrink-0"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setExportUseLetterhead(draft.letterheadEnabled);
              setExportOpen(true);
            }}
            className="gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Download / Print
          </Button>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void onDeleteDoc(draft.id)}
              title="Delete this MOM"
              className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Main Split Workspace: Left = CMS Toolbar + A4 Sheet Canvas, Right = Letterhead, Stamps & Signatures */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_310px] gap-5 items-start">
        <div className="space-y-3 min-w-0">
          {/* Complete CMS Formatting Toolbar */}
          {canEdit && (
            <div className="sticky top-2 z-30 rounded-2xl border border-border bg-card/95 backdrop-blur-xs p-2 shadow-xs">
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Undo"
                  onClick={() => execCmsCommand("undo")}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Redo"
                  onClick={() => execCmsCommand("redo")}
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </Button>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                {/* Font Family */}
                <select
                  aria-label="Font Family"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) execCmsCommand("fontName", e.target.value);
                  }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
                >
                  <option value="" disabled>
                    Font
                  </option>
                  <option value="Plus Jakarta Sans, Arial, sans-serif">Sans Serif</option>
                  <option value="Georgia, Times New Roman, serif">Editorial Serif</option>
                  <option value="Courier New, monospace">Monospace</option>
                </select>

                {/* Font Size */}
                <select
                  aria-label="Font Size"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) execCmsCommand("fontSize", e.target.value);
                  }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
                >
                  <option value="" disabled>
                    Size
                  </option>
                  <option value="2">Small</option>
                  <option value="3">Normal</option>
                  <option value="4">Medium</option>
                  <option value="5">Large</option>
                  <option value="6">XL</option>
                </select>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Heading 1"
                  onClick={() => execCmsCommand("formatBlock", "<h1>")}
                >
                  <Heading1 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Heading 2"
                  onClick={() => execCmsCommand("formatBlock", "<h2>")}
                >
                  <Heading2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Heading 3"
                  onClick={() => execCmsCommand("formatBlock", "<h3>")}
                >
                  <Heading3 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Normal Paragraph"
                  onClick={() => execCmsCommand("formatBlock", "<p>")}
                >
                  <TypeIcon className="h-3.5 w-3.5" />
                </Button>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Bold"
                  onClick={() => execCmsCommand("bold")}
                >
                  <Bold className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Italic"
                  onClick={() => execCmsCommand("italic")}
                >
                  <Italic className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Underline"
                  onClick={() => execCmsCommand("underline")}
                >
                  <Underline className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Strikethrough"
                  onClick={() => execCmsCommand("strikeThrough")}
                >
                  <Strikethrough className="h-3.5 w-3.5" />
                </Button>

                {/* Text & Highlight Colors */}
                <label
                  title="Text Color"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted relative"
                >
                  <span className="text-xs font-bold underline decoration-2 decoration-primary">
                    A
                  </span>
                  <input
                    type="color"
                    defaultValue="#18181b"
                    onChange={(e) => execCmsCommand("foreColor", e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                <label
                  title="Highlight Color"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted relative"
                >
                  <Highlighter className="h-3.5 w-3.5" />
                  <input
                    type="color"
                    defaultValue="#fef08a"
                    onChange={(e) => execCmsCommand("hiliteColor", e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Align Left"
                  onClick={() => execCmsCommand("justifyLeft")}
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Align Center"
                  onClick={() => execCmsCommand("justifyCenter")}
                >
                  <AlignCenter className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Align Right"
                  onClick={() => execCmsCommand("justifyRight")}
                >
                  <AlignRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Justify"
                  onClick={() => execCmsCommand("justifyFull")}
                >
                  <AlignJustify className="h-3.5 w-3.5" />
                </Button>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Bullet List"
                  onClick={() => execCmsCommand("insertUnorderedList")}
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Numbered List"
                  onClick={() => execCmsCommand("insertOrderedList")}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Outdent"
                  onClick={() => execCmsCommand("outdent")}
                >
                  <IndentDecrease className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Indent"
                  onClick={() => execCmsCommand("indent")}
                >
                  <IndentIncrease className="h-3.5 w-3.5" />
                </Button>

                <span className="h-5 w-px bg-border mx-1" aria-hidden="true" />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs gap-1"
                  title="Insert Editable Table"
                  onClick={handleInsertTable}
                >
                  <Table2 className="h-3.5 w-3.5" />
                  Table
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs gap-1"
                  title="Insert Decision Callout"
                  onClick={handleInsertCallout}
                >
                  <Quote className="h-3.5 w-3.5" />
                  Callout
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Insert Divider Line"
                  onClick={() => execCmsCommand("insertHorizontalRule")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Clear Formatting"
                  onClick={() => execCmsCommand("removeFormat")}
                >
                  <Eraser className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Selected Stamp / Signature Fine-Tuning Bar */}
          {selectedOverlay && canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/[0.04] px-3.5 py-2 text-xs">
              <div className="flex items-center gap-2 font-semibold text-foreground">
                <Move className="h-3.5 w-3.5 text-primary" />
                <span>
                  Selected {selectedOverlay.kind === "stamp" ? "Stamp" : "Signature"}:{" "}
                  {selectedOverlay.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <span>Size</span>
                  <input
                    type="range"
                    min={8}
                    max={48}
                    value={Math.round(selectedOverlay.widthPct)}
                    onChange={(e) =>
                      updateOverlay(selectedOverlay.id, { widthPct: Number(e.target.value) })
                    }
                    className="w-20 accent-primary"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <RotateCw className="h-3 w-3" />
                  <input
                    type="range"
                    min={-45}
                    max={45}
                    value={Math.round(selectedOverlay.rotation)}
                    onChange={(e) =>
                      updateOverlay(selectedOverlay.id, { rotation: Number(e.target.value) })
                    }
                    className="w-20 accent-primary"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={30}
                    max={100}
                    value={Math.round(selectedOverlay.opacity * 100)}
                    onChange={(e) =>
                      updateOverlay(selectedOverlay.id, { opacity: Number(e.target.value) / 100 })
                    }
                    className="w-16 accent-primary"
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOverlay(selectedOverlay.id)}
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedOverlayId(null)}
                  className="h-7 w-7"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* A4 Live Editable Document Sheet with Letterhead + Full-Page Draggable Overlays */}
          <div className="rounded-2xl border border-border bg-muted/40 p-3 sm:p-6 overflow-x-auto">
            <div
              ref={sheetRef}
              onClick={() => setSelectedOverlayId(null)}
              className={`relative mx-auto w-full max-w-[820px] min-h-[1040px] rounded-xl bg-white text-zinc-900 shadow-sm border border-zinc-200 overflow-hidden ${
                draft.letterheadEnabled &&
                activeLetterhead &&
                effectiveLetterheadMode === "fullpage"
                  ? "pt-32 pb-24 px-8 sm:px-12"
                  : "p-6 sm:p-11"
              }`}
            >
              {/* Full-Page Letterhead Background Layer */}
              {draft.letterheadEnabled &&
                activeLetterhead &&
                effectiveLetterheadMode === "fullpage" && (
                  <img
                    src={activeLetterhead.url}
                    alt={activeLetterhead.name}
                    referrerPolicy="no-referrer"
                    className="pointer-events-none select-none absolute inset-0 h-full w-full object-fill z-0"
                  />
                )}

              {/* Sheet Foreground Content */}
              <div className="relative z-10 space-y-5">
                {/* Header Banner Letterhead Mode */}
                {draft.letterheadEnabled &&
                  activeLetterhead &&
                  effectiveLetterheadMode === "header" && (
                    <div className="pb-4 border-b-2 border-[#2D0029]">
                      <img
                        src={activeLetterhead.url}
                        alt={activeLetterhead.name}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-36 object-contain mx-auto block"
                      />
                    </div>
                  )}

                {/* Document Title & Kicker */}
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold tracking-wider uppercase text-purple-900">
                    Minutes of the Meeting (MOM)
                  </p>
                  {canEdit ? (
                    <input
                      type="text"
                      value={draft.title}
                      onChange={(e) => updateDraft((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="Enter meeting title..."
                      className="w-full bg-transparent text-2xl font-extrabold text-zinc-900 outline-none border-b border-transparent focus:border-purple-400 pb-0.5"
                    />
                  ) : (
                    <h2 className="text-2xl font-extrabold text-zinc-900">{draft.title}</h2>
                  )}
                </div>

                {/* Editable Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-lg border border-zinc-200 bg-zinc-50/85 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-500 w-20 shrink-0">Date</span>
                    <input
                      type="date"
                      disabled={!canEdit}
                      value={draft.meetingDate}
                      onChange={(e) =>
                        updateDraft((prev) => ({ ...prev, meetingDate: e.target.value }))
                      }
                      className="flex-1 bg-white/80 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-500 w-20 shrink-0">Time</span>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={draft.meetingTime ?? ""}
                      placeholder="e.g. 10:30 AM"
                      onChange={(e) =>
                        updateDraft((prev) => ({ ...prev, meetingTime: e.target.value }))
                      }
                      className="flex-1 bg-white/80 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-500 w-20 shrink-0">Department</span>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={draft.department ?? ""}
                      placeholder="e.g. Operations / Sales"
                      onChange={(e) =>
                        updateDraft((prev) => ({ ...prev, department: e.target.value }))
                      }
                      className="flex-1 bg-white/80 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-500 w-20 shrink-0">Location</span>
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={draft.location ?? ""}
                      placeholder="Room / Virtual Call"
                      onChange={(e) =>
                        updateDraft((prev) => ({ ...prev, location: e.target.value }))
                      }
                      className="flex-1 bg-white/80 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-900 outline-none focus:border-purple-500"
                    />
                  </div>

                  {/* Participants */}
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5 pt-1 border-t border-zinc-200/80">
                    <span className="font-semibold text-zinc-500 w-20 shrink-0">Attendees</span>
                    <div className="flex flex-wrap items-center gap-1.5 flex-1">
                      {draft.participants.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 rounded-md bg-white border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-800"
                        >
                          {p}
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleRemoveParticipant(p)}
                              className="text-zinc-400 hover:text-rose-600"
                              aria-label={`Remove ${p}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit && (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            value={participantInput}
                            onChange={(e) => setParticipantInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddParticipant();
                              }
                            }}
                            placeholder="+ Add attendee"
                            className="w-32 bg-white/90 rounded border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-900 outline-none focus:border-purple-500"
                          />
                          {participantInput.trim() && (
                            <button
                              type="button"
                              onClick={handleAddParticipant}
                              className="rounded bg-zinc-900 text-white px-1.5 py-0.5 text-[10px] font-semibold"
                            >
                              Add
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Rich Editable CMS Body */}
                <div
                  ref={editorRef}
                  contentEditable={canEdit}
                  suppressContentEditableWarning
                  onInput={(e) => {
                    const html = sanitizeMomHtml(e.currentTarget.innerHTML);
                    setDraft((prev) => ({ ...prev, contentHtml: html }));
                    setDirty(true);
                  }}
                  className="min-h-[340px] rounded-lg px-2 py-1 text-sm leading-relaxed text-zinc-800 outline-none focus:ring-1 focus:ring-purple-300/70 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-zinc-900 [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-[#2D0029] [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-zinc-200 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-zinc-900 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3 [&_li]:mb-1 [&_blockquote]:my-3 [&_blockquote]:p-3 [&_blockquote]:rounded-md [&_blockquote]:bg-zinc-100/90 [&_blockquote]:border [&_blockquote]:border-zinc-200 [&_blockquote]:italic [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-zinc-300 [&_th]:bg-zinc-100 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_td]:border [&_td]:border-zinc-300 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:text-xs [&_hr]:my-4 [&_hr]:border-zinc-200"
                />

                {/* Editable Action Items Table */}
                <div className="pt-3 border-t border-zinc-200 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#2D0029]">
                      Action Items &amp; Ownership
                    </h3>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={handleAddActionItem}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50"
                      >
                        <Plus className="h-3 w-3" />
                        Add Action Item
                      </button>
                    )}
                  </div>

                  {draft.actionItems.length === 0 ? (
                    <p className="text-xs italic text-zinc-500">
                      No action items listed yet. Click &quot;Add Action Item&quot; to assign
                      follow-ups.
                    </p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-zinc-200">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-zinc-100 text-zinc-700">
                            <th className="border-b border-zinc-200 px-2.5 py-2 text-left font-semibold">
                              Action Item
                            </th>
                            <th className="border-b border-zinc-200 px-2.5 py-2 text-left font-semibold w-32">
                              Owner
                            </th>
                            <th className="border-b border-zinc-200 px-2.5 py-2 text-left font-semibold w-28">
                              Deadline
                            </th>
                            <th className="border-b border-zinc-200 px-2.5 py-2 text-left font-semibold w-28">
                              Status
                            </th>
                            {canEdit && <th className="border-b border-zinc-200 w-8" />}
                          </tr>
                        </thead>
                        <tbody>
                          {draft.actionItems.map((item) => (
                            <tr key={item.id} className="border-b border-zinc-100 last:border-b-0">
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  disabled={!canEdit}
                                  value={item.task}
                                  onChange={(e) =>
                                    handleUpdateActionItem(item.id, { task: e.target.value })
                                  }
                                  placeholder="Describe follow-up task..."
                                  className="w-full bg-transparent outline-none text-zinc-900 focus:bg-zinc-50 rounded px-1 py-0.5"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  disabled={!canEdit}
                                  value={item.owner}
                                  onChange={(e) =>
                                    handleUpdateActionItem(item.id, { owner: e.target.value })
                                  }
                                  placeholder="Owner"
                                  className="w-full bg-transparent outline-none text-zinc-800 focus:bg-zinc-50 rounded px-1 py-0.5"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="text"
                                  disabled={!canEdit}
                                  value={item.deadline}
                                  onChange={(e) =>
                                    handleUpdateActionItem(item.id, { deadline: e.target.value })
                                  }
                                  placeholder="YYYY-MM-DD"
                                  className="w-full bg-transparent outline-none text-zinc-800 tabular-nums focus:bg-zinc-50 rounded px-1 py-0.5"
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <select
                                  disabled={!canEdit}
                                  value={item.status}
                                  onChange={(e) =>
                                    handleUpdateActionItem(item.id, {
                                      status: e.target.value as MomActionItem["status"],
                                    })
                                  }
                                  className="w-full rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-zinc-800 outline-none"
                                >
                                  <option value="Open">Open</option>
                                  <option value="In Progress">In Progress</option>
                                  <option value="Completed">Completed</option>
                                </select>
                              </td>
                              {canEdit && (
                                <td className="px-1 py-1.5 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveActionItem(item.id)}
                                    className="text-zinc-400 hover:text-rose-600 p-0.5"
                                    title="Remove action item"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Draggable Digital Stamps & Digital Signatures Layer (Free-Drag Over Entire MOM Sheet) */}
              {draft.overlays.map((ov) => {
                const isSelected = selectedOverlayId === ov.id;
                return (
                  <div
                    key={ov.id}
                    onPointerDown={(e) => handleOverlayPointerDown(e, ov)}
                    onPointerMove={handleOverlayPointerMove}
                    onPointerUp={handleOverlayPointerUp}
                    onPointerCancel={handleOverlayPointerUp}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (canEdit) setSelectedOverlayId(ov.id);
                    }}
                    title={
                      canEdit
                        ? "Drag anywhere on the MOM to position · click to resize or rotate"
                        : ov.label
                    }
                    className={`absolute z-20 select-none touch-none ${
                      canEdit ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"
                    } ${
                      isSelected
                        ? "ring-2 ring-primary ring-offset-2 rounded-md bg-primary/5"
                        : canEdit
                          ? "hover:ring-1 hover:ring-primary/50 rounded-md"
                          : ""
                    }`}
                    style={{
                      left: `${ov.xPct}%`,
                      top: `${ov.yPct}%`,
                      width: `${ov.widthPct}%`,
                      transform: `rotate(${ov.rotation}deg)`,
                      opacity: ov.opacity,
                    }}
                  >
                    <img
                      src={ov.url}
                      alt={ov.label}
                      draggable={false}
                      referrerPolicy="no-referrer"
                      className="w-full h-auto object-contain pointer-events-none block"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verbatim Transcript Collapsible Section */}
          {Boolean(draft.verbatimTranscript) && (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTranscript((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
              >
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Verbatim Transcript / Extracted Source Text
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Full word-for-word capture from your recording or uploaded document
                  </p>
                </div>
                {showTranscript ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showTranscript && (
                <div className="border-t border-border p-4 space-y-3">
                  <textarea
                    value={draft.verbatimTranscript ?? ""}
                    disabled={!canEdit}
                    onChange={(e) =>
                      updateDraft((prev) => ({ ...prev, verbatimTranscript: e.target.value }))
                    }
                    rows={7}
                    className="w-full rounded-xl border border-border bg-muted/25 p-3 text-xs leading-relaxed text-foreground outline-none focus:border-primary"
                  />
                  {canEdit && (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAppendTranscript}
                        className="text-xs"
                      >
                        Append Transcript to MOM Document
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Inspector: Organization Letterhead, Digital Stamps & Digital Signatures */}
        <div className="space-y-4">
          {/* 1. Organization Letterhead */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ImagePlus className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Organization Letterhead</h3>
              </div>
              <Switch
                checked={draft.letterheadEnabled}
                disabled={!canEdit || letterheads.length === 0}
                onCheckedChange={(checked) => {
                  const chosenId = draft.letterheadAssetId ?? letterheads[0]?.id ?? null;
                  updateDraft((prev) => ({
                    ...prev,
                    letterheadEnabled: checked,
                    letterheadAssetId: checked ? chosenId : prev.letterheadAssetId,
                  }));
                  setExportUseLetterhead(checked);
                }}
              />
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload your organization letterhead once and apply it to any current or future MOM.
            </p>

            {canEdit && (
              <div className="space-y-2">
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setLetterheadUploadMode("header");
                      if (draft.letterheadEnabled) {
                        updateDraft((prev) => ({ ...prev, letterheadMode: "header" }));
                      }
                    }}
                    className={`flex-1 rounded-md py-1 font-medium transition-colors ${
                      effectiveLetterheadMode === "header"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Header Banner
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLetterheadUploadMode("fullpage");
                      if (draft.letterheadEnabled) {
                        updateDraft((prev) => ({ ...prev, letterheadMode: "fullpage" }));
                      }
                    }}
                    className={`flex-1 rounded-md py-1 font-medium transition-colors ${
                      effectiveLetterheadMode === "fullpage"
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Full Page A4
                  </button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingKind === "letterhead"}
                  onClick={() => letterheadInputRef.current?.click()}
                  className="w-full h-8 text-xs gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingKind === "letterhead"
                    ? "Uploading..."
                    : letterheads.length > 0
                      ? "Upload Another Letterhead"
                      : "Upload Organization Letterhead"}
                </Button>
              </div>
            )}

            {letterheads.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {letterheads.map((lh) => {
                  const isActive =
                    draft.letterheadEnabled &&
                    (draft.letterheadAssetId === lh.id ||
                      (!draft.letterheadAssetId && letterheads[0]?.id === lh.id));
                  return (
                    <div
                      key={lh.id}
                      className={`group flex items-center gap-2 rounded-lg border p-1.5 transition-colors ${
                        isActive
                          ? "border-primary bg-primary/[0.04]"
                          : "border-border bg-muted/20 hover:bg-muted/40"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          updateDraft((prev) => ({
                            ...prev,
                            letterheadEnabled: true,
                            letterheadAssetId: lh.id,
                            letterheadMode: lh.letterheadMode ?? "header",
                          }));
                          setExportUseLetterhead(true);
                        }}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        <img
                          src={lh.url}
                          alt={lh.name}
                          referrerPolicy="no-referrer"
                          className="h-8 w-12 rounded border border-border bg-white object-contain shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground truncate">{lh.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {lh.letterheadMode === "fullpage"
                              ? "Full-page template"
                              : "Header banner"}
                          </p>
                        </div>
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteBrandAsset(lh)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
                          title="Delete letterhead"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Digital Stamp Library (Draggable on MOM) */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Stamp className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Digital Stamp</h3>
              </div>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingKind === "stamp"}
                  onClick={() => stampInputRef.current?.click()}
                  className="h-7 px-2 text-[11px] gap-1"
                >
                  <Upload className="h-3 w-3" />
                  {uploadingKind === "stamp" ? "..." : "Upload"}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload your official seal/stamp (PNG recommended). Click to place and drag anywhere on
              the MOM.
            </p>

            {stamps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                No digital stamps uploaded yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stamps.map((st) => (
                  <div
                    key={st.id}
                    className="group relative rounded-xl border border-border bg-muted/20 p-2 flex flex-col items-center gap-1.5"
                  >
                    <img
                      src={st.url}
                      alt={st.name}
                      referrerPolicy="no-referrer"
                      className="h-14 w-full object-contain rounded bg-white p-1"
                    />
                    <p className="text-[11px] font-medium text-foreground truncate w-full text-center">
                      {st.name}
                    </p>
                    {canEdit && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => placeOverlayAsset(st)}
                          className="h-6 w-full text-[11px]"
                        >
                          Place on MOM
                        </Button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteBrandAsset(st)}
                          className="opacity-0 group-hover:opacity-100 absolute top-1.5 right-1.5 rounded bg-background/90 p-1 text-muted-foreground hover:text-destructive transition-opacity"
                          title="Delete stamp"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Digital Signature Library (Upload or Draw + Draggable on MOM) */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PenTool className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Digital Signature</h3>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowSignaturePad((v) => !v)}
                    className="h-7 px-2 text-[11px] gap-1"
                  >
                    <PenTool className="h-3 w-3" />
                    Draw
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingKind === "signature"}
                    onClick={() => signatureInputRef.current?.click()}
                    className="h-7 px-2 text-[11px] gap-1"
                  >
                    <Upload className="h-3 w-3" />
                    {uploadingKind === "signature" ? "..." : "Upload"}
                  </Button>
                </div>
              )}
            </div>

            {showSignaturePad && canEdit && (
              <MomSignaturePad
                saving={uploadingKind === "signature"}
                onCancel={() => setShowSignaturePad(false)}
                onSaveSignature={async (file, label) => {
                  await uploadAssetFile(file, "signature", label);
                  setShowSignaturePad(false);
                }}
              />
            )}

            <p className="text-xs text-muted-foreground leading-relaxed">
              Upload a signature image or draw one live. Place and drag anywhere across the MOM.
            </p>

            {signatures.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                No digital signatures saved yet.
              </div>
            ) : (
              <div className="space-y-2">
                {signatures.map((sig) => (
                  <div
                    key={sig.id}
                    className="group flex items-center gap-2 rounded-xl border border-border bg-muted/20 p-2"
                  >
                    <img
                      src={sig.url}
                      alt={sig.name}
                      referrerPolicy="no-referrer"
                      className="h-10 w-20 rounded bg-white p-1 object-contain border border-border shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{sig.name}</p>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => placeOverlayAsset(sig)}
                          className="mt-0.5 text-[11px] font-semibold text-primary hover:underline"
                        >
                          + Place on MOM
                        </button>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteBrandAsset(sig)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-destructive transition-opacity"
                        title="Delete signature"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Download & Print Dialog (Explicitly asks about Organization Letterhead!) */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Download or Print MOM</DialogTitle>
            <DialogDescription>
              Choose whether to put this MOM on your Organization Letterhead, then download in any
              document format or print.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {/* Organization Letterhead Prompt Box */}
            <div className="rounded-xl border border-border bg-muted/30 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-foreground">
                    Put on Organization Letterhead?
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {activeLetterhead
                      ? `Using saved letterhead: "${activeLetterhead.name}"`
                      : "Upload your letterhead once and reuse it for all future MOMs."}
                  </p>
                </div>
                <Switch
                  checked={exportUseLetterhead}
                  disabled={!activeLetterhead}
                  onCheckedChange={(checked) => {
                    setExportUseLetterhead(checked);
                    if (canEdit) {
                      updateDraft((prev) => ({
                        ...prev,
                        letterheadEnabled: checked,
                        letterheadAssetId: checked
                          ? (activeLetterhead?.id ?? null)
                          : prev.letterheadAssetId,
                      }));
                    }
                  }}
                />
              </div>

              {letterheads.length > 1 && exportUseLetterhead && (
                <select
                  value={activeLetterhead?.id ?? ""}
                  onChange={(e) => {
                    const chosen = letterheads.find((l) => l.id === e.target.value);
                    if (chosen && canEdit) {
                      updateDraft((prev) => ({
                        ...prev,
                        letterheadEnabled: true,
                        letterheadAssetId: chosen.id,
                        letterheadMode: chosen.letterheadMode ?? "header",
                      }));
                    }
                  }}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  {letterheads.map((lh) => (
                    <option key={lh.id} value={lh.id}>
                      {lh.name} ({lh.letterheadMode === "fullpage" ? "Full Page" : "Header Banner"})
                    </option>
                  ))}
                </select>
              )}

              {!activeLetterhead && canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingKind === "letterhead"}
                  onClick={() => letterheadInputRef.current?.click()}
                  className="w-full h-8 text-xs gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadingKind === "letterhead"
                    ? "Uploading Letterhead..."
                    : "Upload Organization Letterhead Now"}
                </Button>
              )}
            </div>

            {/* Export Formats Grid */}
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="default"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("pdf")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <FileDown className="h-4 w-4 shrink-0" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">PDF Document</p>
                  <p className="text-[10px] opacity-80 mt-0.5">.pdf with stamps &amp; letterhead</p>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("doc")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-blue-600" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">Word Document</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    .doc editable in MS Word
                  </p>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("html")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <FileCode2 className="h-4 w-4 shrink-0 text-purple-600" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">Web / HTML</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">.html standalone sheet</p>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("md")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">Markdown (.md)</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">For docs &amp; wikis</p>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("txt")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">Plain Text (.txt)</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Clean email-ready text</p>
                </div>
              </Button>

              <Button
                type="button"
                variant="secondary"
                disabled={exportingFormat !== null}
                onClick={() => void runExport("print")}
                className="h-11 justify-start gap-2.5 px-3.5"
              >
                <Printer className="h-4 w-4 shrink-0" />
                <div className="text-left">
                  <p className="text-xs font-bold leading-none">Print MOM</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Formatted A4 print view
                  </p>
                </div>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Share MOM Among Teams Dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Share MOM with Team</DialogTitle>
            <DialogDescription>
              Control who in your organization can view this Minutes of the Meeting. Shared
              teammates receive an instant portal notification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "private", label: "Private", icon: Lock },
                  { id: "team", label: "Entire Team", icon: Users },
                  { id: "selected", label: "Selected", icon: Share2 },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const active = draft.visibility === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => updateDraft((prev) => ({ ...prev, visibility: opt.id }))}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {draft.visibility === "selected" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Select Team Members</Label>
                <div className="max-h-52 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {teamUsers
                    .filter((u) => u.active && u.id !== draft.createdBy)
                    .map((user) => {
                      const checked = draft.sharedWithIds.includes(user.id);
                      return (
                        <button
                          key={user.id}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            updateDraft((prev) => ({
                              ...prev,
                              sharedWithIds: checked
                                ? prev.sharedWithIds.filter((id) => id !== user.id)
                                : [...prev.sharedWithIds, user.id],
                            }));
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {user.fullName}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {user.designation} · {user.department}
                            </p>
                          </div>
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? "bg-primary border-primary text-primary-foreground"
                                : "border-muted-foreground/40"
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 stroke-[3]" />}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShareOpen(false)}>
                Close
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    await handleSave();
                    setShareOpen(false);
                    toast.success("Sharing settings saved & team notified.");
                  }}
                >
                  {saving ? "Saving..." : "Save & Notify"}
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
