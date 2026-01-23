export interface Route {
  path: string;
  component: string;
  exact?: boolean;
}

export interface RouterContext {
  pathname: string;
  query: Record<string, string>;
  push: (path: string) => void;
}