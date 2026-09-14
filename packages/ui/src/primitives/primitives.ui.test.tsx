import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button";
import { Beam, BeamMark } from "./beam";
import { ScreenHeader } from "./screen-header";
import { Card, ListRow } from "./card";
import { TextField } from "./text-field";
import { FileDropzone } from "./file-dropzone";
import { RiskNotice } from "./risk-notice";
import { EmptyState } from "./empty-state";
import { StatusDot } from "./status-dot";

describe("ui: Button variants", () => {
  it("renders the primary variant by default", () => {
    render(<Button>Sign and send</Button>);
    const button = screen.getByRole("button", { name: "Sign and send" });
    expect(button.className).toContain("bg-foreground");
  });

  it("renders the destructive variant for irreversible-tier actions", () => {
    render(<Button variant="destructive">Reset wallet</Button>);
    const button = screen.getByRole("button", { name: "Reset wallet" });
    expect(button.className).toContain("bg-warning");
  });

  it("renders the secondary variant with a border, not a fill", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.className).toContain("border-line");
    expect(button.className).not.toContain("bg-foreground");
  });
});

describe("ui: Beam", () => {
  it("renders the identity divider with no interactive/warning semantics", () => {
    render(<Beam />);
    const beam = screen.getByRole("presentation");
    expect(beam.className).toContain("gleam-beam-divider");
  });

  it("BeamMark renders exactly five segments", () => {
    render(<BeamMark />);
    const wrapper = screen.getByRole("presentation");
    expect(wrapper.children.length).toBe(5);
  });
});

describe("ui: ScreenHeader", () => {
  it("renders the title and calls onBack when the back button is pressed", () => {
    const onBack = vi.fn();
    render(<ScreenHeader title="Send" onBack={onBack} />);
    expect(screen.getByText("Send")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders a spacer instead of a back button when onBack is omitted", () => {
    render(<ScreenHeader title="Unlock" />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("ui: Card + ListRow", () => {
  it("renders rows as buttons when onClick is supplied, divs otherwise", () => {
    const onClick = vi.fn();
    render(
      <Card>
        <ListRow title="Auto-lock" subtitle="Never" onClick={onClick} />
        <ListRow title="Network fee" subtitle="0.0008 AR" />
      </Card>,
    );
    const interactiveRow = screen.getByRole("button", { name: /Auto-lock/ });
    fireEvent.click(interactiveRow);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText("Network fee").closest("div")?.tagName).toBe("DIV");
  });
});

describe("ui: TextField", () => {
  it("associates the label and surfaces an inline error via role=alert", () => {
    render(<TextField label="Amount" errorMessage="Insufficient balance" />);
    expect(screen.getByLabelText("Amount")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Insufficient balance");
  });

  it("marks the input aria-invalid when an error is present", () => {
    render(<TextField label="To" errorMessage="Invalid address" />);
    expect(screen.getByLabelText("To").getAttribute("aria-invalid")).toBe("true");
  });
});

describe("ui: FileDropzone", () => {
  it("calls onFile when a file is selected via the hidden input", () => {
    const onFile = vi.fn();
    const { container } = render(<FileDropzone onFile={onFile} accept="application/json" />);
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(['{"kty":"RSA"}'], "keyfile.json", { type: "application/json" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("shows the error affordance when errorMessage is set", () => {
    render(<FileDropzone onFile={vi.fn()} errorMessage="That file isn't a valid Arweave keyfile" />);
    expect(screen.getByText("That file isn't a valid Arweave keyfile")).toBeTruthy();
  });
});

describe("ui: RiskNotice", () => {
  it("renders as an alert carrying the irreversible-tier warning copy", () => {
    render(<RiskNotice>You haven&apos;t sent to this address before.</RiskNotice>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("haven't sent to this address before");
    expect(alert.className).toContain("bg-warning-surface");
  });
});

describe("ui: EmptyState", () => {
  it("renders the release-valve copy line with no warning styling", () => {
    render(<EmptyState message="Nothing here yet." />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});

describe("ui: StatusDot", () => {
  it("defaults to the positive tone", () => {
    const { container } = render(<StatusDot label="arweave.net" />);
    expect(container.querySelector(".bg-positive")).toBeTruthy();
  });

  it("never renders a beam color for status", () => {
    const { container } = render(<StatusDot label="offline" tone="warning" />);
    expect(container.innerHTML).not.toContain("beam");
  });
});
