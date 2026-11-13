import { useCallback, useEffect, useRef, useState } from "react";
import { usePlatform } from "../../../app-platform/context";
import type { EphemeralStatePort } from "../../../app-platform/types";
import { DEFAULT_BUNDLER_URL, DEFAULT_HYPERBEAM_PEER_URLS, type HyperBeamPeer, type NetworkSettings, type RuntimePort } from "@gleam/core";
import { isArweaveGateway } from "@gleam/core/src/arweave/gateway.ts";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";

/**
 * The gateway and the AO-peer list are both editable, writing the full
 * `NetworkSettings` object back through `setNetworkSettings` in one shot.
 * Selecting a disabled peer as active is refused client-side rather than
 * sent and rejected by the backend, since `NetworkSettings`'s own shape
 * doesn't forbid it and no validation for that combination exists in
 * `handlers/reads.ts`.
 *
 * The gateway edit is stricter than a peer add: https-only (no bare-host
 * upgrade — a gateway typo silently downgraded to a plaintext origin would
 * be a worse failure mode than just rejecting it), host permission is
 * requested the same way a peer's is, and the URL must answer `GET <url>/info`
 * as an Arweave gateway (`isArweaveGateway`) before it's persisted, so a
 * typo'd, dead, or unrelated host can't strand balance/activity reads with
 * no feedback at edit time.
 *
 * The bundler is automatic (`DEFAULT_BUNDLER_URL`) until one is entered.
 * A custom bundler is used exactly as entered: https-only and granted
 * like the gateway, but with no reachability check, since bundlers share
 * no info endpoint to check against.
 *
 * Requesting a host permission (the `hostPermissions` port) closes the
 * popup in Chrome the instant it shows its own prompt, which would
 * otherwise discard whatever the user had typed. The in-flight edit (gateway or peer, plus its URL) is saved to
 * `session:pendingNetworkEdit` right before the request, so a remount (the
 * user reopening the popup after answering the prompt) can pick the flow
 * back up: if the origin is now granted, it finishes automatically
 * (reachability check, then persist); if not, it reopens the editor
 * pre-filled instead of losing the input.
 */
export interface NetworkPeersViewProps {
  runtime: RuntimePort;
  onBack: () => void;
}

