export { useRouter, useParams, useSearchParams, usePathname, useNavigate } from './router';
// `getRoutes` is server-only (uses fs/path). Keep it out of client exports to avoid
// bundlers trying to resolve Node built-ins when consumers import from the package root.
export type { Route, RouterContext } from './types';