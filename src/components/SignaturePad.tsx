"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { signatureCanvasDataUrl } from "@/lib/signature-canvas";

export type SignaturePadHandle = {
  toDataURL: () => string | null;
  clear: () => void;
  isEmpty: () => boolean;
};

type Props = {
  /** Logical pixel height of the canvas. Width fills the parent container. */
  height?: number;
  className?: string;
};

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad(
  { height = 180, className = "" },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const empty = useRef(true);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Configure canvas for the current rendered size. Called on mount and
  // whenever the parent container resizes (orientation change, viewport
  // change). Drawing is preserved across resizes by snapshotting and
  // re-painting.
  function configureCanvas() {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width));
    const dpr = window.devicePixelRatio || 1;

    // Snapshot existing drawing if any
    const prevWidth = canvas.width;
    const prevHeight = canvas.height;
    let snapshot: ImageData | null = null;
    if (!empty.current && prevWidth > 0 && prevHeight > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) snapshot = ctx.getImageData(0, 0, prevWidth, prevHeight);
    }

    canvas.width = cssWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#1d2839";

    // Re-paint preserved drawing (best-effort — at top-left, may stretch on resize)
    if (snapshot) {
      try {
        ctx.putImageData(snapshot, 0, 0);
      } catch {
        // ignore — clean canvas is acceptable on layout shift
      }
    }
  }

  useEffect(() => {
    configureCanvas();
    if (typeof ResizeObserver === "undefined") return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => configureCanvas());
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    empty.current = false;
  }

  function end() {
    drawing.current = false;
    last.current = null;
  }

  useImperativeHandle(ref, () => ({
    toDataURL: () => {
      if (empty.current) return null;
      return canvasRef.current ? signatureCanvasDataUrl(canvasRef.current) : null;
    },
    clear: () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      empty.current = true;
    },
    isEmpty: () => empty.current,
  }));

  return (
    <div ref={wrapRef} className={`signature-pad-wrap ${className}`} style={{ width: "100%" }}>
      <canvas
        ref={canvasRef}
        className="signature-pad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        style={{ touchAction: "none", display: "block", background: "#fff" }}
      />
    </div>
  );
});
