import { isPlainRecord } from "@gleam/core";

export function storedRecord<T>(raw: unknown): Record<string, T> {
  return isPlainRecord(raw) ? ({ ...raw } as Record<string, T>) : {};
}

export function without<T>(record: Record<string, T>, walletId: string): Record<string, T> {
  const next = { ...record };
  delete next[walletId];
  return next;
}

