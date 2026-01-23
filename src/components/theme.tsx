import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  defaultTheme?: Theme;
  enableSystem?: boolean;
  storageKey?: string;
  disableTransitionOnChange?: boolean;
}

interface ThemeContextType {
  theme: Theme | undefined;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'dark' | 'light' | undefined;
  themes: Theme[];
  systemTheme: 'dark' | 'light' | undefined;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
  children,
  attribute = 'class',
  defaultTheme = 'system',
  enableSystem = true,
  storageKey = 'theme',
  disableTransitionOnChange = false,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme | undefined>(() => {
    // Avoid hydration mismatch by initializing with undefined or default
    // Ideally, we should read from script if possible, but for SSR safety:
    return defaultTheme;
  });
  
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light' | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  // Apply theme to document
  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem(storageKey) as Theme | null;
    if (stored) {
      setThemeState(stored);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!mounted) return;

    const root = window.document.documentElement;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    
    let effectiveTheme = theme;
    if (theme === 'system' && enableSystem) {
      effectiveTheme = systemTheme;
    }

    const finalTheme = effectiveTheme === 'dark' ? 'dark' : 'light';
    setResolvedTheme(finalTheme);

    if (attribute === 'class') {
      root.classList.remove('light', 'dark');
      root.classList.add(finalTheme);
    } else {
      root.setAttribute(attribute, finalTheme);
    }
    
    // Save to local storage
    if (theme) {
      localStorage.setItem(storageKey, theme);
    }

  }, [theme, attribute, enableSystem, mounted, storageKey]);

  // Handle system change
  useEffect(() => {
    if (!enableSystem) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e: MediaQueryListEvent) => {
      if (theme === 'system') {
        const newSystemTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newSystemTheme);
        if (attribute === 'class') {
            const root = window.document.documentElement;
            root.classList.remove('light', 'dark');
            root.classList.add(newSystemTheme);
        }
      }
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme, enableSystem, attribute]);

  const value = {
    theme,
    setTheme: (t: Theme) => {
        setThemeState(t);
        localStorage.setItem(storageKey, t);
    },
    resolvedTheme,
    themes: ['light', 'dark', 'system'] as Theme[],
    systemTheme: (mounted && enableSystem) ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as 'dark' | 'light' : undefined
  };

  return (
    <ThemeContext.Provider value={value}>
        {/* Simple script to avoid FOUC - strictly speaking this should be injected in head */}
        {/* <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              try {
                var storageKey = '${storageKey}';
                var defaultTheme = '${defaultTheme}';
                var localTheme = localStorage.getItem(storageKey);
                var theme = localTheme || defaultTheme;
                var systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                if (theme === 'system') theme = systemTheme;
                document.documentElement.classList.add(theme);
                document.documentElement.style.colorScheme = theme;
              } catch (e) {}
            })()`
          }}
        /> */}
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
