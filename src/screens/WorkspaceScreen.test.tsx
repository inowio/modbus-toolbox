import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkspaceScreen, { type Workspace } from "./WorkspaceScreen";

const invokeMock = vi.fn();
const listAppLogsMock = vi.fn();
const pushToastMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const setTitleMock = vi.fn();
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    setTitle: setTitleMock,
  }),
}));

vi.mock("../components/ThemeToggleButton", () => ({
  default: () => <button type="button">toggle theme</button>,
}));

vi.mock("../components/ToastProvider", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
  useErrorToast: () => undefined,
}));

vi.mock("../help/HelpProvider", () => ({
  useHelp: () => ({ openHelp: vi.fn(), closeHelp: vi.fn(), isHelpOpen: false }),
}));

vi.mock("../screen2/api/logs", async () => {
  const actual = await vi.importActual<typeof import("../screen2/api/logs")>("../screen2/api/logs");
  return {
    ...actual,
    listAppLogs: (...args: unknown[]) => listAppLogsMock(...args),
  };
});

function setAppVersion(value: string) {
  (globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ = value;
}

describe("WorkspaceScreen", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listAppLogsMock.mockReset();
    pushToastMock.mockReset();
    listAppLogsMock.mockResolvedValue([]);
    setAppVersion("test");
  });

  function renderScreen(overrides?: { workspaces?: Workspace[] }) {
    const workspaces =
      overrides?.workspaces ??
      ([
        {
          name: "Alpha",
          description: "Primary",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-02T00:00:00.000Z",
          slave_count: 3,
        },
      ] satisfies Workspace[]);

    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "list_workspaces":
          return Promise.resolve(workspaces);
        case "touch_workspace":
          return Promise.resolve(workspaces[0]);
        case "delete_workspace":
        case "create_workspace":
          return Promise.resolve();
        default:
          return Promise.resolve(null);
      }
    });

    const onOpen = vi.fn();
    const utils = render(<WorkspaceScreen onOpen={onOpen} />);
    return { onOpen, ...utils };
  }

  it("loads workspaces and opens selection", async () => {
    const { onOpen } = renderScreen();

    await screen.findByText("Alpha");

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "Alpha" })));
    expect(invokeMock).toHaveBeenCalledWith("touch_workspace", expect.objectContaining({ name: "Alpha" }));
  });

  it("shows errors when loading workspaces fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_workspaces") {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(null);
    });

    render(<WorkspaceScreen onOpen={vi.fn()} />);

    await screen.findByText(/boom/i);
  });

  it("surfaces delete errors in the confirm dialog", async () => {
    const error = new Error("cannot delete workspace");
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_workspaces") {
        return Promise.resolve([
          {
            name: "Alpha",
            description: "Primary",
            created_at: "2024-01-01T00:00:00.000Z",
            updated_at: "2024-01-02T00:00:00.000Z",
            slave_count: 1,
          },
        ] satisfies Workspace[]);
      }
      if (command === "delete_workspace") {
        return Promise.reject(error);
      }
      return Promise.resolve(null);
    });

    render(<WorkspaceScreen onOpen={vi.fn()} />);

    await screen.findByText("Alpha");
    fireEvent.click(screen.getByRole("button", { name: "Delete Alpha" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await screen.findByText(/cannot delete workspace/i);
  });
});
