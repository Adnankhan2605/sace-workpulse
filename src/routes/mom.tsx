import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  FileSignature,
  Loader2,
  Mic,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell, EmptyState, PageHeader } from "@/components/app-shell";
import { MomCreateDialog } from "@/components/mom-create-dialog";
import { MomEditor } from "@/components/mom-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBlankMomTemplate, parseJsonResponseSafe } from "@/lib/mom";
import { getClientSessionToken } from "@/lib/portal-session-client";
import { useApp } from "@/lib/store";
import type { MomBrandAsset, MomDocument } from "@/lib/types";

export const Route = createFileRoute("/mom")({
  head: () => ({
    meta: [{ title: "MOM — Minutes of the Meeting · SACE Workpulse" }],
  }),
  component: MomPage,
});

function MomPage() {
  const { me, ready, state } = useApp();
  const [documents, setDocuments] = React.useState<MomDocument[]>([]);
  const [brandAssets, setBrandAssets] = React.useState<MomBrandAsset[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [activeDocId, setActiveDocId] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterTab, setFilterTab] = React.useState<"all" | "mine" | "shared">("all");

  const fetchWorkspace = React.useCallback(async () => {
    if (!ready || !me) return;
    setLoading(true);
    try {
      const token = getClientSessionToken();
      const res = await fetch("/api/mom/workspace", {
        method: "GET",
        credentials: "include",
        ...(token ? { headers: { "x-sace-session": token } } : {}),
      });
      const payload = await parseJsonResponseSafe<{
        ok?: boolean;
        documents?: MomDocument[];
        brandAssets?: MomBrandAsset[];
        error?: string;
      }>(res, "Failed to load MOM workspace");
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to load MOM workspace.");
      }
      setDocuments(Array.isArray(payload.documents) ? payload.documents : []);
      setBrandAssets(Array.isArray(payload.brandAssets) ? payload.brandAssets : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load MOM library.");
    } finally {
      setLoading(false);
    }
  }, [ready, me]);

  React.useEffect(() => {
    void fetchWorkspace();
  }, [fetchWorkspace]);

  const userNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const u of state.users ?? []) {
      map.set(u.id, u.fullName);
    }
    return map;
  }, [state.users]);

  const activeDoc = React.useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? null,
    [documents, activeDocId],
  );

  const filteredDocs = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (filterTab === "mine" && doc.createdBy !== me?.id) return false;
      if (filterTab === "shared" && doc.createdBy === me?.id && doc.visibility === "private") {
        return false;
      }
      if (!q) return true;
      return (
        doc.title.toLowerCase().includes(q) ||
        (doc.department ?? "").toLowerCase().includes(q) ||
        (doc.location ?? "").toLowerCase().includes(q) ||
        doc.participants.some((p) => p.toLowerCase().includes(q)) ||
        (doc.detectedLanguage ?? "").toLowerCase().includes(q)
      );
    });
  }, [documents, filterTab, searchQuery, me?.id]);

  const handleSaveDoc = async (nextDoc: MomDocument) => {
    const token = getClientSessionToken();
    const res = await fetch("/api/mom/documents", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-sace-session": token } : {}),
      },
      body: JSON.stringify(nextDoc),
    });
    const payload = await parseJsonResponseSafe<{
      ok?: boolean;
      document?: MomDocument;
      error?: string;
    }>(res, "Could not save MOM");
    if (!res.ok || !payload.ok || !payload.document) {
      toast.error(payload.error || "Could not save MOM.");
      throw new Error(payload.error || "Save failed");
    }
    const saved = payload.document;
    setDocuments((prev) => {
      const exists = prev.some((d) => d.id === saved.id);
      return exists ? prev.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...prev];
    });
    setActiveDocId(saved.id);
    toast.success("MOM saved successfully.");
  };

  const handleDeleteDoc = async (docId: string) => {
    try {
      const token = getClientSessionToken();
      const res = await fetch(`/api/mom/documents/${encodeURIComponent(docId)}`, {
        method: "DELETE",
        credentials: "include",
        ...(token ? { headers: { "x-sace-session": token } } : {}),
      });
      const payload = await parseJsonResponseSafe<{ ok?: boolean; error?: string }>(
        res,
        "Could not delete MOM",
      );
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Could not delete MOM.");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      if (activeDocId === docId) setActiveDocId(null);
      toast.success("MOM deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handleCreateBlank = async () => {
    if (!me) return;
    const blank = createBlankMomTemplate(me.id);
    const defaultLh =
      brandAssets.find((a) => a.kind === "letterhead" && a.isDefault) ??
      brandAssets.find((a) => a.kind === "letterhead") ??
      null;
    if (defaultLh) {
      blank.letterheadEnabled = true;
      blank.letterheadAssetId = defaultLh.id;
      blank.letterheadMode = defaultLh.letterheadMode ?? "header";
    }
    try {
      await handleSaveDoc(blank);
    } catch {
      // Error already toasted
    }
  };

  const canEditActiveDoc = Boolean(
    activeDoc &&
    me &&
    (activeDoc.createdBy === me.id ||
      ((me.role === "super_admin" || me.role === "admin") && activeDoc.visibility !== "private")),
  );

  return (
    <AppShell>
      {!ready || !me ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeDoc ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveDocId(null)}
                className="gap-1.5 whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                All MOMs
              </Button>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-foreground truncate">
                  {activeDoc.title}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Created by {userNameById.get(activeDoc.createdBy) ?? "Team Member"} · Updated{" "}
                  {new Date(activeDoc.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="gap-1.5 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              Create MOM
            </Button>
          </div>

          <MomEditor
            doc={activeDoc}
            brandAssets={brandAssets}
            teamUsers={state.users ?? []}
            canEdit={canEditActiveDoc}
            onSaveDoc={handleSaveDoc}
            onDeleteDoc={handleDeleteDoc}
            onAssetUploaded={(asset) =>
              setBrandAssets((prev) => [
                asset,
                ...prev.map((a) =>
                  asset.kind === "letterhead" && a.kind === "letterhead"
                    ? { ...a, isDefault: false }
                    : a,
                ),
              ])
            }
            onAssetDeleted={(assetId) =>
              setBrandAssets((prev) => prev.filter((a) => a.id !== assetId))
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <PageHeader
            title="MOM"
            description="Minutes of the Meeting — record live multilingual audio or upload audio/documents/PDFs, customize with CMS tools, letterhead, stamps & signatures, and share across teams."
            actions={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchWorkspace()}
                  disabled={loading}
                  className="gap-1.5 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  className="gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Plus className="h-4 w-4" />
                  Create MOM
                </Button>
              </div>
            }
          />

          {/* Search & Interactive Segmented Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search MOM title, department, attendee, or language..."
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  { id: "all", label: `All (${documents.length})` },
                  {
                    id: "mine",
                    label: `My MOMs (${documents.filter((d) => d.createdBy === me.id).length})`,
                  },
                  {
                    id: "shared",
                    label: `Shared (${documents.filter((d) => d.visibility !== "private").length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                    filterTab === tab.id
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* MOM Library List */}
          {loading ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((k) => (
                <div
                  key={k}
                  className="h-20 rounded-xl border border-border bg-card animate-pulse"
                />
              ))}
            </div>
          ) : filteredDocs.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title={documents.length === 0 ? "No Minutes of the Meeting yet" : "No matching MOMs"}
              description={
                documents.length === 0
                  ? "Click Create MOM to record a meeting in any language or upload an audio file, PDF, or Word document."
                  : "Try adjusting your search query or filter tab."
              }
              action={
                <Button type="button" onClick={() => setCreateOpen(true)} className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Create First MOM
                </Button>
              }
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
              {filteredDocs.map((doc) => {
                const authorName = userNameById.get(doc.createdBy) ?? "Team Member";
                const openActions = doc.actionItems.filter((a) => a.status !== "Completed").length;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setActiveDocId(doc.id)}
                    className="w-full text-left px-5 py-4 hover:bg-muted/40 transition-colors flex flex-wrap items-center justify-between gap-4"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-bold text-foreground truncate">
                          {doc.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">{doc.meetingDate}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          {doc.sourceType === "recording" ? (
                            <Mic className="h-3 w-3" />
                          ) : doc.sourceType === "upload" ? (
                            <Upload className="h-3 w-3" />
                          ) : null}
                          {doc.sourceType === "recording"
                            ? "Recorded Audio"
                            : doc.sourceType === "upload"
                              ? "Uploaded File"
                              : "Manual Draft"}
                        </span>
                        {doc.detectedLanguage && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{doc.detectedLanguage}</span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>By {authorName}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {doc.visibility === "team"
                            ? "Shared with Team"
                            : doc.visibility === "selected"
                              ? `Shared (${doc.sharedWithIds.length})`
                              : "Private"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{doc.actionItems.length}</p>
                        <p className="text-[11px]">
                          {openActions > 0 ? `${openActions} open` : "Actions"}
                        </p>
                      </div>
                      <div className="text-right hidden sm:block">
                        <p className="font-semibold text-foreground">{doc.overlays.length}</p>
                        <p className="text-[11px]">Stamps / Signs</p>
                      </div>
                      <span className="text-xs font-semibold text-primary whitespace-nowrap">
                        Open Editor →
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <MomCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(newDoc) => {
          setDocuments((prev) => [newDoc, ...prev]);
          setActiveDocId(newDoc.id);
        }}
        onCreateBlank={() => void handleCreateBlank()}
      />
    </AppShell>
  );
}
