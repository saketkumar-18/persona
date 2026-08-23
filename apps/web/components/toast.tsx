'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
}

let counter = 0;
const listeners = new Set<(t: Toast) => void>();

export function pushToast(message: string): void {
  const t = { id: (counter += 1), message };
  listeners.forEach((l) => l(t));
}

export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const listener = (t: Toast) => {
      setToasts((cur) => [...cur.slice(-3), t]);
      setTimeout(() => remove(t.id), 4000);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [remove]);

  return (
    <div className="pointer-events-none fixed top-16 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="card px-4 py-2 text-sm animate-fade-up" role="status">
          {t.message}
        </div>
      ))}
    </div>
  );
}
