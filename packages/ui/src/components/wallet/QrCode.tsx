import { useEffect, useRef } from "react";
import QRCodeStyling from "qr-code-styling";
import { cn } from "../../primitives/cn";

export interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

// Mirrors theme.css's --color-foreground/--color-background/--color-beam-purple; qr-code-styling paints its own SVG outside Tailwind's pipeline, so these can't be read live from CSS custom properties.
const QR_FOREGROUND = "#111111";
const QR_BACKGROUND = "#ffffff";
const QR_ACCENT = "#8b12ff";

const LOGO_SRC = "/icon/128.png";
const LOGO_TIMEOUT_MS = 1500;

export function QrCode({ value, size = 176, className }: QrCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The logo is decoration: qr-code-styling draws nothing at all while an
    // image it was given fails to load, so the code is only built once the
    // logo is known to load, and without it otherwise (a shell that doesn't
    // ship the asset, or answers its URL with a page).
    let cancelled = false;
    let built = false;
    const build = (withLogo: boolean) => {
      if (cancelled || built) return;
      built = true;
      const qr = new QRCodeStyling({
        type: "svg",
        width: size,
        height: size,
        data: value,
        margin: 0,
        qrOptions: {
          errorCorrectionLevel: "H", // highest tier, needed so the embedded logo doesn't break decoding
        },
        ...(withLogo
          ? {
              image: LOGO_SRC,
              imageOptions: {
                imageSize: 0.16,
                margin: 4,
                hideBackgroundDots: true,
                // The default re-reads the logo over XHR to inline it, which the app's CSP
                // (`connect-src https:`) refuses on iOS's `capacitor://` origin; the draw then never finishes.
                saveAsBlob: false,
              },
            }
          : {}),
        dotsOptions: {
          type: "rounded",
          color: QR_FOREGROUND,
        },
        cornersSquareOptions: {
          type: "extra-rounded",
          color: QR_ACCENT,
        },
        cornersDotOptions: {
          type: "dot",
          color: QR_ACCENT,
        },
        backgroundOptions: {
          color: QR_BACKGROUND,
        },
      });

      qrRef.current = qr;
      container.replaceChildren();
      qr.append(container);
    };

    const probe = new Image();
    probe.onload = () => build(true);
    probe.onerror = () => build(false);
    probe.src = LOGO_SRC;
    // A request that hangs fires neither event; the code must not wait on a decoration.
    const timer = window.setTimeout(() => build(false), LOGO_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      container.replaceChildren();
      qrRef.current = null;
    };
  }, [value, size]);

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-xl border border-line/50 bg-background p-3",
        className,
      )}
    >
      <div
        ref={containerRef}
        role="img"
        aria-label={`QR code for wallet address ${value}`}
        style={{ width: size, height: size }}
      />
    </div>
  );
}