function isHardcodedPeer(peerUrl: string): boolean {
  return (DEFAULT_HYPERBEAM_PEER_URLS as readonly string[]).includes(peerUrl);
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

/** Host and port in full: a lookalike peer can differ only at the end. */
function peerHost(peerUrl: string): string {
  try {
    return new URL(peerUrl).host;
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

/**
 * Stricter than `normalizePeerUrl`: the gateway must already be an
 * `https://` URL rather than having one assumed for it, since silently
 * upgrading a bare host here could mask a typo as a plaintext origin
 * instead of failing loudly.
 */
function normalizeGatewayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * MV3 host-permission match pattern for a peer's origin — protocol +
 * host, wildcarded path (`<scheme>://<host>/*`) per
 * `chrome.permissions.request`'s documented match-pattern shape. Derived
 * from the already-normalized peer URL rather than the raw input, so it
 * always reflects a URL `normalizePeerUrl` has already validated.
 */
function peerOriginPattern(normalizedPeerUrl: string): string {
  const url = new URL(normalizedPeerUrl);
  return `${url.protocol}//${url.host}/*`;
}

interface PendingNetworkEdit {
  kind: "gateway" | "bundler" | "peer";
  url: string;
}

const PENDING_EDIT_KEY = "session:pendingNetworkEdit";

async function loadPendingEdit(store: EphemeralStatePort): Promise<PendingNetworkEdit | null> {
  try {
    const value = (await store.get(PENDING_EDIT_KEY)) as { kind?: unknown; url?: unknown } | undefined;
    if (
      value !== undefined &&
      value !== null &&
      typeof value === "object" &&
      (value.kind === "gateway" || value.kind === "bundler" || value.kind === "peer") &&
      typeof value.url === "string"
    ) {
      return { kind: value.kind, url: value.url };
    }
    return null;
  } catch {
    return null;
  }
}

async function savePendingEdit(store: EphemeralStatePort, edit: PendingNetworkEdit): Promise<void> {
  try {
    await store.set(PENDING_EDIT_KEY, edit);
  } catch {
    // Best-effort — if this fails, the user just has to re-paste the URL.
  }
}

async function clearPendingEdit(store: EphemeralStatePort): Promise<void> {
  try {
    await store.remove(PENDING_EDIT_KEY);
  } catch {
    // Nothing to clean up if this fails.
  }
}

export function NetworkPeersView({ runtime, onBack }: NetworkPeersViewProps) {
  const t = useT();
  const { capabilities, hostPermissions, ephemeralState } = usePlatform();
  // Without runtime host permissions every origin is already reachable.
  const hasHostAccess = async (url: string): Promise<boolean> => {
    if (!capabilities.hostPermissions) return true;
    try {
      return await hostPermissions.contains([peerOriginPattern(url)]);
    } catch {
      return false;
    }
  };
  const requestHostAccess = async (url: string): Promise<boolean> => {
    if (!capabilities.hostPermissions) return true;
    try {
      return await hostPermissions.request([peerOriginPattern(url)]);
    } catch {
      return false;
    }
  };
  const [state, setState] = useState<LoadState>({ settings: null, loading: true, error: null });
  const [saving, setSaving] = useState(false);
  const [addingPeer, setAddingPeer] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [editingGateway, setEditingGateway] = useState(false);
  const [newGatewayUrl, setNewGatewayUrl] = useState("");
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [checkingGateway, setCheckingGateway] = useState(false);
  const [editingBundler, setEditingBundler] = useState(false);
  const [newBundlerUrl, setNewBundlerUrl] = useState("");
  const [bundlerError, setBundlerError] = useState<string | null>(null);

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
        error: errorText(error),
      }));
    }
  }, [runtime]);

  useEffect(() => {
    void load();
  }, [load]);

  // Resumes a gateway/peer edit interrupted by Chrome closing the popup for
  // its own permission prompt. Runs once per mount, after settings load, so
  // a granted-on-remount edit reads against the freshest NetworkSettings.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || state.settings === null) return;
    resumedRef.current = true;

    void (async () => {
      const pending = await loadPendingEdit(ephemeralState);
      if (!pending) return;

      const granted = await hasHostAccess(pending.url);

      if (!granted) {
        if (pending.kind === "gateway") {
          setNewGatewayUrl(pending.url);
          setEditingGateway(true);
        } else if (pending.kind === "bundler") {
          setNewBundlerUrl(pending.url);
          setEditingBundler(true);
        } else {
          setNewPeerUrl(pending.url);
          setAddingPeer(true);
        }
        await clearPendingEdit(ephemeralState);
        return;
      }

      // Permission is already granted — finish the flow the same way the
      // in-popup path would, then clear the draft.
      if (pending.kind === "gateway") {
        setCheckingGateway(true);
        const reachable = await isArweaveGateway(pending.url);
        setCheckingGateway(false);
        if (!reachable) {
          setNewGatewayUrl(pending.url);
          setGatewayError(t("networkPeers.gatewayUnreachable"));
          setEditingGateway(true);
        } else {
          const settings = state.settings;
          if (settings) await persist({ ...settings, gatewayUrl: pending.url });
        }
      } else if (pending.kind === "bundler") {
        const settings = state.settings;
        if (settings) await persist({ ...settings, bundlerUrl: pending.url });
      } else {
        const settings = state.settings;
        if (settings && !settings.peers.some((peer) => peer.url === pending.url)) {
          const peers = [...settings.peers, { url: pending.url, enabled: true }];
          await persist({ ...settings, peers });
        }
      }
      await clearPendingEdit(ephemeralState);
    })();
    // state.settings is read fresh inside the async closure via the outer
    // `state` reference at call time, so it isn't in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.settings]);

  const persist = async (next: NetworkSettings) => {
    setSaving(true);
    try {
      await runtime.send<NetworkSettings, void>({ type: "setNetworkSettings", payload: next });
      setState((prev) => ({ ...prev, settings: next }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: errorText(error) }));
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
    if (!state.settings || isHardcodedPeer(peerUrl)) return;
    const peers = state.settings.peers.filter((peer) => peer.url !== peerUrl);
    const activePeerUrl = state.settings.activePeerUrl === peerUrl ? null : state.settings.activePeerUrl;
    void persist({ ...state.settings, peers, activePeerUrl });
  };

  const handleEditGateway = async () => {
    if (!state.settings) return;
    const normalized = normalizeGatewayUrl(newGatewayUrl);
    if (normalized === null) {
      setGatewayError(t("networkPeers.gatewayInvalid"));
      return;
    }
    if (normalized === state.settings.gatewayUrl) {
      setEditingGateway(false);
      setGatewayError(null);
      return;
    }

    // Saved before requesting permission: Chrome closes this popup the
    // instant its own prompt appears, so this is the only chance to record
    // what the user typed before a remount needs it back.
    await savePendingEdit(ephemeralState, { kind: "gateway", url: normalized });

    const granted = await requestHostAccess(normalized);
    if (!granted) {
      setGatewayError(t("networkPeers.gatewayPermissionDenied"));
      await clearPendingEdit(ephemeralState);
      return;
    }

    setCheckingGateway(true);
    const reachable = await isArweaveGateway(normalized);
    setCheckingGateway(false);
    if (!reachable) {
      setGatewayError(t("networkPeers.gatewayUnreachable"));
      await clearPendingEdit(ephemeralState);
      return;
    }

    await persist({ ...state.settings, gatewayUrl: normalized });
    setEditingGateway(false);
    setGatewayError(null);
    await clearPendingEdit(ephemeralState);
  };

  const closeBundlerEditor = () => {
    setEditingBundler(false);
    setNewBundlerUrl("");
    setBundlerError(null);
  };

  const handleEditBundler = async () => {
    if (!state.settings) return;
    const normalized = normalizeGatewayUrl(newBundlerUrl);
    if (normalized === null) {
      setBundlerError(t("networkPeers.bundlerInvalid"));
      return;
    }
    if (normalized === state.settings.bundlerUrl) {
      closeBundlerEditor();
      return;
    }

    await savePendingEdit(ephemeralState, { kind: "bundler", url: normalized });
    const granted = await requestHostAccess(normalized);
    if (!granted) {
      setBundlerError(t("networkPeers.bundlerPermissionDenied"));
      await clearPendingEdit(ephemeralState);
      return;
    }

    await persist({ ...state.settings, bundlerUrl: normalized });
    closeBundlerEditor();
    await clearPendingEdit(ephemeralState);
  };

  const handleUseAutomaticBundler = async () => {
    if (!state.settings) return;
    await persist({ ...state.settings, bundlerUrl: null });
    closeBundlerEditor();
  };

  const handleAddPeer = async () => {
    if (!state.settings) return;
    // Only `https://*/*` is an optional host permission, so an http peer could never be granted.
    if (/^http:\/\//i.test(newPeerUrl.trim())) {
      setAddError(t("networkPeers.peerNotHttps"));
      return;
    }
    const normalized = normalizePeerUrl(newPeerUrl);
    if (normalized === null) {
      setAddError(t("networkPeers.peerInvalid"));
      return;
    }
    if (state.settings.peers.some((peer) => peer.url === normalized)) {
      setAddError(t("networkPeers.peerDuplicate"));
      return;
    }

    await savePendingEdit(ephemeralState, { kind: "peer", url: normalized });

    const granted = await requestHostAccess(normalized);
    if (!granted) {
      setAddError(t("networkPeers.peerPermissionDenied"));
      await clearPendingEdit(ephemeralState);
      return;
    }

    const peers = [...state.settings.peers, { url: normalized, enabled: true }];
    await persist({ ...state.settings, peers });
    setNewPeerUrl("");
    setAddingPeer(false);
    setAddError(null);
    await clearPendingEdit(ephemeralState);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("networkPeers.title")} onBack={onBack} />
      {state.error ? <NetworkErrorBanner onRetry={() => void load()} /> : null}

      <div className="flex flex-1 flex-col px-6 phone:px-5 pb-6 pt-9 phone:pt-4">
        <div className="pb-10">
          <div className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            {t("networkPeers.gateway")}
          </div>
          <div>
            {state.loading ? (
              <SkeletonRow />
            ) : editingGateway ? (
              <div className="flex flex-col gap-2 py-3.5">
                <input
                  type="text"
                  autoFocus
                  placeholder="https://arweave.net"
                  value={newGatewayUrl}
                  onChange={(event) => {
                    setNewGatewayUrl(event.target.value);
                    setGatewayError(null);
                  }}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2.5 font-mono text-label text-foreground focus:outline-none"
                />
                {gatewayError ? (
                  <span role="alert" className="text-caption text-warning">
                    {gatewayError}
                  </span>
                ) : null}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={saving || checkingGateway}
                    onClick={() => void handleEditGateway()}
                    className="text-label font-semibold text-foreground disabled:opacity-60"
                  >
                    {checkingGateway ? t("networkPeers.checking") : t("networkPeers.save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingGateway(false);
                      setNewGatewayUrl("");
                      setGatewayError(null);
                    }}
                    className="text-label font-semibold text-muted"
                  >
                    {t("networkPeers.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewGatewayUrl(state.settings?.gatewayUrl ?? "");
                  setEditingGateway(true);
                }}
                className="flex w-full items-center gap-2.5 py-3.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-semibold text-foreground">
                    {state.settings ? gatewayHostname(state.settings.gatewayUrl) : "—"}
                  </span>
                  <span className="text-caption text-muted">{t("networkPeers.gatewayHint")}</span>
                </span>
                <span aria-hidden="true" className="flex-shrink-0 text-label font-medium text-muted">
                  {t("networkPeers.changeGateway")}
                </span>
              </button>
            )}
          </div>
        </div>

        <div className="pb-10">
          <div className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            {t("networkPeers.bundler")}
          </div>
          <div>
            {state.loading ? (
              <SkeletonRow />
            ) : editingBundler ? (
              <div className="flex flex-col gap-2 py-3.5">
                <input
                  type="text"
                  autoFocus
                  placeholder={DEFAULT_BUNDLER_URL}
                  value={newBundlerUrl}
                  onChange={(event) => {
                    setNewBundlerUrl(event.target.value);
                    setBundlerError(null);
                  }}
                  className="w-full border-0 border-b border-line bg-transparent px-0 py-2.5 font-mono text-label text-foreground focus:outline-none"
                />
                {bundlerError ? (
                  <span role="alert" className="text-caption text-warning">
                    {bundlerError}
                  </span>
                ) : null}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleEditBundler()}
                    className="text-label font-semibold text-foreground disabled:opacity-60"
                  >
                    {t("networkPeers.save")}
                  </button>
                  <button type="button" onClick={closeBundlerEditor} className="text-label font-semibold text-muted">
                    {t("networkPeers.cancel")}
                  </button>
                  {state.settings?.bundlerUrl ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleUseAutomaticBundler()}
                      className="ml-auto text-label font-semibold text-muted disabled:opacity-60"
                    >
                      {t("networkPeers.useAutomatic")}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewBundlerUrl(state.settings?.bundlerUrl ?? "");
                  setEditingBundler(true);
                }}
                className="flex w-full items-center gap-2.5 py-3.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-semibold text-foreground">
                    {state.settings?.bundlerUrl ? gatewayHostname(state.settings.bundlerUrl) : t("networkPeers.automatic")}
                  </span>
                  <span className="text-caption text-muted">{t("networkPeers.bundlerHint")}</span>
                </span>
                <span aria-hidden="true" className="flex-shrink-0 text-label font-medium text-muted">
                  {t("networkPeers.changeGateway")}
                </span>
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="pb-1 text-label font-semibold uppercase tracking-[0.04em] text-muted">
            {t("networkPeers.aoPeers")}
          </div>
          <p className="pb-1 text-caption leading-relaxed text-faint">{t("networkPeers.peersHint")}</p>
          <div>
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
                    <div key={peer.url} className="flex items-center gap-2.5 py-3.5">
                      <button
                        type="button"
                        disabled={saving || !peer.enabled}
                        onClick={() => handleSelectActive(peer)}
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
                          onClick={() => handleToggleEnabled(peer.url)}
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
                            onClick={() => handleRemovePeer(peer.url)}
                            className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-md text-faint hover:bg-mist hover:text-warning disabled:opacity-60"
                          >
                            <RemoveIcon />
                          </button>
                        )}
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
                      className="w-full border-0 border-b border-line bg-transparent px-0 py-2.5 font-mono text-label text-foreground focus:outline-none"
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
                        {t("networkPeers.add")}
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
                        {t("networkPeers.cancel")}
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
                    {t("networkPeers.addPeer")}
                  </button>
                )}
              </>
            )}
          </div>
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
