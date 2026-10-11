import { useEffect, useRef } from "react";
import jsQR from "jsqr";
import type { UR } from "@ngraveio/bc-ur";
import { WrongKeystoneQrError } from "./decode-account";
import { UrAssembler } from "./ur-assembler";

export type ScannerError = "camera-denied" | "camera-unavailable" | "wrong-type" | "invalid";

export interface QrScannerProps {
  /** Only URs of this type are accepted. Others raise `wrong-type`. */
  expectedType?: string;
  onProgress?: (percent: number) => void;
  onComplete: (ur: UR) => void;
  onError: (error: ScannerError) => void;
}

// Keystone's animated frames are dense, so a small canvas loses modules.
const MAX_FRAME_WIDTH = 960;

/**
 * Camera view that decodes a (possibly animated) UR QR. It stops after
 * the first complete UR or error, and always releases the camera on
 * unmount. Remount it to scan again.
 */
export function QrScanner({ expectedType, onProgress, onComplete, onError }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handlers = useRef({ onProgress, onComplete, onError });
  handlers.current = { onProgress, onComplete, onError };

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const assembler = new UrAssembler(expectedType);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (video && context && video.readyState >= video.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
        if (code) {
          try {
            const result = assembler.feed(code.data);
            if (result.kind === "progress") handlers.current.onProgress?.(result.percent);
            if (result.kind === "complete") {
              stop();
              handlers.current.onComplete(result.ur);
              return;
            }
          } catch (error) {
            stop();
            handlers.current.onError(error instanceof WrongKeystoneQrError ? "wrong-type" : "invalid");
            return;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } })
      .then(async (media) => {
        if (stopped) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play();
        frame = requestAnimationFrame(tick);
      })
      .catch((error: unknown) => {
        if (stopped) return;
        const name = error instanceof DOMException ? error.name : "";
        handlers.current.onError(
          name === "NotAllowedError" || name === "SecurityError" ? "camera-denied" : "camera-unavailable",
        );
      });

    return stop;
  }, [expectedType]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      aria-label="Camera preview"
      className="aspect-square w-full rounded-lg border border-line bg-mist object-cover"
    />
  );
}
