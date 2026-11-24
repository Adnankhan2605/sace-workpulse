import { jsPDF } from "jspdf";
import { sanitizeMomHtml } from "./mom";
import type { MomBrandAsset, MomDocument } from "./types";

function slugifyFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "minutes-of-meeting").slice(0, 64);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

async function fetchImageAsDataUrl(url: string): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  format: "PNG" | "JPEG";
} | null> {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read asset image"));
      reader.readAsDataURL(blob);
    });

    const dims = await new Promise<{ width: number; height: number }>((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 160 });
      img.onerror = () => resolve({ width: 400, height: 160 });
      img.src = dataUrl;
    });

    const format: "PNG" | "JPEG" =
      dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")
        ? "JPEG"
        : "PNG";

    // Convert WEBP to PNG via canvas so jsPDF & Word handle it universally
    if (dataUrl.startsWith("data:image/webp")) {
      const pngUrl = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || 400;
          canvas.height = img.naturalHeight || 160;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/png"));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });
      return { dataUrl: pngUrl, width: dims.width, height: dims.height, format: "PNG" };
    }

    return { dataUrl, width: dims.width, height: dims.height, format };
  } catch {
    return null;
  }
}

async function buildSelfContainedDocumentHtml(
  doc: MomDocument,
  letterhead: MomBrandAsset | null,
  options: { includeLetterhead: boolean; forWord?: boolean },
): Promise<string> {
  const lhData =
    options.includeLetterhead && letterhead ? await fetchImageAsDataUrl(letterhead.url) : null;
  const lhMode = doc.letterheadMode ?? letterhead?.letterheadMode ?? "header";

  const overlayEntries = await Promise.all(
    (doc.overlays ?? []).map(async (ov) => {
      const img = await fetchImageAsDataUrl(ov.url);
      return img ? { ov, img } : null;
    }),
  );
  const validOverlays = overlayEntries.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  );

  const actionRowsHtml =
    doc.actionItems.length > 0
      ? `
      <section class="mom-actions">
        <h2>Action Items &amp; Ownership</h2>
        <table>
          <thead>
            <tr>
              <th style="width:48%">Action Item</th>
              <th style="width:20%">Owner</th>
              <th style="width:17%">Deadline</th>
              <th style="width:15%">Status</th>
            </tr>
          </thead>
          <tbody>
            ${doc.actionItems
              .map(
                (item) => `
              <tr>
                <td>${escapeHtml(item.task)}</td>
                <td>${escapeHtml(item.owner)}</td>
                <td>${escapeHtml(item.deadline)}</td>
                <td>${escapeHtml(item.status)}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </section>`
      : "";

  const wordOverlayFooterHtml =
    options.forWord && validOverlays.length > 0
      ? `
      <div style="margin-top:32px; padding-top:16px; border-top:1px solid #d4d4d8;">
        <table style="width:100%; border-collapse:collapse; border:none;">
          <tr>
            ${validOverlays
              .map(
                ({ ov, img }) => `
              <td style="border:none; text-align:center; vertical-align:bottom; padding:12px;">
                <img src="${img.dataUrl}" alt="${escapeHtml(ov.label)}" style="max-height:90px; max-width:190px; object-fit:contain;" />
                <div style="font-size:11px; color:#52525b; margin-top:4px;">${escapeHtml(ov.label)}</div>
              </td>`,
              )
              .join("")}
          </tr>
        </table>
      </div>`
      : "";

  const absoluteOverlaysHtml =
    !options.forWord && validOverlays.length > 0
      ? validOverlays
          .map(
            ({ ov, img }) => `
          <img
            src="${img.dataUrl}"
            alt="${escapeHtml(ov.label)}"
            style="position:absolute; left:${ov.xPct}%; top:${ov.yPct}%; width:${ov.widthPct}%; transform:rotate(${ov.rotation}deg); opacity:${ov.opacity}; pointer-events:none; z-index:20; object-fit:contain;"
          />`,
          )
          .join("\n")
      : "";

  const headerBannerHtml =
    lhData && lhMode === "header"
      ? `<div class="letterhead-header"><img src="${lhData.dataUrl}" alt="Organization Letterhead" style="width:100%; max-height:145px; object-fit:contain; display:block;" /></div>`
      : "";

  const fullpageBgStyle =
    lhData && lhMode === "fullpage"
      ? `background-image:url('${lhData.dataUrl}'); background-size:100% 100%; background-repeat:no-repeat; padding-top:130px; padding-bottom:90px;`
      : "";

  const safeBody = sanitizeMomHtml(doc.contentHtml);

  return `<!DOCTYPE html>
