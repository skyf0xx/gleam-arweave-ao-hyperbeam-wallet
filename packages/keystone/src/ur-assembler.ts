import { URDecoder, type UR } from "@ngraveio/bc-ur";
import { WrongKeystoneQrError } from "./decode-account";

export type AssemblerResult =
  | { kind: "progress"; percent: number }
  | { kind: "complete"; ur: UR }
  | { kind: "ignored" };

/**
 * Collects the frames of an animated UR QR. A device may show the same
 * frame many times a second and a camera sees every frame repeatedly, so
 * `feed` must tolerate duplicates and noise without failing.
 */
export class UrAssembler {
  private decoder = new URDecoder();

  /** @param expectedType When set, a first frame of any other type throws `WrongKeystoneQrError`. */
  constructor(private readonly expectedType?: string) {}

  feed(text: string): AssemblerResult {
    // Devices print UR QRs in upper case for denser encoding. The decoder
    // wants lower case.
    const part = text.trim().toLowerCase();
    if (!part.startsWith("ur:")) return { kind: "ignored" };

    if (this.expectedType) {
      const [type] = URDecoder.parse(part);
      if (type !== this.expectedType) throw new WrongKeystoneQrError(type);
    }

    this.decoder.receivePart(part);
    if (this.decoder.isError()) throw new Error(this.decoder.resultError());
    if (this.decoder.isComplete() && this.decoder.isSuccess()) {
      return { kind: "complete", ur: this.decoder.resultUR() };
    }
    return { kind: "progress", percent: Math.round(this.decoder.estimatedPercentComplete() * 100) };
  }
}
