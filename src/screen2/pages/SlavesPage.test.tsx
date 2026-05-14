import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SlavesPage from "./SlavesPage";

const invokeMock = vi.fn();
const navigateMock = vi.fn();
const pushToastMock = vi.fn();
const logEventMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useOutletContext: () => ({
      workspace: { name: "TestWS", updated_at: "", created_at: "" },
    }),
  };
});

vi.mock("../../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
  useErrorToast: () => undefined,
}));

vi.mock("../api/logs", async () => {
  const actual = await vi.importActual<typeof import("../api/logs")>("../api/logs");
  return {
    ...actual,
    logEvent: (...args: unknown[]) => logEventMock(...args),
  };
});

describe("SlavesPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    navigateMock.mockReset();
    pushToastMock.mockReset();
    logEventMock.mockReset();
  });

  function setupList(slaves = [{ id: 1, name: "Pump", unitId: 10, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" }]) {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_slaves") {
        return Promise.resolve(slaves);
      }
      return Promise.resolve(null);
    });
  }

  it("loads and renders slave rows", async () => {
    setupList();
    render(<SlavesPage />);
    await screen.findByText(/Pump/);
    expect(screen.getByText(/Unit-ID 10/i)).toBeInTheDocument();
  });

  it("shows validation error in modal when fields missing", async () => {
    setupList([]);
    render(<SlavesPage />);

    fireEvent.click(await screen.findByRole("button", { name: /^add$/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /add/i }));

    await screen.findByText(/name is required/i);
  });

  it("humanizes delete errors", async () => {
    setupList([
      { id: 5, name: "Valve", unitId: 5, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
    ]);

    invokeMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "list_slaves") {
        return Promise.resolve([
          { id: 5, name: "Valve", unitId: 5, createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-01T00:00:00Z" },
        ]);
      }
      if (command === "delete_slave" && args?.id === 5) {
        return Promise.reject(new Error("foreign key constraint failed"));
      }
      return Promise.resolve(null);
    });

    render(<SlavesPage />);

    const valveText = await screen.findByText(/Valve/i);
    const row = valveText.closest("li");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLLIElement).getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /delete/i }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("delete_slave", expect.objectContaining({ id: 5 })),
    );
    await waitFor(() =>
      expect(logEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Failed to delete slave",
          detailsJson: expect.objectContaining({
            humanMessage: expect.stringContaining("Analyzer dashboard"),
          }),
        }),
      ),
    );
  });

  it("navigates to details when clicking open", async () => {
    setupList();
    render(<SlavesPage />);
    const listButton = await screen.findByRole("button", { name: /unit-id 10/i });
    fireEvent.click(listButton);
    expect(navigateMock).toHaveBeenCalledWith("1");
  });
});
