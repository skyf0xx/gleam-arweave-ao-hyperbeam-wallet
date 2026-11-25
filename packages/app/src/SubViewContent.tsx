import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { vaultHasPassword, sitePageUrl, type RuntimePort, type WalletSummary } from "@gleam/core";
import { ExistingMemberReveal, OnboardingView, PendingClaim } from "./screens/onboarding/index.tsx";
import { CollectibleDetailView, NameTargetView } from "./screens/collectibles/index.tsx";
import { MainScreenView, type MainScreenTab } from "./screens/main-screen/index.tsx";
import { useNetworkSettings } from "./screens/main-screen/src/useNetworkSettings";
import { SendCollectibleView, SendView } from "./screens/send/index.tsx";
import { ReceiveView } from "./screens/receive/index.tsx";
import { useSwitchWallet, WalletSwitcherView } from "./screens/wallet-switcher/index.tsx";
import { WalletDetailView } from "./screens/wallet-detail/index.tsx";
import { LockSettingsView } from "./screens/lock-settings/index.tsx";
import { BackupView } from "./screens/backup/index.tsx";
import { NetworkPeersView } from "./screens/network-peers/index.tsx";
import { AppearanceView, SettingsHomeView } from "./screens/settings-home/index.tsx";
import { BrowserView } from "./screens/browser/index.tsx";
import { ConnectedAppsView } from "./screens/connected-apps/index.tsx";
import { ManageTokensView } from "./screens/manage-tokens/index.tsx";
import { DisplayCurrencyView } from "./screens/display-currency/index.tsx";
import { HomeScreenView } from "./screens/home-screen/index.tsx";
import { LanguageView } from "./screens/language/index.tsx";
import { PointsView } from "./screens/points/index.tsx";
import { UseGleamOnSiteView } from "./screens/site-wallet/index.tsx";
import { useT } from "./i18n";
import { usePlatform } from "./app-platform/context";
import type { MainSubView } from "./app-views";

/** Looks the gateway up only for a name, whose detail links to the name's own site. */
function CollectibleDetailScreen({ runtime, ...props }: Omit<ComponentProps<typeof CollectibleDetailView>, "gatewayUrl"> & { runtime: RuntimePort }) {
  const networkSettings = useNetworkSettings(runtime, props.collectible.permawebName !== undefined);
  return <CollectibleDetailView {...props} gatewayUrl={networkSettings.data?.gatewayUrl} />;
}

export interface SubViewContentProps {
  subView: MainSubView;
  setSubView: Dispatch<SetStateAction<MainSubView>>;
  runtime: RuntimePort;
  wallet: WalletSummary;
  wallets: WalletSummary[];
  setWallets: (wallets: WalletSummary[]) => void;
  refresh: (runtime: RuntimePort) => Promise<void>;
  layoutRoot: HTMLDivElement | null;
  homeTab: MainScreenTab;
  setHomeTab: (tab: MainScreenTab) => void;
}

