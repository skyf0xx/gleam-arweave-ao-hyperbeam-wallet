import { beforeEach, describe, expect, it, vi } from "vitest";

const remove = vi.hoisted(() => vi.fn());
const addListener = vi.hoisted(() => vi.fn());
const minimizeApp = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/app", () => ({ App: { addListener, minimizeApp } }));

import { createBackButton } from "./back-button";

let press: () => void;

beforeEach(() => {
  remove.mockReset();
  minimizeApp.mockReset().mockResolvedValue(undefined);
  addListener.mockReset().mockImplementation((_event: string, listener: () => void) => {
    press = listener;
    return Promise.resolve({ remove });
  });
});

describe("createBackButton", () => {
  it("leaves the app where it is when the handler used the press", () => {
    createBackButton().subscribe(() => true);
    press();
    expect(addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it("minimises the app when the handler had nowhere to go", () => {
    createBackButton().subscribe(() => false);
    press();
    expect(minimizeApp).toHaveBeenCalledTimes(1);
  });

  it("removes the listener on unsubscribe", async () => {
    const unsubscribe = createBackButton().subscribe(() => true);
    unsubscribe();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
