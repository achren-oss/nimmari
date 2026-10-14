"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { signatureCanvasDataUrl } from "@/lib/signature-canvas";

const FONTS = [
  { id: "Caveat", weight: 600, size: 38 },
  { id: "Dancing Script", weight: 600, size: 38 },
  { id: "Allura", weight: 400, size: 46 },
  { id: "Mr Dafoe", weight: 400, size: 44 },
] as const;
type FontId = (typeof FONTS)[number]["id"];

export type Mode = "draw" | "type" | "upload";

export type SignatureWidgetHandle = {
  getDataUrl: () => string | null;
  clear: () => void;
};

type Props = {
  initialName?: string;
  defaultMode?: Mode;
  height?: number;
};

function isTouchDevice() {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0)
  );
}

function renderTypedToCanvas(
  text: string,
  fontId: FontId,
  width = 500,
  height = 100,
): string | null {
  if (!text.trim()) return null;
  const font = FONTS.find((f) => f.id === fontId) ?? FONTS[0];
  const c = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  c.width = width * dpr;
  c.height = height * dpr;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // Scale the font down if the text would overflow the canvas width.
  // 12px padding on the left + 12px breathing room on the right.
  const padding = 12;
  const maxWidth = width - padding * 2;
  let fontSize: number = font.size;
  ctx.font = `${font.weight} ${fontSize}px "${font.id}", cursive`;
  const measured = ctx.measureText(text).width;
  if (measured > maxWidth) {
    fontSize = Math.max(14, Math.floor((font.size * maxWidth) / measured));
    ctx.font = `${font.weight} ${fontSize}px "${font.id}", cursive`;
  }

  ctx.fillStyle = "#1d2839";
  ctx.textBaseline = "middle";
  ctx.fillText(text, padding, height / 2);
  return signatureCanvasDataUrl(c);
}

export const SignatureWidget = forwardRef<SignatureWidgetHandle, Props>(
  function SignatureWidget(
    { initialName = "", defaultMode = "type", height = 180 },
    ref,
  ) {
    const [mode, setMode] = useState<Mode>(defaultMode);
    const [typedName, setTypedName] = useState(initialName);
    const [typedFont, setTypedFont] = useState<FontId>("Caveat");
    const [uploaded, setUploaded] = useState<string | null>(null);
    const [fontsReady, setFontsReady] = useState(false);
    const padRef = useRef<SignaturePadHandle>(null);

    // On touch devices, drawn signatures look terrible. Force Type mode
    // unless the caller has been explicit about a different default.
    useEffect(() => {
      if (defaultMode === "type" && isTouchDevice()) setMode("type");
    }, [defaultMode]);

    useEffect(() => {
      if (typeof document === "undefined" || !document.fonts) {
        setFontsReady(true);
        return;
      }
      Promise.all(FONTS.map((f) => document.fonts.load(`${f.weight} ${f.size}px "${f.id}"`))).then(
        () => setFontsReady(true),
      );
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getDataUrl: () => {
          if (mode === "draw") return padRef.current?.toDataURL() ?? null;
          if (mode === "type") return renderTypedToCanvas(typedName, typedFont, 500, 100);
          if (mode === "upload") return uploaded;
          return null;
        },
        clear: () => {
          if (mode === "draw") padRef.current?.clear();
          if (mode === "type") setTypedName("");
          if (mode === "upload") setUploaded(null);
        },
      }),
      [mode, typedName, typedFont, uploaded],
    );

    function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const url = ev.target?.result;
        if (typeof url !== "string") return;
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            setUploaded(url);
            return;
          }
          ctx.drawImage(image, 0, 0);
          setUploaded(signatureCanvasDataUrl(canvas, url));
        };
        image.onerror = () => setUploaded(url);
        image.src = url;
      };
      reader.readAsDataURL(file);
    }

    return (
      <div className="sigw">
        <div className="sigw-tabs">
          {(["draw", "type", "upload"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={mode === m ? "on" : ""}
            >
              <span className="sigw-tab-name">
                {m === "draw" ? "Draw" : m === "type" ? "Type" : "Upload"}
              </span>
              <span className="sigw-tab-hint">
                {m === "draw"
                  ? "with mouse or finger"
                  : m === "type"
                    ? "handwritten font"
                    : "PNG of your sig"}
              </span>
            </button>
          ))}
        </div>

        {mode === "draw" && (
          <div className="sigw-pane">
            <div className="sigw-canvas-wrap">
              <SignaturePad ref={padRef} height={height} />
            </div>
            <div className="sigw-row">
              <span className="sigw-meta">Draw with your trackpad, mouse, or finger.</span>
              <button type="button" className="text-link" onClick={() => padRef.current?.clear()}>
                Clear
              </button>
            </div>
          </div>
        )}

        {mode === "type" && (
          <div className="sigw-pane">
            <input
              type="text"
              className="paper-input"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full name…"
              autoFocus={!initialName}
            />
            <div className="sigw-fonts">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTypedFont(f.id)}
                  className={`sigw-font ${typedFont === f.id ? "on" : ""}`}
                >
                  <span
                    className="sigw-font-preview"
                    style={{
                      fontFamily: `"${f.id}", cursive`,
                      fontWeight: f.weight,
                      fontSize: f.id === "Allura" ? 26 : f.id === "Mr Dafoe" ? 24 : 22,
                    }}
                  >
                    {typedName || "Your name"}
                  </span>
                  <span className="sigw-font-label">{f.id}</span>
                </button>
              ))}
            </div>
            <div className="sigw-typed-render">
              <span
                style={{
                  fontFamily: `"${typedFont}", cursive`,
                  fontWeight: FONTS.find((f) => f.id === typedFont)?.weight,
                  fontSize: 38,
                  color: "#1d2839",
                  visibility: fontsReady ? "visible" : "hidden",
                }}
              >
                {typedName || " "}
              </span>
            </div>
          </div>
        )}

        {mode === "upload" && (
          <div className="sigw-pane">
            {!uploaded ? (
              <label className="sigw-upload">
                <span className="sigw-upload-icon">↑</span>
                <span className="sigw-upload-lede">Drag a PNG of your signature here</span>
                <span className="sigw-upload-hint">or click to choose · transparent recommended</span>
                <input type="file" accept="image/png,image/jpeg" onChange={onUpload} />
              </label>
            ) : (
              <div className="sigw-upload-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={uploaded} alt="uploaded signature" />
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setUploaded(null)}
                  style={{ marginTop: 8 }}
                >
                  Choose a different file
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);
