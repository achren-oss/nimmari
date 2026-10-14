"use client";

import { useState, useRef, useCallback } from "react";
import { Document, Page } from "react-pdf";
import "@/components/PdfWorker";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

export type FieldType = "text" | "textarea" | "checkbox" | "signature" | "date" | "hetu";

export type EditorField = {
  id: string;
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  required: boolean;
};

const PAGE_WIDTH = 800;
const DEFAULTS: Record<FieldType, { width: number; height: number; label: string }> = {
  text: { width: 180, height: 32, label: "Text" },
  textarea: { width: 240, height: 100, label: "Multiline text" },
  checkbox: { width: 24, height: 24, label: "Check" },
  signature: { width: 220, height: 70, label: "Sign here" },
  date: { width: 150, height: 32, label: "Date" },
  hetu: { width: 150, height: 32, label: "Personal identity code" },
};

export function FieldEditor({
  documentId,
  initialFields,
}: {
  documentId: string;
  initialFields: EditorField[];
}) {
  const [numPages, setNumPages] = useState(0);
  const [pageWidths, setPageWidths] = useState<Record<number, number>>({});
  const [tool, setTool] = useState<FieldType>("text");
  const [fields, setFields] = useState<EditorField[]>(initialFields);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const fileSrc = `/api/documents/${documentId}/pdf`;

  const onPageClick = useCallback(
    (page: number, e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - target.left;
      const y = e.clientY - target.top;
      const d = DEFAULTS[tool];
      const fieldHeight = tool === "signature" ? Math.max(d.height, Math.ceil(45 * PAGE_WIDTH / (pageWidths[page] ?? 595))) : d.height;
      const newField: EditorField = {
        id: `tmp_${Math.random().toString(36).slice(2)}`,
        type: tool,
        page,
        x: Math.round(x - d.width / 2),
        y: Math.round(y - fieldHeight / 2),
        width: d.width,
        height: fieldHeight,
        label: d.label,
        required: true,
      };
      setFields((f) => [...f, newField]);
    },
    [tool, pageWidths],
  );

  function startDrag(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    const target = e.currentTarget.parentElement!.getBoundingClientRect();
    dragRef.current = {
      id,
      offsetX: e.clientX - target.left - f.x,
      offsetY: e.clientY - target.top - f.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onDragMove(e: React.PointerEvent, page: number) {
    if (!dragRef.current) return;
    const target = e.currentTarget.getBoundingClientRect();
    const x = Math.round(e.clientX - target.left - dragRef.current.offsetX);
    const y = Math.round(e.clientY - target.top - dragRef.current.offsetY);
    setFields((arr) =>
      arr.map((f) => (f.id === dragRef.current!.id && f.page === page ? { ...f, x, y } : f)),
    );
  }

  function endDrag() {
    dragRef.current = null;
  }

  function removeField(id: string) {
    setFields((f) => f.filter((x) => x.id !== id));
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/documents/${documentId}/fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip client-only id
        fields: fields.map(({ id: _id, ...rest }) => rest),
      }),
    });
    setSaving(false);
    if (res.ok) setSavedAt(new Date().toLocaleTimeString());
  }

  return (
    <div className="editor-grid">
      <aside className="editor-side">
        <div className="side-card">
          <h3>Place a field</h3>
          <div className="tool-list">
            {(["text", "textarea", "checkbox", "signature", "date", "hetu"] as FieldType[]).map((t) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`tool-btn ${tool === t ? "on" : ""}`}
              >
                <span className="tool-ico">{(t === "text" || t === "textarea" || t === "date" || t === "hetu") ? "T" : t === "checkbox" ? "☐" : "✎"}</span>
                {t === "text" ? "Text field" : t === "textarea" ? "Multiline text" : t === "checkbox" ? "Checkbox" : t === "date" ? "Date" : t === "hetu" ? "Personal identity code" : "Signature"}
              </button>
            ))}
          </div>
          <p className="side-hint" style={{ marginTop: 12 }}>
            Click on the page to drop. Drag to move. Double-click to remove.
          </p>
        </div>

        <div className="side-card">
          <h3>{fields.length} field{fields.length === 1 ? "" : "s"} placed</h3>
          <button onClick={save} disabled={saving} className="btn-primary big" style={{ marginTop: 8 }}>
            {saving ? "Saving..." : "Save fields"} <span className="arr">→</span>
          </button>
          {savedAt && <p className="side-confirm" style={{ marginTop: 8 }}>Saved at {savedAt}</p>}
        </div>
      </aside>

      <div className="editor-canvas">
        <Document
          file={fileSrc}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<div className="text-muted italic">Loading PDF…</div>}
        >
          <div className="pdf-stack">
            {Array.from({ length: numPages }, (_, i) => (
              <div
                key={i}
                className="pdf-page-wrap"
                style={{ width: PAGE_WIDTH }}
                onClick={(e) => onPageClick(i, e)}
                onPointerMove={(e) => onDragMove(e, i)}
                onPointerUp={endDrag}
              >
                <Page pageNumber={i + 1} width={PAGE_WIDTH} renderTextLayer={false}
                  onLoadSuccess={(page) => setPageWidths((widths) => ({ ...widths, [i]: page.getViewport({ scale: 1 }).width }))}
                />
                {fields
                  .filter((f) => f.page === i)
                  .map((f) => (
                    <div
                      key={f.id}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={() => removeField(f.id)}
                      onPointerDown={(e) => startDrag(e, f.id)}
                      className="pdf-field"
                      style={{
                        left: f.x,
                        top: f.y,
                        width: f.width,
                        height: f.height,
                      }}
                    >
                      <span className="pdf-field-tag">{f.type}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </Document>
      </div>
    </div>
  );
}
