import React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';

export interface HydrateOptions {
  onRecoverableError?: (error: unknown, errorInfo?: any) => void;
}

export function hydrate(
  App: React.ComponentType<any>,
  options: HydrateOptions = {}
) {
  const root = document.getElementById('root');
  
  if (!root) {
    throw new Error('[Satset] Root element #root not found');
  }

  try {
    // Hydrate if server-rendered content exists
    if (root.innerHTML.trim()) {
      hydrateRoot(
        root, 
        React.createElement(App),
        {
          onRecoverableError: options.onRecoverableError || ((error) => {
            console.error('[Satset] Hydration error:', error);
          }),
        }
      );
    } else {
      // Client-side render if no SSR content
      const clientRoot = createRoot(root);
      clientRoot.render(React.createElement(App));
    }
  } catch (error) {
    console.error('[Satset] Failed to hydrate:', error);
    // Fallback to client-side render
    const clientRoot = createRoot(root);
    clientRoot.render(React.createElement(App));
  }
}

// Progressive hydration (for large apps)
export function hydrateProgressively(
  App: React.ComponentType<any>,
  options: HydrateOptions = {}
) {
  // Use requestIdleCallback for non-critical hydration
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      hydrate(App, options);
    });
  } else {
    // Fallback to setTimeout
    setTimeout(() => {
      hydrate(App, options);
    }, 0);
  }
}

// Selective hydration (hydrate specific components)
export function hydrateComponent(
  Component: React.ComponentType<any>,
  elementId: string,
  props: any = {}
) {
  const element = document.getElementById(elementId);
  
  if (!element) {
    console.warn(`[Satset] Element #${elementId} not found for hydration`);
    return;
  }

  try {
    if (element.innerHTML.trim()) {
      hydrateRoot(element, React.createElement(Component, props));
    } else {
      const root = createRoot(element);
      root.render(React.createElement(Component, props));
    }
  } catch (error) {
    console.error(`[Satset] Failed to hydrate component at #${elementId}:`, error);
  }
}