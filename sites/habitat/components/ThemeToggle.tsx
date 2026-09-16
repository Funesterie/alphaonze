'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    // Check localStorage first, then system preference
    let savedTheme: string | null = null;
    try {
      savedTheme = localStorage.getItem('habitat-theme');
    } catch (e) {
      // localStorage not available
    }
    
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(prefersDark ? 'dark' : 'light');
      document.documentElement.removeAttribute('data-theme');
    }
  }, []);

  const toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const isDark = currentTheme === 'dark' || 
      (!currentTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const newTheme = isDark ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    try {
      localStorage.setItem('habitat-theme', newTheme);
    } catch (e) {
      // localStorage not available
    }
    setTheme(newTheme);
  };

  const isDark = theme === 'dark' || 
    (!theme && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-toggle px-4 py-2 text-sm font-medium rounded-full border border-[var(--rule)] bg-[var(--surface)] text-[var(--ink-soft)] hover:text-[var(--cobalt)] hover:border-[var(--cobalt)] transition-colors"
    >
      {isDark ? 'Mode clair' : 'Mode sombre'}
    </button>
  );
}
