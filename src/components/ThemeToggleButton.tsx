import { FiMoon, FiSun } from "react-icons/fi";
import { useTheme } from "../contexts/ThemeProvider";

type Props = {
  className?: string;
};

export default function ThemeToggleButton({ className }: Props) {
  const { theme, toggleTheme } = useTheme();

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      className={`inline-flex p-2 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500 ${className ?? ""}`}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      {isDark ? (
        <FiSun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <FiMoon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
