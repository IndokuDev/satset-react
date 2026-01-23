import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type Dictionaries = Record<string, Record<string, string>>;

interface I18nContextType {
  locale: string;
  setLocale: (locale: string) => void;
  t: (key: string, params?: Record<string, string>) => string;
  dictionaries: Dictionaries;
  dict: Record<string, string>;
}

const I18nContext = createContext<I18nContextType | null>(null);

interface I18nProviderProps {
  children: ReactNode;
  initialLocale?: string;
  dictionaries: Dictionaries;
}

export function I18nProvider({ children, initialLocale = 'en-US', dictionaries }: I18nProviderProps) {  
  const [locale, setLocale] = useState(initialLocale);

  // Sync locale with URL path on client side if not provided or changed
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Priority: 1. window.__SATSET_LOCALE__ (injected by server)
      //           2. URL path segment
      const injected = (window as any).__SATSET_LOCALE__;
      if (injected) {
        setLocale(injected);
        return;
      }

      const path = window.location.pathname;
      const segments = path.split('/').filter(Boolean);
      const first = segments[0];
      // Check if first segment matches a locale pattern (xx or xx-XX)
      if (first && /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(first)) {
        // Check if we have this locale in dictionaries (optional validation)
        // For now, trust the URL or fallback
        setLocale(first);
      }
    }
  }, []);

  const dict = dictionaries[locale] || dictionaries['en-US'] || dictionaries[Object.keys(dictionaries)[0]] || {};

  const t = (key: string, params?: Record<string, string>): string => {
    let text = dict[key] || key;
    
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{${k}}`, 'g'), v);
      });
    }
    
    return text;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, dictionaries, dict }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider. The framework should wrap your app automatically.');
  }
  return context;
}

export const useLang = useTranslation;
