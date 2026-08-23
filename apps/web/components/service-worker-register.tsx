'use client';

import { useEffect, useState } from 'react';

/** Registers the service worker once (deployment/production permissive). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => undefined);
  }, []);
  return null;
}
