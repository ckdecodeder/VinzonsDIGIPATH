import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'dp_theme';

const ThemeContext = createContext({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

export const getStoredTheme = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export const applyTheme = (theme) => {
  document.documentElement.setAttribute(
    'data-theme',
    theme === 'dark' ? 'dark' : 'light',
  );
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage failures
    }
  }, [theme]);

  const setTheme = (next) => {
    setThemeState(next === 'dark' ? 'dark' : 'light');
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
