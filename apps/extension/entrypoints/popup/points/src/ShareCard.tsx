import { useState } from "react";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import {
  inviteCountLabel,
  saveShareCardImage,
  type ShareCardContent,
} from "./share-card-image";

const BEAM_STOPS =
  "linear-gradient(to right, #ff1717 0 20%, #8b12ff 20% 40%, #73c9e8 40% 60%, #ffe45c 60% 80%, #28f02d 80% 100%)";

/**
 * The card people post (POINTS.md § Messaging, "Share card"). It stays in
 * the light palette in dark mode so it matches the saved image.
 */
export function ShareCard(content: ShareCardContent) {
  const [error, setError] = useState<string | null>(null);
  const invites = inviteCountLabel(content.seatsLeft);

  return (
    <div className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`Gleam OG number ${content.foundingNumber}`}
        className="relative flex aspect-[1.91/1] flex-col justify-between overflow-hidden rounded-lg border border-line bg-[#ffffff] px-5 pb-4 pt-6"
      >
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ backgroundImage: BEAM_STOPS }}
        />
        <div className="flex flex-col">
          <span className="text-label font-semibold text-[#737373]">OG</span>
          <span className="text-[48px] font-bold leading-[52px] tracking-tight tabular-nums text-[#111111]">
            #{content.foundingNumber}
          </span>
          {invites ? (
            <span className="mt-1 text-body font-semibold text-[#111111]">
              {invites}
            </span>
          ) : null}
        </div>
        <div className="flex items-end justify-between">
          <span className="text-caption text-[#a3a3a3]">You are early</span>
          <span className="text-label font-bold text-[#111111]">Gleam</span>
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setError(null);
          saveShareCardImage(content).catch(() =>
            setError("Couldn't save the image."),
          );
        }}
      >
        Save image
      </Button>
      {error ? <p className="text-caption text-warning">{error}</p> : null}
    </div>
  );
}
