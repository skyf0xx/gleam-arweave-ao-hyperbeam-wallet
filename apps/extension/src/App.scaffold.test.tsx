import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import App from "./App";

describe("scaffold: App shell", () => {
  it("mounts with the popup layout", () => {
    const { container } = render(<App layout="popup" />);
    expect(container.querySelector('[data-layout="popup"]')).toBeTruthy();
  });

  it("mounts with the sidepanel layout", () => {
    const { container } = render(<App layout="sidepanel" />);
    expect(container.querySelector('[data-layout="sidepanel"]')).toBeTruthy();
  });
});
