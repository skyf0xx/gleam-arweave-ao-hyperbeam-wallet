import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import App from "./App";

afterEach(() => {
  cleanup();
});

describe("scaffold: App shell", () => {
  it("mounts with the popup layout", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<App layout="popup" />));
    });
    expect(container.querySelector('[data-layout="popup"]')).toBeTruthy();
  });

  it("mounts with the sidepanel layout", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<App layout="sidepanel" />));
    });
    expect(container.querySelector('[data-layout="sidepanel"]')).toBeTruthy();
  });
});
