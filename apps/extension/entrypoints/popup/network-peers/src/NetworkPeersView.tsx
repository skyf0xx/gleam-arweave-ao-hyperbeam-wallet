import { useCallback, useEffect, useState } from "react";
import type { HyperBeamPeer, NetworkSettings, RuntimePort } from "@gleam/core";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";

/**
 * Network & peers settings (network-peers.html / TODO.md §7.3) — the
 * gateway is shown read-only (the mockup's `.gateway-row` has no edit
 * affordance, only a status dot) while the AO-peer list is fully
 * editable: add, remove, per-peer enable toggle, and select-active, all
 * writing the full `NetworkSettings` object back through
 * `setNetworkSettings` in one shot (RELEVANT RULES: no new backend —
 * `getNetworkSettings`/`setNetworkSettings` are already implemented and
 * wired). Selecting a disabled peer as active is refused client-side
 * (mirrors the mockup's own "Active" label only ever appearing on an
 * enabled peer) rather than sent and rejected by the backend, since
 * `NetworkSettings`'s own shape doesn't forbid it and no validation for
 * that combination exists in `handlers/reads.ts`.
 */
export interface NetworkPeersViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

interface LoadState {
  settings: NetworkSettings | null;
  loading: boolean;
  error: string | null;
}

function gatewayHostname(gatewayUrl: string): string {
  try {
    return new URL(gatewayUrl).hostname;
  } catch {
    return gatewayUrl;
  }
}

function peerHostname(peerUrl: string): string {
  try {
    return new URL(peerUrl).hostname;
  } catch {
    return peerUrl;
  }
}

function normalizePeerUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function NetworkPeersView({ runtime, onBack }: NetworkPeersViewProps) {
  const [state, setState] = useState<LoadState>({ settings: null, loading: true, error: null });
  const [saving, setSaving] = useState(false);
  const [addingPeer, setAddingPeer] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const settings = await runtime.send<void, NetworkSettings>({
        type: "getNetworkSettings",
        payload: undefined,
      });
      setState({ settings, loading: false, error: null });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: NetworkSettings) => {
    setSaving(true);
    try {
      await runtime.send<NetworkSettings, void>({ type: "setNetworkSettings", payload: next });
      setState((prev) => ({ ...prev, settings: next }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = (peerUrl: string) => {
    if (!state.settings) return;
    const peers = state.settings.peers.map((peer) =>
      peer.url === peerUrl ? { ...peer, enabled: !peer.enabled } : peer,
    );
    const togglingOff = state.settings.peers.find((peer) => peer.url === peerUrl)?.enabled === true;
    const activePeerUrl = togglingOff && state.settings.activePeerUrl === peerUrl ? null : state.settings.activePeerUrl;
    void persist({ ...state.settings, peers, activePeerUrl });
  };

  const handleSelectActive = (peer: HyperBeamPeer) => {
    if (!state.settings || !peer.enabled) return;
    const activePeerUrl = state.settings.activePeerUrl === peer.url ? null : peer.url;
    void persist({ ...state.settings, activePeerUrl });
  };

  const handleRemovePeer = (peerUrl: string) => {
    if (!state.settings) return;
    const peers = state.settings.peers.filter((peer) => peer.url !== peerUrl);
    const activePeerUrl = state.settings.activePeerUrl === peerUrl ? null : state.settings.activePeerUrl;
    void persist({ ...state.settings, peers, activePeerUrl });
  };

  const handleAddPeer = async () => {
    if (!state.settings) return;
    const normalized = normalizePeerUrl(newPeerUrl);
    if (normalized === null) {
      setAddError("Enter a valid peer URL.");
      return;
    }
    if (state.settings.peers.some((peer) => peer.url === normalized)) {
      setAddError("That peer is already in the list.");
      return;
    }
    const peers = [...state.settings.peers, { url: normalized, enabled: true }];
    await persist({ ...state.settings, peers });
    setNewPeerUrl("");
    setAddingPeer(false);
    setAddError(null);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title="Network & peers" onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 pb-6 pt-9">
        <div className="pb-10">
          <div className="pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">Gateway</div>
          <div className="rounded-xl border border-line">
            {state.loading ? (
              <SkeletonRow />
            ) : (
              <div className="flex items-center gap-2.5 px-3.5 py-3.5">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-semibold text-foreground">
                    {state.settings ? gatewayHostname(state.settings.gatewayUrl) : "—"}
                  </span>
                  <span className="text-caption text-muted">Arweave gateway &amp; GraphQL</span>
                </span>
                <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-full bg-beam-green" />
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="pb-3.5 text-label font-semibold uppercase tracking-[0.04em] text-muted">AO peers</div>
          <div className="rounded-xl border border-line px-3.5">
            {state.loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              <>
                {(state.settings?.peers ?? []).map((peer) => {
                  const isActive = state.settings?.activePeerUrl === peer.url;
                  return (
                    <div
                      key={peer.url}
                      className="flex items-center gap-2.5 border-b border-line py-3.5 last:border-b-0"
                    >
                      <button
                        type="button"
                        disabled={saving || !peer.enabled}
                        onClick={() => handleSelectActive(peer)}
                        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left disabled:cursor-default"
                      >
                        <span
                          className={`truncate font-mono text-label font-semibold ${
                            peer.enabled ? "text-foreground" : "text-faint"
                          }`}
                        >
                          {peerHostname(peer.url)}
                        </span>
                        <span className={`text-caption ${isActive ? "text-beam-green" : "text-muted"}`}>
                          {isActive ? "Active" : peer.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </button>
                      <div className="flex flex-shrink-0 items-center gap-2.5">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={peer.enabled}
                          aria-label={`Enable ${peerHostname(peer.url)}`}
                          disabled={saving}
                          onClick={() => handleToggleEnabled(peer.url)}
                          className={`relative flex h-5 w-[34px] flex-shrink-0 items-center rounded-full border px-0.5 transition-colors disabled:opacity-60 ${
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
                        <button
                          type="button"
                          aria-label={`Remove ${peerHostname(peer.url)}`}
                          disabled={saving}
                          onClick={() => handleRemovePeer(peer.url)}
                          className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-warning disabled:opacity-60"
                        >
                          <RemoveIcon />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {addingPeer ? (
                  <div className="flex flex-col gap-2 py-3.5">
                    <input
                      type="text"
                      autoFocus
                      placeholder="hyperbeam.example.com"
                      value={newPeerUrl}
                      onChange={(event) => {
                        setNewPeerUrl(event.target.value);
                        setAddError(null);
                      }}
                      className="w-full rounded-md border border-line bg-background px-3 py-2 font-mono text-label text-foreground focus:border-foreground focus:outline-none"
                    />
                    {addError ? (
                      <span role="alert" className="text-caption text-warning">
                        {addError}
                      </span>
                    ) : null}
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleAddPeer()}
                        className="text-label font-semibold text-foreground disabled:opacity-60"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingPeer(false);
                          setNewPeerUrl("");
                          setAddError(null);
                        }}
                        className="text-label font-semibold text-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingPeer(true)}
                    className="flex w-full items-center gap-2 py-3.5 text-left text-label font-semibold text-muted hover:text-foreground"
                  >
                    <PlusIcon />
                    Add peer
                  </button>
                )}
              </>
            )}
          </div>
          <p className="pt-2.5 text-caption leading-relaxed text-faint">
            Enabled peers are tried in order. Disable a peer without removing it to keep the URL for later.
          </p>
        </div>
      </div>
    </div>
  );
}

function RemoveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
