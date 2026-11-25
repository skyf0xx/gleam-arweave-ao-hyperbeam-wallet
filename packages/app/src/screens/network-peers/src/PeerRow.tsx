import { CloseIcon } from "@gleam/ui/src/primitives/icons.tsx";
import type { HyperBeamPeer } from "@gleam/core";
import { useT } from "../../../i18n";
import { isHardcodedPeer, peerHost } from "./network-urls";

export function PeerRow({
  peer,
  isActive,
  saving,
  onSelectActive,
  onToggleEnabled,
  onRemove,
}: {
  peer: HyperBeamPeer;
  isActive: boolean;
  saving: boolean;
  onSelectActive: (peer: HyperBeamPeer) => void;
  onToggleEnabled: (peerUrl: string) => void;
  onRemove: (peerUrl: string) => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 py-3.5">
      <button
        type="button"
        disabled={saving || !peer.enabled}
        onClick={() => onSelectActive(peer)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:cursor-default phone:hit-target"
      >
        <span
          className={`break-all font-mono text-label font-semibold ${
            peer.enabled ? "text-foreground" : "text-faint"
          }`}
        >
          {peerHost(peer.url)}
        </span>
        <span className={`text-caption ${isActive ? "text-positive" : "text-muted"}`}>
          {isActive ? t("networkPeers.active") : null}
        </span>
      </button>
      <div className="flex flex-shrink-0 items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={peer.enabled}
          aria-label={t("networkPeers.enablePeer", { host: peerHost(peer.url) })}
          disabled={saving}
          onClick={() => onToggleEnabled(peer.url)}
          className={`relative flex h-5 w-[34px] flex-shrink-0 items-center rounded-full border px-0.5 transition-colors disabled:opacity-60 phone:hit-target ${
            peer.enabled ? "border-foreground bg-foreground" : "border-line bg-mist"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-3.5 w-3.5 flex-shrink-0 rounded-full bg-background transition-transform ${
              peer.enabled ? "translate-x-[14px]" : "translate-x-0"
            }`}
          />
        </button>
        {isHardcodedPeer(peer.url) ? null : (
          <button
            type="button"
            aria-label={t("networkPeers.removePeer", { host: peerHost(peer.url) })}
            disabled={saving}
            onClick={() => onRemove(peer.url)}
            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-warning disabled:opacity-60"
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  );
}
