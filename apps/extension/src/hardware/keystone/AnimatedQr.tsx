import { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import type { UREncoder } from "@ngraveio/bc-ur";

export interface AnimatedQrProps {
  encoder: UREncoder;
  intervalMs?: number;
  /** Called on each new frame. */
  onFrame?: () => void;
  label: string;
}

const QUIET_ZONE = 2;

/**
 * One dark-module path for a QR of `text`. UR parts are upper-cased so
 * they fit QR's alphanumeric mode, which packs them much more densely
 * than bytes; the decoder on the other side lower-cases them again.
 */
function qrPath(text: string): { path: string; size: number } {
  const qr = qrcode(0, "L");
  qr.addData(text.toUpperCase(), "Alphanumeric");
  qr.make();
  const count = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { path, size: count + QUIET_ZONE * 2 };
}

/**
 * Cycles through the encoder's fountain-coded parts, one QR every
 * `intervalMs`. A single-part UR stays still. Remount it (with a `key`)
 * to show a different encoder.
 */
export function AnimatedQr({ encoder, intervalMs = 300, onFrame, label }: AnimatedQrProps) {
  const [frame, setFrame] = useState(() => qrPath(encoder.nextPart()));
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (encoder.fragmentsLength <= 1) return;
    const timer = setInterval(() => {
      setFrame(qrPath(encoder.nextPart()));
      onFrameRef.current?.();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [encoder, intervalMs]);

  return (
    // White in both themes: a QR needs dark modules on a light ground to scan.
    <div className="mx-auto w-full max-w-72 rounded-lg border border-line bg-white p-2">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${frame.size} ${frame.size}`}
        shapeRendering="crispEdges"
        className="block aspect-square w-full"
      >
        <path d={frame.path} fill="#111111" />
      </svg>
    </div>
  );
}
