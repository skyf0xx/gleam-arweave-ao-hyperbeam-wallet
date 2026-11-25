import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  capabilityRefusal,
  isHardwareWalletMethod,
  type Collectible,
  type NameTargetDraft,
  type NameTargetRequest,
  type RuntimePort,
  type TransferFeeQuote,
  type WalletSummary,
} from "@gleam/core";
import { ScreenHeader } from "@gleam/ui/src/primitives/screen-header.tsx";
import { ScreenFooter } from "@gleam/ui/src/primitives/screen-footer.tsx";
import { InlineError } from "@gleam/ui/src/primitives/inline-error.tsx";
import { useT } from "../../../i18n";
import { errorText } from "../../../i18n/errors";
import { walletQueryKeys } from "../../activity";
import { NameTargetReview, ReviewButtons } from "../../../transfer-review/TransferReview";

export interface NameTargetViewProps {
  runtime: RuntimePort;
  wallet: WalletSummary;
  /** A held, unlisted Permaweb Name. */
  collectible: Collectible & { permawebName: NonNullable<Collectible["permawebName"]> };
  target: string;
  onBack: () => void;
  /** Gets the name with its new target. */
  onDone: (collectible: Collectible) => void;
}

/** The review for pointing a name at `target`; the fee is quoted on open and fixed on sign. */
export function NameTargetView({ runtime, wallet, collectible, target, onBack, onDone }: NameTargetViewProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const draft: NameTargetDraft = { walletId: wallet.id, carrier: collectible.id, label: collectible.permawebName.label, target };
  const quote = useQuery({
    queryKey: ["nameTargetQuote", wallet.id, collectible.id] as const,
    queryFn: () => runtime.send<NameTargetDraft, TransferFeeQuote>({ type: "estimateNameTarget", payload: draft }),
    retry: false,
    // The reward is fixed at sign, so a cached quote from an earlier visit isn't signed before a fresh one lands.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const mutation = useMutation({
    mutationFn: (request: NameTargetRequest) =>
      runtime.send<NameTargetRequest, { txId: string }>({ type: "setNameTarget", payload: request }),
    onSuccess: () => {
      queryClient.setQueryData<Collectible[]>(walletQueryKeys.collectibles(wallet.address), (current) =>
        current?.map((item) =>
          item.id === collectible.id && item.permawebName ? { ...item, permawebName: { ...item.permawebName, target } } : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: walletQueryKeys.balances(wallet.address) });
    },
  });
  const unsupported = capabilityRefusal(wallet.method, "signTransaction", "change a name's target");
  const signsOnDevice = isHardwareWalletMethod(wallet.method);
  const submitting = mutation.isPending;
  const fee = quote.isFetching ? null : (quote.data?.fee ?? null);

  const handleSign = async () => {
    if (fee === null) return;
    setError(undefined);
    try {
      await mutation.mutateAsync({ ...draft, fee });
      onDone({ ...collectible, permawebName: { ...collectible.permawebName, target } });
    } catch (signError) {
      setError(errorText(signError));
    }
  };

  const blocking = unsupported ?? (quote.isError ? quote.error : null);
  return (
    <NameTargetReview
      header={<ScreenHeader title={t("collectibles.changeTarget")} onBack={onBack} busy={submitting} />}
      label={collectible.permawebName.label}
      target={target}
      fee={fee}
      from={{ name: wallet.name, address: wallet.address }}
      context={{}}
      footer={
        <div className="mt-auto flex flex-col px-6 phone:px-5">
          <ScreenFooter pinned={false} className="pb-6 pt-5">
            <ReviewButtons
              secondaryLabel={t("transferReview.cancel")}
              onSecondary={onBack}
              primaryLabel={
                submitting
                  ? signsOnDevice
                    ? t("send.waitingForApproval")
                    : t("approval.signing")
                  : quote.isPending
                    ? t("send.estimatingFee")
                    : t("transferReview.sign")
              }
              onPrimary={() => void handleSign()}
              warned={false}
              busy={submitting || fee === null || blocking !== null}
              className="mt-0 p-0 phone:px-0"
            />
          </ScreenFooter>
        </div>
      }
    >
      {blocking !== null || error ? (
        <InlineError size="label" as="div">
          {error ?? errorText(blocking)}
        </InlineError>
      ) : null}
      {submitting && signsOnDevice ? (
        <p role="status" className="text-label leading-snug text-muted">
          {t("send.approveOnDevice")}
        </p>
      ) : null}
    </NameTargetReview>
  );
}
