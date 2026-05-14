import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastTone = "info" | "error";

type ToastItem = {
  id: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function toastClass(tone: ToastTone): string {
  if (tone === "error") {
    return "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200";
  }
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-100";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<string, number>>({});

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timers = timersRef.current;
    if (timers[id]) {
      window.clearTimeout(timers[id]);
      delete timers[id];
    }
  }, []);

  const pushToast = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const item: ToastItem = { id, message, tone };

      setToasts((prev) => {
        const next = [...prev, item];
        if (next.length > 4) return next.slice(next.length - 4);
        return next;
      });

      timersRef.current[id] = window.setTimeout(() => removeToast(id), 4500);
    },
    [removeToast],
  );

  useEffect(() => {
    return () => {
      const timers = timersRef.current;
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
      }
      timersRef.current = {};
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-4 z-50 flex w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-2xl backdrop-blur ${toastClass(t.tone)}`}
            role={t.tone === "error" ? "alert" : "status"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 whitespace-pre-wrap wrap-break-word">{t.message}</div>
              <button
                type="button"
                className="shrink-0 rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-white/5 dark:text-slate-200"
                onClick={() => removeToast(t.id)}
              >
                Close
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function useErrorToast(error: string | null) {
  const { pushToast } = useToast();
  const prevRef = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      prevRef.current = null;
      return;
    }
    if (prevRef.current === error) return;
    prevRef.current = error;
    pushToast(error, "error");
  }, [error, pushToast]);
}
