import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * Welcome — the only screen with the tagline as hero copy, one primary +
 * one secondary action, nothing else. The first question is only "new or
 * existing?"; how to bring an existing wallet in is `ExistingWallet`'s job,
 * so new ways in never crowd this screen.
 */
export interface WelcomeProps {
  onCreate: () => void;
  onExisting: () => void;
}

export function Welcome({ onCreate, onExisting }: WelcomeProps) {
  return (
    <div className="flex min-h-full flex-col items-center px-8 phone:px-5 pb-8 pt-7 phone:pt-4">
      <div className="my-auto">
        <BeamMark tagline="crypto, without the clutter." />
      </div>
      <div className="flex w-full flex-col gap-2.5">
        <Button type="button" onClick={onCreate}>
          Create a wallet
        </Button>
        <Button type="button" variant="secondary" onClick={onExisting}>
          I already have a wallet
        </Button>
      </div>
    </div>
  );
}
