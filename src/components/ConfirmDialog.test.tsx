import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("does not render when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete"
        description="Confirm"
        confirmText="Delete"
        onConfirm={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls confirm and close handlers", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete"
        description="Confirm"
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
