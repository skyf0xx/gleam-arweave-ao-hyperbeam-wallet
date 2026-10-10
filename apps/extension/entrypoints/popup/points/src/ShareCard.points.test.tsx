import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ShareCard } from "./ShareCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockCanvas(blob: Blob | null) {
  const ctx = {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    (callback) => callback(blob),
  );
  return ctx;
}

describe("ShareCard", () => {
  it("shows the founding number, invites and the permanence line", () => {
    render(<ShareCard foundingNumber={184} seatsLeft={3} />);

    expect(
      screen.getByRole("img", { name: "Gleam OG number 184" }),
    ).toBeTruthy();
    expect(screen.getByText("OG")).toBeTruthy();
    expect(screen.getByText("#184")).toBeTruthy();
    expect(screen.getByText("3 invites")).toBeTruthy();
    expect(screen.getByText("You are early")).toBeTruthy();
  });

  it("leaves the invites line off at zero seats or when unreported", () => {
    const { rerender } = render(
      <ShareCard foundingNumber={184} seatsLeft={0} />,
    );
    expect(screen.queryByText(/invite/)).toBeNull();
    rerender(<ShareCard foundingNumber={184} seatsLeft={null} />);
    expect(screen.queryByText(/invite/)).toBeNull();
  });

  it("downloads the card as a PNG named for the number", async () => {
    const ctx = mockCanvas(new Blob(["png"], { type: "image/png" }));
    const createObjectURL = vi.fn(() => "blob:card");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("gleam-founding-184.png");
        expect(this.href).toBe("blob:card");
      });
    render(<ShareCard foundingNumber={184} seatsLeft={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(ctx.fillText).toHaveBeenCalledWith(
      "#184",
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      "3 invites",
      expect.any(Number),
      expect.any(Number),
    );
    expect(ctx.fillText).toHaveBeenCalledWith(
      "You are early",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("says when the image can't be saved", async () => {
    mockCanvas(null);
    render(<ShareCard foundingNumber={184} seatsLeft={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Save image" }));

    expect(await screen.findByText("Couldn't save the image.")).toBeTruthy();
  });
});
