import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/ToastProvider";
import { HelpProvider } from "./help/HelpProvider";
import { ThemeProvider } from "./contexts/ThemeProvider";
import "./index.css";

const THEME_STORAGE_KEY = "inowio.theme";

function applyInitialThemeClass() {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  const theme = raw === "light" || raw === "dark" ? raw : "dark";
  document.documentElement.classList.toggle("dark", theme === "dark");
}

applyInitialThemeClass();

document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  ) {
    return;
  }
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <ToastProvider>
          <HelpProvider>
            <App />
          </HelpProvider>
        </ToastProvider>
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
