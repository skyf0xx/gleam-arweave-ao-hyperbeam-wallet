import type { RefObject } from "react";
import type { PortfolioHistoryRange, WalletSummary } from "@gleam/core";
import { AccountAvatar } from "@gleam/ui/src/components/wallet/index.ts";
import { truncateAddress } from "@gleam/ui/src/format/truncate-address.ts";
import { CopyButton } from "@gleam/ui/src/primitives/copy-button.tsx";
import { BackIcon } from "@gleam/ui/src/primitives/icons.tsx";
import { useCopy } from "@gleam/ui/src/primitives/use-copy.ts";
import { useAddressIdentity } from "../../../address-identity";
import { useT } from "../../../i18n";
import { GlobeIcon, SettingsIcon } from "./homeIcons";

/**
 * One of the home header's two states. Shown, it sits in the row; hidden, it is lifted out to the row's left edge
 * (or across it, with `inset`), faded and unreachable. Opacity and a 4px rise run as transitions, so a swap is a
 * cross-fade with the same small lift whatever the scroll did.
 */
function headerLayer(shown: boolean, inFlow: string, inset?: string) {
  const place = inset ?? "left-5";
  return {
    "aria-hidden": shown ? undefined : true,
    inert: !shown,
    className: [
      "items-center transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
      inset ? `absolute top-4 bottom-2.5 flex justify-center phone:inset-y-0 ${place}` : shown ? inFlow : `absolute top-4 bottom-2.5 phone:inset-y-0 ${place} ${inFlow}`,
      // `starting:` fades in a layer that mounts already shown.
      shown ? "opacity-100 starting:translate-y-1 starting:opacity-0" : "pointer-events-none translate-y-1 opacity-0",
    ].join(" "),
  };
}

export interface HomeHeaderProps {
  wallet: WalletSummary;
  headerRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  /** The portfolio figure and change shown centred in the collapsed bar; `null` while there is none to show. */
  summary: { value: string; percent: string; change: number; range: PortfolioHistoryRange } | null;
  returnHome: () => void;
  onOpenWalletSwitcher: () => void;
  onOpenSettings: () => void;
  onOpenBrowser?: () => void;
}

/** The pinned top bar: the account pill, the collapsed-state back button and summary, and the browser and settings buttons. */
export function HomeHeader({
  wallet,
  headerRef,
  collapsed: headerCollapsed,
  summary,
  returnHome,
  onOpenWalletSwitcher,
  onOpenSettings,
  onOpenBrowser,
}: HomeHeaderProps) {
  const t = useT();
  const identity = useAddressIdentity();
  const avatarSvg = identity.avatarSvg(wallet.address);
  const { copied: addressCopied, copy: copyAddress } = useCopy(wallet.address);

  return (
    <div ref={headerRef} className="gleam-frost-bar relative sticky top-[var(--inset-top)] z-30 flex items-center justify-between gap-2.5 bg-background px-5 pb-2.5 pt-4 phone:h-16 phone:py-0">
      {/*
        The two header states are both drawn and cross-fade. The one showing sits in the row; the one leaving is
        lifted out of it at the same place, so it fades out where it was while the other fades in.
      */}
      <span {...headerLayer(headerCollapsed, "flex flex-shrink-0")}>
        {/* h-9 matches the account pill's height so the row, and the list docked under it, don't shift. */}
        <button
          type="button"
          aria-label={t("mainScreen.back")}
          onClick={returnHome}
          className="-ml-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground phone:-ml-3 phone:h-11 phone:w-11"
        >
          <BackIcon />
        </button>
      </span>
      <span {...headerLayer(!headerCollapsed, "flex min-w-0 max-w-[calc(100%-6rem)]")}>
        {/* The copy button can't nest inside the pill's button, so the wrapper carries the shared hover background. */}
        <div className="group -ml-3 flex min-w-0 items-center rounded-lg pr-1 hover:bg-hover phone:ml-0 phone:pr-0">
          <button
            type="button"
            onClick={onOpenWalletSwitcher}
            aria-haspopup="dialog"
            aria-label={t("mainScreen.accountDetails", { name: wallet.name, address: wallet.address })}
            className="flex min-w-0 items-center gap-2 rounded-lg py-1.5 pl-0 pr-1 phone:min-h-11 phone:gap-2.5"
          >
            <AccountAvatar svgMarkup={avatarSvg} label={t("mainScreen.avatarOf", { name: wallet.name })} size={24} />
            <span className="truncate text-label layered:text-muted">{wallet.name}</span>
            <span className="truncate font-mono text-label text-faint">
              {truncateAddress(wallet.address, 6)}
            </span>
          </button>
          <CopyButton
            copied={addressCopied}
            onCopy={copyAddress}
            label={addressCopied ? t("mainScreen.addressCopied") : t("mainScreen.copyAddress")}
            title={addressCopied ? t("mainScreen.copied") : t("mainScreen.copyAddress")}
            reveal
            tone="muted"
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md transition-opacity focus-visible:opacity-100 group-hover:opacity-100 phone:opacity-100 phone:hit-target"
          />
        </div>
      </span>

      {summary ? (
        // Centred on the header, clear of the buttons either side, so it never moves as the states trade places.
        <span {...headerLayer(headerCollapsed, "", onOpenBrowser ? "inset-x-24" : "inset-x-14")}>
          {/* The range tabs fade out with the chart, so the range rides along to say what the change covers. */}
          <button
            type="button"
            onClick={returnHome}
            className="flex min-w-0 flex-1 items-baseline justify-center gap-1.5 text-label tabular-nums text-muted phone:min-h-11 phone:items-center"
          >
            <span className="truncate font-semibold text-foreground">
              {summary.value}
            </span>{" "}
            <span className="font-semibold" style={{ color: summary.change >= 0 ? "var(--color-positive)" : "var(--color-negative)" }}>
              {summary.percent}
            </span>{" "}
            <span>{summary.range}</span>
          </button>
        </span>
      ) : null}

      <div className="gleam-round-buttons flex flex-shrink-0 items-center phone:-mr-3">
        {onOpenBrowser ? (
          <button
            type="button"
            aria-label={t("mainScreen.browser")}
            onClick={onOpenBrowser}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground phone:h-11 phone:w-11 gleam-frost-round"
          >
            <GlobeIcon />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t("mainScreen.settings")}
          onClick={onOpenSettings}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-foreground phone:h-11 phone:w-11 gleam-frost-round"
        >
          <SettingsIcon />
        </button>
      </div>
    </div>
  );
}
