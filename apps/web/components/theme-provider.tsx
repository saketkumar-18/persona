'use client';

import Script from 'next/script';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script id="theme-init" strategy="beforeInteractive">
        {`(function(){try{var t=localStorage.getItem('ghostlink:theme');var d=t? t==='dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})()`}
      </Script>
      {children}
    </>
  );
}

export function useThemeToggle() {
  return () => {
    const el = document.documentElement;
    const isDark = el.classList.toggle('dark');
    try {
      localStorage.setItem('ghostlink:theme', isDark ? 'dark' : 'light');
    } catch {
      // ignore
    }
  };
}
