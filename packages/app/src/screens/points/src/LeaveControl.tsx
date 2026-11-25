import { useState } from "react";
import { isHardwareWalletMethod, type RuntimePort, type WalletSummary } from "@gleam/core";
import { useBackHandler } from "@gleam/ui/src/primitives/back-stack.tsx";
import { ButtonPair } from "@gleam/ui/src/primitives/button-pair.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { DeviceApprovalNote } from "./DeviceApprovalNote";
import { useLeavePoints } from "./usePoints";

export function LeaveControl({
  runtime,
  wallet,
  points,
}: {
  runtime: RuntimePort;
  wallet: WalletSummary;
  points: string;
}) {
  const t = useT();
  const leave = useLeavePoints(runtime);
  const [confirming, setConfirming] = useState(false);
  useBackHandler(confirming ? () => setConfirming(false) : null);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-label text-faint hover:text-muted"
      >
        {t("points.leave")}
      </button>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={t("points.leave")}
      className="flex w-full flex-col gap-3 rounded-lg border border-line p-4"
    >
      <p className="text-label text-foreground">
        {t("points.leaveWarning", { points })}
      </p>
      {leave.error instanceof Error ? (
        <p className="text-caption text-warning">{errorText(leave.error)}</p>
      ) : null}
      <ButtonPair
        size="sm"
        cancelLabel={t("points.cancel")}
        onCancel={() => setConfirming(false)}
        confirmLabel={leave.isPending ? t("points.leaving") : t("points.leaveConfirm")}
        confirmVariant="destructive"
        confirmDisabled={leave.isPending}
        onConfirm={() => leave.mutate({ walletId: wallet.id })}
      />
      {leave.isPending && isHardwareWalletMethod(wallet.method) ? <DeviceApprovalNote /> : null}
    </div>
  );
}
