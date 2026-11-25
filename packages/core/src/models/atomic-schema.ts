import { z } from "zod";
import { atomicString } from "./balance";

/** `atomicString(value, pattern)` as a field: an atomic-integer string, or `null` for anything else, a missing field included. */
export const atomicStringSchema = (pattern?: RegExp) =>
  z
    .unknown()
    .optional()
    .transform((value) => atomicString(value, pattern));
