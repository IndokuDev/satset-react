import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  locale: string;
  dictionaries: any;
  params: Record<string, string>;
  pathname: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getLocale(): string {
  const store = requestContext.getStore();
  return store?.locale || 'en-US';
}

export function getDictionaries(): any {
  const store = requestContext.getStore();
  return store?.dictionaries || {};
}

export function getParams(): Record<string, string> {
  const store = requestContext.getStore();
  return store?.params || {};
}

export function getPathname(): string {
  const store = requestContext.getStore();
  return store?.pathname || '/';
}
