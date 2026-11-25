import { useEffect, useRef, useState } from "react";
import { hostnameOf } from "../../../hostname";
import { InlineUrlEditor } from "./InlineUrlEditor";
import { PeerRow } from "./PeerRow";
import { useHostAccess } from "./useHostAccess";
import { isHardcodedPeer, normalizeGatewayUrl, normalizePeerUrl } from "./network-urls";
import { clearPendingEdit, loadPendingEdit, savePendingEdit } from "./pending-edit";
import { usePlatform } from "../../../app-platform/context";
import { DEFAULT_BUNDLER_URL, type HyperBeamPeer, type NetworkSettings, type RuntimePort } from "@gleam/core";
import { isArweaveGateway } from "@gleam/core/src/arweave/gateway.ts";
import { NetworkErrorBanner, SkeletonRow } from "@gleam/ui/src/components/wallet/index.ts";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { SettingsSectionTitle } from "@gleam/ui/src/primitives/setting-rows.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { useNetworkSettings, useSaveNetworkSettings } from "../../main-screen/src/useNetworkSettings";

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


export function NetworkPeersView({ runtime, onBack }: NetworkPeersViewProps) {
  const t = useT();
  const { ephemeralState } = usePlatform();
  const { hasHostAccess, requestHostAccess } = useHostAccess();
  const settingsQuery = useNetworkSettings(runtime);
  const settings = settingsQuery.data ?? null;
  const saveMutation = useSaveNetworkSettings(runtime);
  const saving = saveMutation.isPending;
  const [saveError, setSaveError] = useState<string | null>(null);
  const error = saveError ?? (settingsQuery.isError ? errorText(settingsQuery.error) : null);
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

  // Resumes a gateway/peer edit interrupted by Chrome closing the popup for
  // its own permission prompt. Runs once per mount, after settings load, so
  // a granted-on-remount edit reads against the freshest NetworkSettings.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || settings === null) return;
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
          if (settings) await persist({ ...settings, gatewayUrl: pending.url });
        }
      } else if (pending.kind === "bundler") {
        if (settings) await persist({ ...settings, bundlerUrl: pending.url });
      } else {
        if (settings && !settings.peers.some((peer) => peer.url === pending.url)) {
          const peers = [...settings.peers, { url: pending.url, enabled: true }];
          await persist({ ...settings, peers });
        }
      }
      await clearPendingEdit(ephemeralState);
    })();
    // settings is read fresh inside the async closure via the outer
    // `state` reference at call time, so it isn't in the dependency array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const persist = async (next: NetworkSettings) => {
    setSaveError(null);
    try {
      await saveMutation.mutateAsync(next);
    } catch (caught) {
      setSaveError(errorText(caught));
    }
  };

  const handleToggleEnabled = (peerUrl: string) => {
    if (!settings) return;
    const peers = settings.peers.map((peer) =>
      peer.url === peerUrl ? { ...peer, enabled: !peer.enabled } : peer,
    );
    const togglingOff = settings.peers.find((peer) => peer.url === peerUrl)?.enabled === true;
    const activePeerUrl = togglingOff && settings.activePeerUrl === peerUrl ? null : settings.activePeerUrl;
    void persist({ ...settings, peers, activePeerUrl });
  };

  const handleSelectActive = (peer: HyperBeamPeer) => {
    if (!settings || !peer.enabled) return;
    const activePeerUrl = settings.activePeerUrl === peer.url ? null : peer.url;
    void persist({ ...settings, activePeerUrl });
  };

  const handleRemovePeer = (peerUrl: string) => {
    if (!settings || isHardcodedPeer(peerUrl)) return;
    const peers = settings.peers.filter((peer) => peer.url !== peerUrl);
    const activePeerUrl = settings.activePeerUrl === peerUrl ? null : settings.activePeerUrl;
    void persist({ ...settings, peers, activePeerUrl });
  };

  const handleEditGateway = async () => {
    if (!settings) return;
    const normalized = normalizeGatewayUrl(newGatewayUrl);
    if (normalized === null) {
      setGatewayError(t("networkPeers.gatewayInvalid"));
      return;
    }
    if (normalized === settings.gatewayUrl) {
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

    await persist({ ...settings, gatewayUrl: normalized });
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
    if (!settings) return;
    const normalized = normalizeGatewayUrl(newBundlerUrl);
    if (normalized === null) {
      setBundlerError(t("networkPeers.bundlerInvalid"));
      return;
    }
    if (normalized === settings.bundlerUrl) {
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

    await persist({ ...settings, bundlerUrl: normalized });
    closeBundlerEditor();
    await clearPendingEdit(ephemeralState);
  };

  const handleUseAutomaticBundler = async () => {
    if (!settings) return;
    await persist({ ...settings, bundlerUrl: null });
    closeBundlerEditor();
  };

  const handleAddPeer = async () => {
    if (!settings) return;
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
    if (settings.peers.some((peer) => peer.url === normalized)) {
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

    const peers = [...settings.peers, { url: normalized, enabled: true }];
    await persist({ ...settings, peers });
    setNewPeerUrl("");
    setAddingPeer(false);
    setAddError(null);
    await clearPendingEdit(ephemeralState);
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenHeader title={t("networkPeers.title")} onBack={onBack} />
      {error ? (
        <NetworkErrorBanner
          onRetry={() => {
            setSaveError(null);
            void settingsQuery.refetch();
          }}
          retrying={settingsQuery.isFetching}
        />
      ) : null}

      <div className="flex flex-1 flex-col px-6 phone:px-5 pb-6 pt-9 phone:pt-4">
        <div className="pb-10">
          <SettingsSectionTitle>
            {t("networkPeers.gateway")}
          </SettingsSectionTitle>
          <div>
            {settingsQuery.isPending ? (
              <SkeletonRow />
            ) : editingGateway ? (
              <InlineUrlEditor
                placeholder="https://arweave.net"
                value={newGatewayUrl}
                onChange={(value) => {
                  setNewGatewayUrl(value);
                  setGatewayError(null);
                }}
                error={gatewayError}
                submitLabel={checkingGateway ? t("networkPeers.checking") : t("networkPeers.save")}
                submitDisabled={saving || checkingGateway}
                onSubmit={() => void handleEditGateway()}
                onCancel={() => {
                  setEditingGateway(false);
                  setNewGatewayUrl("");
                  setGatewayError(null);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewGatewayUrl(settings?.gatewayUrl ?? "");
                  setEditingGateway(true);
                }}
                className="flex w-full items-center gap-2.5 py-3.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-semibold text-foreground">
                    {settings ? hostnameOf(settings.gatewayUrl) : "—"}
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
          <SettingsSectionTitle>
            {t("networkPeers.bundler")}
          </SettingsSectionTitle>
          <div>
            {settingsQuery.isPending ? (
              <SkeletonRow />
            ) : editingBundler ? (
              <InlineUrlEditor
                placeholder={DEFAULT_BUNDLER_URL}
                value={newBundlerUrl}
                onChange={(value) => {
                  setNewBundlerUrl(value);
                  setBundlerError(null);
                }}
                error={bundlerError}
                submitLabel={t("networkPeers.save")}
                submitDisabled={saving}
                onSubmit={() => void handleEditBundler()}
                onCancel={closeBundlerEditor}
                extraAction={
                  settings?.bundlerUrl ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void handleUseAutomaticBundler()}
                      className="ml-auto text-label font-semibold text-muted disabled:opacity-60"
                    >
                      {t("networkPeers.useAutomatic")}
                    </button>
                  ) : null
                }
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNewBundlerUrl(settings?.bundlerUrl ?? "");
                  setEditingBundler(true);
                }}
                className="flex w-full items-center gap-2.5 py-3.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-label font-semibold text-foreground">
                    {settings?.bundlerUrl ? hostnameOf(settings.bundlerUrl) : t("networkPeers.automatic")}
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
          <SettingsSectionTitle>
            {t("networkPeers.aoPeers")}
          </SettingsSectionTitle>
          <p className="pb-1 text-caption leading-relaxed text-faint">{t("networkPeers.peersHint")}</p>
          <div>
            {settingsQuery.isPending ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : (
              <>
                {(settings?.peers ?? []).map((peer) => (
                  <PeerRow
                    key={peer.url}
                    peer={peer}
                    isActive={settings?.activePeerUrl === peer.url}
                    saving={saving}
                    onSelectActive={handleSelectActive}
                    onToggleEnabled={handleToggleEnabled}
                    onRemove={handleRemovePeer}
                  />
                ))}

                {addingPeer ? (
                  <InlineUrlEditor
                    placeholder="hyperbeam.example.com"
                    value={newPeerUrl}
                    onChange={(value) => {
                      setNewPeerUrl(value);
                      setAddError(null);
                    }}
                    error={addError}
                    submitLabel={t("networkPeers.add")}
                    submitDisabled={saving}
                    onSubmit={() => void handleAddPeer()}
                    onCancel={() => {
                      setAddingPeer(false);
                      setNewPeerUrl("");
                      setAddError(null);
                    }}
                  />
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

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
