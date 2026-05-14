import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacePage from "./WorkspacePage";

const invokeMock = vi.fn();
const logEventMock = vi.fn();
const refreshWorkspaceMock = vi.fn();
const navigateMock = vi.fn();
const pushToastMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const workspace = {
  name: "Alpha",
  description: "Initial",
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2024-01-02T00:00:00.000Z",
};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useOutletContext: () => ({
      workspace,
      refreshWorkspace: refreshWorkspaceMock,
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

describe("WorkspacePage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    logEventMock.mockReset();
    refreshWorkspaceMock.mockReset();
    navigateMock.mockReset();
    pushToastMock.mockReset();
  });

  it("saves description updates successfully", async () => {
    invokeMock.mockResolvedValue(workspace);

    render(<WorkspacePage />);

    fireEvent.change(screen.getByLabelText(/short description/i), {
      target: { value: "Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save info/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_workspace_description", expect.any(Object)));
    expect(refreshWorkspaceMock).toHaveBeenCalled();
    expect(pushToastMock).toHaveBeenCalledWith("Saved", "info");
  });

  it("surfaces save errors", async () => {
    invokeMock.mockRejectedValue(new Error("cannot save"));

    render(<WorkspacePage />);

    fireEvent.change(screen.getByLabelText(/short description/i), {
      target: { value: "Updated" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save info/i }));

    await screen.findByText(/cannot save/i);
  });

  it("deletes workspace and navigates away", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "delete_workspace") {
        return Promise.resolve();
      }
      if (command === "update_workspace_description") {
        return Promise.resolve(workspace);
      }
      return Promise.resolve(null);
    });

    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("delete_workspace", { name: "Alpha" }));
    expect(navigateMock).toHaveBeenCalledWith("/");
  });

  it("shows delete errors", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "delete_workspace") {
        return Promise.reject(new Error("cannot delete"));
      }
      return Promise.resolve(null);
    });

    render(<WorkspacePage />);

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByText(/cannot delete/i);
  });
});
