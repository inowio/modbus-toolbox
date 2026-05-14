import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConnectionPage from "./ConnectionPage";

const invokeMock = vi.fn();
const pushToastMock = vi.fn();
const logEventMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useOutletContext: () => ({
      workspace: { name: "WS", created_at: "", updated_at: "" },
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

describe("ConnectionPage", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    pushToastMock.mockReset();
    logEventMock.mockReset();
  });

  function setupLoad() {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_connection_settings") {
        return Promise.resolve({ kind: "serial", serial_port: null });
      }
      if (command === "list_serial_ports") {
        return Promise.resolve([{ port: "COM1", label: "COM1" }]);
      }
      if (command === "test_connection") {
        return Promise.resolve();
      }
      if (command === "set_connection_settings") {
        return Promise.resolve();
      }
      return Promise.resolve(null);
    });
  }

  it("loads connection settings on mount", async () => {
    setupLoad();
    render(<ConnectionPage />);
    await screen.findByText(/modbus connection/i);
    expect(invokeMock).toHaveBeenCalledWith("get_connection_settings", expect.any(Object));
  });

  it("saves settings and shows toast", async () => {
    setupLoad();
    render(<ConnectionPage />);
    await screen.findByText(/modbus connection/i);

    fireEvent.click(screen.getByRole("button", { name: /tcp/i }));
    fireEvent.change(screen.getByLabelText(/host/i), { target: { value: "10.0.0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("set_connection_settings", expect.any(Object)));
    expect(pushToastMock).toHaveBeenCalledWith("Saved", "info");
  });

  it("shows error when test connection fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_connection_settings") {
        return Promise.resolve({ kind: "serial" });
      }
      if (command === "list_serial_ports") {
        return Promise.resolve([]);
      }
      if (command === "test_connection") {
        return Promise.reject(new Error("port busy"));
      }
      return Promise.resolve(null);
    });

    render(<ConnectionPage />);
    await screen.findByText(/modbus connection/i);

    fireEvent.click(screen.getByRole("button", { name: /test connection/i }));

    await screen.findByText(/port busy/i);
  });
});
