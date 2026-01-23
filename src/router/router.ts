"use client";
import React from 'react';

export interface RouterContext {
  pathname: string;
  query: Record<string, string>;
  params: Record<string, string>;
  push: (path: string) => void;
  replace: (path: string) => void;
  back: () => void;
  forward: () => void;
}

const RouterContextObj = React.createContext<RouterContext | null>(null);

// Router provider removed: hooks are self-contained now

function stripLocaleFromPath(path: string): string {
  if (!path) return '/';
  const raw = path.split('?')[0].split('#')[0];
  const segments = raw.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  const first = segments[0];
  const localePattern = /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/;
  if (localePattern.test(first)) {
    const rest = segments.slice(1);
    return rest.length ? `/${rest.join('/')}` : '/';
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

// Internal parse params helper reused by the hook
function parseParamsFromPath(path: string): Record<string, string> {
  const urlParams = new URLSearchParams(window.location.search);
  const queryParams: Record<string, string> = {};
  urlParams.forEach((value, key) => {
    queryParams[key] = value;
  });

  const routePaths: string[] | undefined = (window as any).__SATSET_ROUTES__;
  if (!Array.isArray(routePaths)) return queryParams;

  const pathSegments = path.split('/').filter(Boolean);

  for (const routePath of routePaths) {
    const routeSegments = routePath.split('/').filter(Boolean);

    // catch-all
    if (routePath.includes('*')) {
      const catchIndex = routeSegments.findIndex(s => s.startsWith('*'));
      const paramName = routeSegments[catchIndex].slice(1);
      const params: Record<string, string> = {};
      params[paramName] = pathSegments.slice(catchIndex).join('/');
      return { ...queryParams, ...params };
    }

    if (routeSegments.length !== pathSegments.length) continue;

    let matched = true;
    const params: Record<string, string> = {};

    for (let i = 0; i < routeSegments.length; i++) {
      const rs = routeSegments[i];
      const ps = pathSegments[i];

      if (rs.startsWith(':')) {
        params[rs.slice(1)] = ps;
      } else if (rs !== ps) {
        matched = false;
        break;
      }
    }

    if (matched) return { ...queryParams, ...params };
  }

  return queryParams;
}

export function useRouter(): RouterContext {
  // SSR-safe initial values
  const isClient = typeof window !== 'undefined';
  const [pathname, setPathname] = React.useState<string>(
    isClient ? stripLocaleFromPath(window.location.pathname) : '/'
  );
  const [params, setParams] = React.useState<Record<string, string>>(() =>
    isClient ? parseParamsFromPath(stripLocaleFromPath(window.location.pathname)) : {}
  );

  React.useEffect(() => {
    if (!isClient) return;

    const handlePopState = () => {
      const normalized = stripLocaleFromPath(window.location.pathname);
      setPathname(normalized);
      setParams(parseParamsFromPath(normalized));
    };

    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isClient]);

  const push = React.useCallback((path: string) => {
    if (!isClient) return;
    const target = path || '/';
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target === current) {
      return;
    }
    window.location.assign(target);
  }, [isClient]);

  const replace = React.useCallback((path: string) => {
    if (!isClient) return;
    const target = path || '/';
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target === current) {
      return;
    }
    window.location.replace(target);
  }, [isClient]);

  const back = React.useCallback(() => {
    if (!isClient) return;
    window.history.back();
  }, [isClient]);

  const forward = React.useCallback(() => {
    if (!isClient) return;
    window.history.forward();
  }, [isClient]);

  const query = React.useMemo(() => {
    if (!isClient) return {};
    const urlParams = new URLSearchParams(window.location.search);
    const queryObj: Record<string, string> = {};
    urlParams.forEach((value, key) => {
      queryObj[key] = value;
    });
    return queryObj;
  }, [pathname, isClient]);

  return {
    pathname,
    query,
    params,
    push,
    replace,
    back,
    forward,
  };
}

export function useParams(): Record<string, string> {
  const router = useRouter();
  return router.params;
}

export function useSearchParams(): URLSearchParams {
  const router = useRouter();
  return new URLSearchParams(window.location.search);
}

export function usePathname(): string {
  const router = useRouter();
  return router.pathname;
}

export function useNavigate(): (to: string, opts?: { replace?: boolean }) => void {
  const { push, replace } = useRouter();
  return (to: string, opts: { replace?: boolean } = {}) => {
    if (opts.replace) return replace(to);
    return push(to);
  };
}
