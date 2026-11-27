import fc from "fast-check";
import { bytesToBase64Url } from "@gleam/core";

/** The arbitraries the signing property tests share: what a page can ask Gleam to sign. */

export const address = fc.uint8Array({ minLength: 32, maxLength: 32 }).map(bytesToBase64Url);

/** Whole Winston, small, large, and either side of 2^64, where a fixed-width reader would wrap. */
export const winston = fc.oneof(
  fc.constantFrom("0", "1", "007"),
  fc.bigInt({ min: 0n, max: 10n ** 20n }).map(String),
  fc.constantFrom(2n ** 63n, 2n ** 64n - 1n, 2n ** 64n, 2n ** 64n + 1n).map(String),
);

/** Any code point, NUL and bidi controls included. */
export const text = (maxLength: number) => fc.string({ unit: "binary", maxLength });

const loneSurrogate = fc.integer({ min: 0xd800, max: 0xdfff }).map((code) => String.fromCharCode(code));

/** As `text`, sometimes with a lone surrogate: a page's strings are UTF-16, and not every one encodes to UTF-8. */
export const pageText = (maxLength: number) =>
  fc.oneof(
    { weight: 19, arbitrary: text(maxLength) },
    { weight: 1, arbitrary: fc.tuple(text(maxLength), loneSurrogate, text(maxLength)).map((parts) => parts.join("")) },
  );

export const hasLoneSurrogate = (value: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

/** Mostly the first value, so the exact spelling a reader wants comes up often. */
const mostly = <T>(usual: T, ...others: T[]) =>
  fc.oneof({ weight: 3, arbitrary: fc.constant(usual) }, { weight: 1, arbitrary: fc.constantFrom(...others) });

/**
 * Tags that read as a token transfer (the AO spelling or the L1 one), a
 * collectible transfer, a name change, or none of them, so each reading
 * the preview and the device step make is reached.
 */
export const signingTags = (value: fc.Arbitrary<string>) => {
  const amount = fc.oneof({ weight: 4, arbitrary: fc.constant("1") }, fc.bigInt({ min: 1n, max: 10n ** 24n }).map(String), value);
  const random = fc.array(fc.record({ name: fc.oneof(fc.constantFrom("Action", "action", "Recipient", "Quantity"), value), value }), {
    maxLength: 6,
  });
  const transfer = fc
    .tuple(
      fc.boolean(),
      mostly("Transfer", "TRANSFER"),
      address,
      amount,
      fc.array(fc.record({ name: value, value }), { maxLength: 2 }),
    )
    .chain(([lowercase, verb, recipient, quantity, extra]) => {
      const spell = (name: string) => (lowercase ? name.toLowerCase() : name);
      const all = [
        { name: spell("Action"), value: lowercase ? verb.toLowerCase() : verb },
        { name: spell("Recipient"), value: recipient },
        { name: spell("Quantity"), value: quantity },
        ...extra,
      ];
      const whole = fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length });
      const missingOne = fc.shuffledSubarray(all, { minLength: all.length - 1, maxLength: all.length - 1 });
      return fc.oneof({ weight: 4, arbitrary: whole }, { weight: 1, arbitrary: missingOne });
    });
  const nameTarget = address.map((target) => [
    { name: "action", value: "set" },
    { name: "reference-value", value: target },
  ]);
  return fc.oneof(random, { weight: 3, arbitrary: transfer }, { weight: 2, arbitrary: nameTarget });
};
