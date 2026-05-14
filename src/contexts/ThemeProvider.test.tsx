import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import ThemeToggleButton from "../components/ThemeToggleButton";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function ThemeReader() {
  const { theme } = useTheme();
  return <div>{theme}</div>;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("throws when used outside provider", () => {
    const renderWithoutProvider = () => render(<ThemeReader />);
    expect(renderWithoutProvider).toThrow("useTheme must be used within ThemeProvider");
  });

  it("toggles theme and updates storage", () => {
    window.localStorage.setItem("inowio.theme", "light");
    render(
      <ThemeProvider>
        <ThemeToggleButton />
      </ThemeProvider>,
    );

    const button = screen.getByRole("button", { name: /switch to dark theme/i });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(button);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("inowio.theme")).toBe("dark");
  });
});
