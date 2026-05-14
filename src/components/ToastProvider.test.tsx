import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useErrorToast, useToast } from "./ToastProvider";

function ToastButton() {
  const { pushToast } = useToast();
  return <button type="button" onClick={() => pushToast("Hello")}>Add</button>;
}

function ErrorToast({ message }: { message: string | null }) {
  useErrorToast(message);
  return null;
}

describe("ToastProvider", () => {
  it("throws when used outside provider", () => {
    const renderWithoutProvider = () => render(<ToastButton />);
    expect(renderWithoutProvider).toThrow("useToast must be used within ToastProvider");
  });

  it("renders toast and allows dismissal", () => {
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Hello")).toBeNull();
  });

  it("pushes error toast on change", () => {
    const { rerender } = render(
      <ToastProvider>
        <ErrorToast message={null} />
      </ToastProvider>,
    );

    rerender(
      <ToastProvider>
        <ErrorToast message="Oops" />
      </ToastProvider>,
    );

    expect(screen.getByText("Oops")).toBeInTheDocument();
  });
});