<html lang="en" ${options.forWord ? 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ""}>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(doc.title)} — Minutes of the Meeting</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: #18181b;
      background: #ffffff;
      line-height: 1.6;
      font-size: 13px;
    }
    .sheet {
      position: relative;
      width: 100%;
      max-width: 794px;
      min-height: 1080px;
      margin: 0 auto;
      padding: 36px 44px;
      background: #ffffff;
      ${fullpageBgStyle}
    }
    .letterhead-header {
      margin-bottom: 18px;
      padding-bottom: 12px;
      border-bottom: 2px solid #2d0029;
    }
    .doc-kicker {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b21a8;
      font-weight: 700;
      margin: 0 0 4px 0;
    }
    h1.doc-title {
      font-size: 22px;
      font-weight: 800;
      margin: 0 0 14px 0;
      color: #18181b;
    }
    .meta-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
      border: 1px solid #e4e4e7;
      background: rgba(250, 250, 250, 0.85);
    }
    .meta-grid td {
      padding: 7px 10px;
      border: 1px solid #e4e4e7;
      font-size: 12px;
      vertical-align: top;
    }
    .meta-label {
      font-weight: 700;
      color: #52525b;
      width: 18%;
    }
    .cms-body h1 { font-size: 18px; margin: 18px 0 8px; color: #18181b; }
    .cms-body h2 { font-size: 15px; margin: 16px 0 6px; color: #2d0029; border-bottom: 1px solid #e4e4e7; padding-bottom: 3px; }
    .cms-body h3 { font-size: 13.5px; margin: 12px 0 4px; color: #27272a; }
    .cms-body p { margin: 0 0 8px; }
    .cms-body ul, .cms-body ol { margin: 6px 0 12px; padding-left: 22px; }
    .cms-body li { margin-bottom: 4px; }
    .cms-body blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      background: #f4f4f5;
      border: 1px solid #e4e4e7;
      border-radius: 6px;
      font-style: italic;
    }
    .cms-body table, .mom-actions table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 16px;
      font-size: 12px;
    }
    .cms-body th, .cms-body td, .mom-actions th, .mom-actions td {
      border: 1px solid #d4d4d8;
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    .cms-body th, .mom-actions th {
      background: #f4f4f5;
      font-weight: 700;
      color: #18181b;
    }
    .mom-actions h2 {
      font-size: 15px;
      margin: 20px 0 8px;
      color: #2d0029;
      border-bottom: 1px solid #e4e4e7;
      padding-bottom: 3px;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .sheet { max-width: none; margin: 0; padding: 12px 18px; min-height: 265mm; ${fullpageBgStyle} }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${headerBannerHtml}
    <p class="doc-kicker">Minutes of the Meeting (MOM)</p>
    <h1 class="doc-title">${escapeHtml(doc.title)}</h1>
    <table class="meta-grid">
      <tr>
        <td class="meta-label">Date</td>
        <td>${escapeHtml(doc.meetingDate)}${doc.meetingTime ? ` · ${escapeHtml(doc.meetingTime)}` : ""}</td>
        <td class="meta-label">Department</td>
        <td>${escapeHtml(doc.department || "General")}</td>
      </tr>
      <tr>
        <td class="meta-label">Location</td>
        <td>${escapeHtml(doc.location || "—")}</td>
        <td class="meta-label">Language</td>
        <td>${escapeHtml(doc.detectedLanguage || "English")}</td>
      </tr>
      <tr>
        <td class="meta-label">Participants</td>
        <td colspan="3">${escapeHtml(doc.participants.length > 0 ? doc.participants.join(", ") : "—")}</td>
      </tr>
    </table>
    <div class="cms-body">
      ${safeBody}
    </div>
    ${actionRowsHtml}
    ${wordOverlayFooterHtml}
    ${absoluteOverlaysHtml}
  </div>
</body>
</html>`;
}

function htmlToPlainLines(
  html: string,
): Array<{ type: "h1" | "h2" | "h3" | "p" | "li"; text: string }> {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${sanitizeMomHtml(html)}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root) return [];

  const blocks: Array<{ type: "h1" | "h2" | "h3" | "p" | "li"; text: string }> = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const txt = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (txt) blocks.push({ type: "p", text: txt });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (txt) blocks.push({ type: tag, text: txt });
      return;
    }
    if (tag === "li") {
      const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (txt) blocks.push({ type: "li", text: `• ${txt}` });
      return;
    }
    if (tag === "p" || tag === "blockquote") {
      const txt = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (txt) blocks.push({ type: "p", text: txt });
      return;
    }
    if (tag === "tr") {
      const cells = Array.from(el.querySelectorAll("th,td"))
        .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (cells.length) blocks.push({ type: "p", text: cells.join("  |  ") });
      return;
    }
    Array.from(el.childNodes).forEach(walk);
  };

  Array.from(root.childNodes).forEach(walk);
  return blocks;
}

export async function exportMomAsPdf(
  doc: MomDocument,
  letterhead: MomBrandAsset | null,
  includeLetterhead: boolean,
): Promise<void> {
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth(); // 210mm
  const pageH = pdf.internal.pageSize.getHeight(); // 297mm
  const marginX = 16;
  const contentW = pageW - marginX * 2;

  const lhData = includeLetterhead && letterhead ? await fetchImageAsDataUrl(letterhead.url) : null;
  const lhMode = doc.letterheadMode ?? letterhead?.letterheadMode ?? "header";

  let y = 16;

  const applyPageLetterhead = () => {
    if (!lhData) return;
    if (lhMode === "fullpage") {
      pdf.addImage(lhData.dataUrl, lhData.format, 0, 0, pageW, pageH);
      y = 40;
    }
  };

  applyPageLetterhead();

  if (lhData && lhMode === "header") {
    const ratio = lhData.height / Math.max(lhData.width, 1);
    const drawW = contentW;
    const drawH = Math.min(34, drawW * ratio);
    pdf.addImage(lhData.dataUrl, lhData.format, marginX, y, drawW, drawH);
    y += drawH + 5;
    pdf.setDrawColor(45, 0, 41);
    pdf.setLineWidth(0.5);
    pdf.line(marginX, y, pageW - marginX, y);
    y += 6;
  }

  const ensureSpace = (neededMm: number) => {
    const bottomLimit = lhData && lhMode === "fullpage" ? pageH - 26 : pageH - 18;
    if (y + neededMm > bottomLimit) {
      pdf.addPage();
      y = 18;
      applyPageLetterhead();
    }
  };

  // Kicker & Title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(107, 33, 168);
  pdf.text("MINUTES OF THE MEETING (MOM)", marginX, y);
  y += 6;

  pdf.setFontSize(17);
  pdf.setTextColor(24, 24, 27);
  const titleLines = pdf.splitTextToSize(doc.title, contentW);
  pdf.text(titleLines, marginX, y);
  y += titleLines.length * 7 + 3;

  // Metadata Box
  pdf.setFillColor(248, 248, 250);
  pdf.setDrawColor(228, 228, 231);
  const metaRows = [
    `Date: ${doc.meetingDate}${doc.meetingTime ? ` (${doc.meetingTime})` : ""}   |   Department: ${doc.department || "General"}`,
    `Location: ${doc.location || "—"}   |   Language: ${doc.detectedLanguage || "English"}`,
    `Participants: ${doc.participants.length > 0 ? doc.participants.join(", ") : "—"}`,
  ];
  const wrappedMeta = metaRows.flatMap(
    (line) => pdf.splitTextToSize(line, contentW - 8) as string[],
  );
  const metaBoxH = wrappedMeta.length * 4.8 + 6;
  pdf.roundedRect(marginX, y, contentW, metaBoxH, 2, 2, "FD");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9.5);
  pdf.setTextColor(63, 63, 70);
  let metaY = y + 5.5;
  for (const mLine of wrappedMeta) {
    pdf.text(mLine, marginX + 4, metaY);
    metaY += 4.8;
  }
  y += metaBoxH + 7;

  // Body content
  const blocks = htmlToPlainLines(doc.contentHtml);
  for (const blk of blocks) {
    if (blk.type === "h1" || blk.type === "h2") {
      ensureSpace(12);
      y += 2;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(blk.type === "h1" ? 13 : 11.5);
      pdf.setTextColor(45, 0, 41);
      const lines = pdf.splitTextToSize(blk.text, contentW) as string[];
      pdf.text(lines, marginX, y);
      y += lines.length * 5.6 + 2;
    } else if (blk.type === "h3") {
      ensureSpace(9);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10.5);
      pdf.setTextColor(39, 39, 42);
      const lines = pdf.splitTextToSize(blk.text, contentW) as string[];
      pdf.text(lines, marginX, y);
      y += lines.length * 5 + 1.5;
    } else {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(24, 24, 27);
      const indent = blk.type === "li" ? 4 : 0;
      const lines = pdf.splitTextToSize(blk.text, contentW - indent) as string[];
      for (const l of lines) {
        ensureSpace(6);
        pdf.text(l, marginX + indent, y);
        y += 5;
      }
      y += 1.5;
    }
  }

  // Action items table
  if (doc.actionItems.length > 0) {
    ensureSpace(24);
    y += 4;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11.5);
    pdf.setTextColor(45, 0, 41);
    pdf.text("Action Items & Ownership", marginX, y);
    y += 5;

    const colW = [contentW * 0.48, contentW * 0.2, contentW * 0.17, contentW * 0.15];
    const headers = ["Action Item", "Owner", "Deadline", "Status"];

    pdf.setFillColor(244, 244, 245);
    pdf.setDrawColor(212, 212, 216);
    pdf.rect(marginX, y, contentW, 7, "FD");
    pdf.setFontSize(9);
    pdf.setTextColor(24, 24, 27);
    let cx = marginX + 2;
    headers.forEach((h, idx) => {
      pdf.text(h, cx, y + 4.8);
      cx += colW[idx]!;
    });
    y += 7;

    pdf.setFont("helvetica", "normal");
    for (const item of doc.actionItems) {
      const taskLines = pdf.splitTextToSize(item.task, colW[0]! - 4) as string[];
      const rowH = Math.max(7, taskLines.length * 4.5 + 3);
      ensureSpace(rowH + 2);
      pdf.setDrawColor(212, 212, 216);
      pdf.rect(marginX, y, contentW, rowH);
      pdf.text(taskLines, marginX + 2, y + 4.5);
      pdf.text(
        pdf.splitTextToSize(item.owner, colW[1]! - 3) as string[],
        marginX + colW[0]! + 2,
        y + 4.5,
      );
      pdf.text(
        pdf.splitTextToSize(item.deadline, colW[2]! - 3) as string[],
        marginX + colW[0]! + colW[1]! + 2,
        y + 4.5,
      );
      pdf.text(item.status, marginX + colW[0]! + colW[1]! + colW[2]! + 2, y + 4.5);
      y += rowH;
    }
  }

  // Render Digital Stamps & Digital Signatures at exact coordinates on the last/active page (or page 1 if single page)
  if (doc.overlays && doc.overlays.length > 0) {
    const totalPages = pdf.getNumberOfPages();
    pdf.setPage(totalPages);
    for (const ov of doc.overlays) {
      const img = await fetchImageAsDataUrl(ov.url);
      if (!img) continue;
      const drawW = (ov.widthPct / 100) * pageW;
      const drawH = drawW * (img.height / Math.max(img.width, 1));
      const drawX = (ov.xPct / 100) * pageW;
      const drawY = Math.min(pageH - drawH - 6, Math.max(6, (ov.yPct / 100) * pageH));
      pdf.addImage(
        img.dataUrl,
        img.format,
        drawX,
        drawY,
        drawW,
        drawH,
        undefined,
        "FAST",
        -ov.rotation,
      );
    }
  }

  pdf.save(`${slugifyFileName(doc.title)}.pdf`);
}

export async function exportMomAsWord(
  doc: MomDocument,
  letterhead: MomBrandAsset | null,
  includeLetterhead: boolean,
): Promise<void> {
  const html = await buildSelfContainedDocumentHtml(doc, letterhead, {
    includeLetterhead,
    forWord: true,
  });
  const blob = new Blob(["\ufeff", html], {
    type: "application/msword;charset=utf-8",
  });
  triggerBlobDownload(blob, `${slugifyFileName(doc.title)}.doc`);
}

export async function exportMomAsHtml(
  doc: MomDocument,
  letterhead: MomBrandAsset | null,
  includeLetterhead: boolean,
): Promise<void> {
  const html = await buildSelfContainedDocumentHtml(doc, letterhead, {
    includeLetterhead,
    forWord: false,
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  triggerBlobDownload(blob, `${slugifyFileName(doc.title)}.html`);
}

export function exportMomAsMarkdown(doc: MomDocument): void {
  const lines: string[] = [
    `# ${doc.title}`,
    "",
    `- **Date:** ${doc.meetingDate}${doc.meetingTime ? ` ${doc.meetingTime}` : ""}`,
    `- **Department:** ${doc.department || "General"}`,
    `- **Location:** ${doc.location || "—"}`,
    `- **Language:** ${doc.detectedLanguage || "English"}`,
    `- **Participants:** ${doc.participants.length > 0 ? doc.participants.join(", ") : "—"}`,
    "",
  ];

  const blocks = htmlToPlainLines(doc.contentHtml);
  for (const blk of blocks) {
    if (blk.type === "h1") lines.push(`# ${blk.text}`, "");
    else if (blk.type === "h2") lines.push(`## ${blk.text}`, "");
    else if (blk.type === "h3") lines.push(`### ${blk.text}`, "");
    else if (blk.type === "li") lines.push(`- ${blk.text.replace(/^•\s*/, "")}`);
    else lines.push(blk.text, "");
  }

  if (doc.actionItems.length > 0) {
    lines.push(
      "",
      "## Action Items",
      "",
      "| Task | Owner | Deadline | Status |",
      "| --- | --- | --- | --- |",
    );
    for (const item of doc.actionItems) {
      lines.push(`| ${item.task} | ${item.owner} | ${item.deadline} | ${item.status} |`);
    }
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  triggerBlobDownload(blob, `${slugifyFileName(doc.title)}.md`);
}

export function exportMomAsText(doc: MomDocument): void {
  const lines: string[] = [
    `MINUTES OF THE MEETING (MOM)`,
    `Title: ${doc.title}`,
    `Date: ${doc.meetingDate}${doc.meetingTime ? ` (${doc.meetingTime})` : ""}`,
    `Department: ${doc.department || "General"}`,
    `Location: ${doc.location || "—"}`,
    `Participants: ${doc.participants.length > 0 ? doc.participants.join(", ") : "—"}`,
    "=".repeat(60),
    "",
  ];

  const blocks = htmlToPlainLines(doc.contentHtml);
  for (const blk of blocks) {
    lines.push(blk.text);
    if (blk.type !== "li") lines.push("");
  }

  if (doc.actionItems.length > 0) {
    lines.push("", "ACTION ITEMS", "-".repeat(40));
    doc.actionItems.forEach((item, idx) => {
      lines.push(
        `${idx + 1}. ${item.task} — Owner: ${item.owner} | Deadline: ${item.deadline} | Status: ${item.status}`,
      );
    });
  }

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  triggerBlobDownload(blob, `${slugifyFileName(doc.title)}.txt`);
}

export async function printMomDocument(
  doc: MomDocument,
  letterhead: MomBrandAsset | null,
  includeLetterhead: boolean,
): Promise<void> {
  const html = await buildSelfContainedDocumentHtml(doc, letterhead, {
    includeLetterhead,
    forWord: false,
  });

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    window.print();
    return;
  }

  iframeDoc.open();
  iframeDoc.write(html);
  iframeDoc.close();

  await new Promise((resolve) => window.setTimeout(resolve, 350));
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();

  window.setTimeout(() => {
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }, 1500);
}
