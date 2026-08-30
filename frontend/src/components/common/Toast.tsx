// SPDX-License-Identifier: AGPL-3.0-only
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "" | "good" | "bad" | "busy";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ToastApi {
  /** Show a toast; `ms <= 0` keeps it until dismissed. */
  (message: string, kind?: ToastKind, ms?: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Dismissal delay matching the CSS toast-out animation. */
const EXIT_ANIMATION_MS = 260;
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      const timer = setTimeout(() => dismiss(id), ms + EXIT_ANIMATION_MS);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const toast = useCallback<ToastApi>(
    (message, kind = "", ms = 4200) => {
      const id = nextId.current++;
      setToasts((current) =>
        [...current, { id, message, kind }].slice(-MAX_VISIBLE),
      );
      if (ms > 0) schedule(id, ms);
    },
    [schedule],
  );

  // Clear every pending timer when the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind ? ` ${t.kind}` : ""}`}>
            <span className="toast-msg">{t.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
