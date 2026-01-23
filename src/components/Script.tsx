import React from 'react';

interface ScriptProps {
  src: string;
  strategy?: 'beforeInteractive' | 'afterInteractive' | 'lazyOnload';
  onLoad?: () => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

export default function Script({
  src,
  strategy = 'afterInteractive',
  onLoad,
  onError,
  onReady,
}: ScriptProps) {
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    // Check if script already exists
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      setLoaded(true);
      onReady?.();
      return;
    }

    const loadScript = () => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;

      script.onload = () => {
        setLoaded(true);
        onLoad?.();
        onReady?.();
      };

      script.onerror = () => {
        const error = new Error(`Failed to load script: ${src}`);
        console.error('[Satset Script]', error);
        onError?.(error);
      };

      document.body.appendChild(script);
    };

    if (strategy === 'beforeInteractive') {
      // Load immediately
      loadScript();
    } else if (strategy === 'afterInteractive') {
      // Load after page is interactive
      if (document.readyState === 'complete') {
        loadScript();
      } else {
        window.addEventListener('load', loadScript);
        return () => window.removeEventListener('load', loadScript);
      }
    } else if (strategy === 'lazyOnload') {
      // Load when idle
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => loadScript());
      } else {
        setTimeout(loadScript, 1000);
      }
    }
  }, [src, strategy, onLoad, onError, onReady]);

  return null;
}