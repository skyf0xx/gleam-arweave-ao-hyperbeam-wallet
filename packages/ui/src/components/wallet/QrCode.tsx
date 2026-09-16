import { useEffect, useRef } from "react";
import QRCodeStyling from "qr-code-styling";
import { cn } from "../../primitives/cn";

export interface QrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

// Mirrors theme.css's --color-foreground/--color-background; qr-code-styling paints its own SVG outside Tailwind's pipeline, so these can't be read live from CSS custom properties.
const QR_FOREGROUND = "#111111";
const QR_BACKGROUND = "#ffffff";

const LOGO_SRC = "/icon/128.png";

export function QrCode({ value, size = 176, className }: QrCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<QRCodeStyling | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const qr = new QRCodeStyling({
      type: "svg",
      width: size,
      height: size,
      data: value,
      margin: 0,
      qrOptions: {
        errorCorrectionLevel: "H", // highest tier, needed so the embedded logo doesn't break decoding
      },
      image: LOGO_SRC,
      imageOptions: {
        imageSize: 0.3,
        margin: 4,
        hideBackgroundDots: true,
      },
      dotsOptions: {
        type: "square",
        color: QR_FOREGROUND,
      },
      cornersSquareOptions: {
        type: "square",
        color: QR_FOREGROUND,
      },
      cornersDotOptions: {
        type: "square",
        color: QR_FOREGROUND,
      },
      backgroundOptions: {
        color: QR_BACKGROUND,
      },
    });

    qrRef.current = qr;
    container.replaceChildren();
    qr.append(container);

    return () => {
      container.replaceChildren();
      qrRef.current = null;
    };
  }, [value, size]);

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center rounded-xl border border-line bg-background p-5",
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