/** The screen for the wallet's current `MainSubView`: the one routing table behind the unlocked shell. */
export function SubViewContent({
  subView,
  setSubView,
  runtime,
  wallet,
  wallets,
  setWallets,
  refresh,
  layoutRoot,
  homeTab,
  setHomeTab,
}: SubViewContentProps) {
  const platform = usePlatform();
  const t = useT();
  const switchWallet = useSwitchWallet(runtime);
  // Points is per wallet, so another wallet's invites are shared from that wallet.
  const openInvites = async (walletId: string) => {
    if (walletId !== wallet.id) {
      await switchWallet.mutateAsync(walletId);
      await refresh(runtime);
    }
    setSubView({ kind: "points" });
  };
  if (subView.kind === "send") {
    return (
      <SendView
        runtime={runtime}
        wallet={wallet}
        token={subView.token}
        recipient={subView.recipient}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "collectible") {
    return (
      <CollectibleDetailScreen
        runtime={runtime}
        collectible={subView.collectible}
        onBack={() => setSubView({ kind: "home" })}
        onSend={(collectible) => setSubView({ kind: "send-collectible", collectible })}
        onChangeTarget={(target) => setSubView({ kind: "name-target", collectible: subView.collectible, target })}
        sheetContainer={layoutRoot}
      />
    );
  } else if (subView.kind === "name-target") {
    const { collectible, target } = subView;
    const name = collectible.permawebName;
    return name ? (
      <NameTargetView
        runtime={runtime}
        wallet={wallet}
        collectible={{ ...collectible, permawebName: name }}
        target={target}
        onBack={() => setSubView({ kind: "collectible", collectible })}
        onDone={(updated) => setSubView({ kind: "collectible", collectible: updated })}
      />
    ) : null;
  } else if (subView.kind === "send-collectible") {
    const { collectible } = subView;
    return (
      <SendCollectibleView
        runtime={runtime}
        wallet={wallet}
        collectible={collectible}
        onBack={() => setSubView({ kind: "collectible", collectible })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else if (subView.kind === "points") {
    return <PointsView runtime={runtime} wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "receive") {
    return <ReceiveView wallet={wallet} onBack={() => setSubView({ kind: "home" })} />;
  } else if (subView.kind === "wallet-switcher") {
    return (
      <WalletSwitcherView
        runtime={runtime}
        initialWallets={wallets}
        initialActiveWalletId={wallet?.id ?? null}
        onSwitched={() => void refresh(runtime)}
        onBack={() => setSubView({ kind: "home" })}
        onAddWallet={() => setSubView({ kind: "add-wallet" })}
        onManage={(walletId) => setSubView({ kind: "wallet-detail", walletId })}
      />
    );
  } else if (subView.kind === "wallet-detail") {
    const detailWallet = wallets.find((candidate) => candidate.id === subView.walletId) ?? null;
    return detailWallet ? (
      <WalletDetailView
        runtime={runtime}
        wallet={detailWallet}
        onBack={() => setSubView({ kind: "wallet-switcher" })}
        onRenamed={() => void refresh(runtime)}
        onRemoved={() => {
          const remaining = wallets.filter((candidate) => candidate.id !== detailWallet.id);
          // Drop it now so the list doesn't flash the removed wallet. With none
          // left, refresh switches to onboarding, which should finish on home.
          setWallets(remaining);
          setSubView(remaining.length > 0 ? { kind: "wallet-switcher" } : { kind: "home" });
          void refresh(runtime);
        }}
      />
    ) : (
      <div className="p-4 text-body text-muted">{t("app.walletNotFound")}</div>
    );
  } else if (subView.kind === "add-wallet") {
    return (
      <OnboardingView
        runtime={runtime}
        mode="add-wallet"
        vaultHasPassword={vaultHasPassword(wallets)}
        claim={platform.buildInfo.foundingGate ? "founding" : "open"}
        onCancel={() => setSubView({ kind: "wallet-switcher" })}
        onComplete={() => {
          setSubView({ kind: "home" });
          void refresh(runtime);
        }}
      />
    );
  } else if (subView.kind === "settings-home") {
    return (
      <SettingsHomeView
        runtime={runtime}
        onBack={() => setSubView({ kind: "home" })}
        onOpenLockSettings={vaultHasPassword(wallets) ? () => setSubView({ kind: "lock-settings" }) : undefined}
        onOpenConnectedApps={() => setSubView({ kind: "connected-apps" })}
        onOpenAppearance={() => setSubView({ kind: "appearance" })}
        onOpenNetworkPeers={() => setSubView({ kind: "network-peers" })}
        onOpenFeedback={() =>
          window.open(sitePageUrl("feedback", platform.buildInfo.version), "_blank", "noopener,noreferrer")
        }
      />
    );
  } else if (subView.kind === "appearance") {
    return (
      <AppearanceView
        runtime={runtime}
        onBack={() => setSubView({ kind: "settings-home" })}
        onOpenDisplayCurrency={() => setSubView({ kind: "display-currency" })}
        onOpenLanguage={() => setSubView({ kind: "language" })}
        onOpenHomeScreen={() => setSubView({ kind: "home-screen" })}
      />
    );
  } else if (subView.kind === "backup") {
    return <BackupView runtime={runtime} onBack={() => setSubView({ kind: "lock-settings" })} />;
  } else if (subView.kind === "lock-settings") {
    return (
      <LockSettingsView
        runtime={runtime}
        onBack={() => setSubView({ kind: "settings-home" })}
        onLocked={() => void refresh(runtime)}
        onSetUpPasskey={platform.capabilities.passkey ? () => platform.unlock.openPasskeyWindow("setup") : undefined}
        biometrics={platform.capabilities.biometrics ? platform.biometrics : undefined}
        lockOnSystemLock={platform.capabilities.lockOnSystemLock}
        backup={
          platform.capabilities.cloudBackup
            ? { provider: platform.capabilities.cloudBackup, open: () => setSubView({ kind: "backup" }) }
            : undefined
        }
      />
    );
  } else if (subView.kind === "network-peers") {
    return <NetworkPeersView runtime={runtime} onBack={() => setSubView({ kind: "settings-home" })} />;
  } else if (subView.kind === "connected-apps") {
    const { origin, returnToUrl } = subView;
    return (
      <ConnectedAppsView
        runtime={runtime}
        highlightOrigin={origin}
        wallets={wallets}
        onBack={() => setSubView(returnToUrl ? { kind: "browser", url: returnToUrl } : { kind: "settings-home" })}
      />
    );
  } else if (subView.kind === "browser") {
    return (
      <BrowserView
        key={subView.linkId}
        runtime={runtime}
        initialUrl={subView.url}
        onBack={() => setSubView({ kind: "home" })}
        onOpenConnectedApp={(origin, url) => setSubView({ kind: "connected-apps", origin, returnToUrl: url })}
        onLocked={() => void refresh(runtime)}
      />
    );
  } else if (subView.kind === "manage-tokens") {
    return (
      <ManageTokensView
        runtime={runtime}
        address={wallet.address}
        onBack={() => setSubView({ kind: "home", editTokens: true })}
      />
    );
  } else if (subView.kind === "display-currency") {
    return <DisplayCurrencyView runtime={runtime} onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "home-screen") {
    return <HomeScreenView runtime={runtime} onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "language") {
    return <LanguageView onBack={() => setSubView({ kind: "appearance" })} />;
  } else if (subView.kind === "use-gleam-on-site") {
    return (
      <UseGleamOnSiteView
        runtime={runtime}
        origin={subView.origin}
        favIconUrl={subView.favIconUrl}
        requestedPermissions={subView.requestedPermissions}
        onBack={() => setSubView({ kind: "home" })}
        onDone={() => setSubView({ kind: "home" })}
      />
    );
  } else {
    return (
      <PendingClaim runtime={runtime} wallet={wallet}>
        <ExistingMemberReveal runtime={runtime} wallet={wallet} enabled={platform.buildInfo.foundingGate}>
          <MainScreenView
            runtime={runtime}
            wallet={wallet}
            onSend={() => setSubView({ kind: "send", token: null })}
            onSendToken={(token) => setSubView({ kind: "send", token })}
            onSendTo={(recipient, token) => setSubView({ kind: "send", token, recipient })}
            sheetContainer={layoutRoot}
            onReceive={() => setSubView({ kind: "receive" })}
            onOpenWalletSwitcher={() => setSubView({ kind: "wallet-switcher" })}
            onOpenSettings={() => setSubView({ kind: "settings-home" })}
            onOpenPoints={() => setSubView({ kind: "points" })}
            onOpenInvites={(walletId) => void openInvites(walletId)}
            onOpenBrowser={platform.capabilities.dappBrowser ? () => setSubView({ kind: "browser" }) : undefined}
            onUseGleamOnSite={(site) => setSubView({ kind: "use-gleam-on-site", ...site })}
            onOpenCollectible={(collectible) => setSubView({ kind: "collectible", collectible })}
            onAddToken={() => setSubView({ kind: "manage-tokens" })}
            initialTokenEditing={subView.kind === "home" && subView.editTokens}
            initialTab={homeTab}
            onTabChange={setHomeTab}
          />
        </ExistingMemberReveal>
      </PendingClaim>
    );
  }
}
