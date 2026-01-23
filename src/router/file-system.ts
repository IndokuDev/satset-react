import fs from 'fs';
import path from 'path';

export interface Route {
  path: string;
  component: string;
  exact?: boolean;
  dynamic?: boolean;
  params?: string[];
  // For catch-all routes, indicates whether the catch-all is optional ([[...param]])
  catchAllOptional?: boolean;
}

export interface RouteTree {
  routes: Route[];
  apiRoutes: Route[];
}

export function getRoutes(appDir: string): RouteTree {
  const routes: Route[] = [];
  const apiRoutes: Route[] = [];

  // Debug: log which folders exist
  const appPath = path.join(appDir, 'src', 'app');
  const pagesPath = path.join(appDir, 'src', 'pages');
  const srcPath = path.join(appDir, 'src');

  console.debug('[file-system] checking paths:', { appPathExists: fs.existsSync(appPath), pagesPathExists: fs.existsSync(pagesPath), srcPathExists: fs.existsSync(srcPath) });

  // Check for app router (src/app)
  if (fs.existsSync(appPath)) {
    console.debug('[file-system] scanning appPath', appPath);
    scanDirectory(appPath, '', routes, apiRoutes, 'app');
  }

  // Check for pages router (src/pages)
  if (fs.existsSync(pagesPath)) {
    console.debug('[file-system] scanning pagesPath', pagesPath);
    scanDirectory(pagesPath, '', routes, apiRoutes, 'pages');
  }

  // Fallback: support flat `src/` layout (no `app` or `pages` folders),
  // or when `src/app` or `src/pages` exists but contains no page routes.
  // Note: we only require there be no discovered page routes — api routes should not prevent
  // scanning the top-level `src` for pages (e.g., projects that colocate APIs and pages).
  if (fs.existsSync(srcPath) && routes.length === 0) {
    console.debug('[file-system] fallback scanning srcPath', srcPath);
    // Treat top-level src like a pages router for compatibility with simple projects
    scanDirectory(srcPath, '', routes, apiRoutes, 'pages');
  }

  console.debug('[file-system] found routes', routes.map(r => r.path), 'apiRoutes', apiRoutes.map(r => r.path));

  // Persist a small debug file so CI or environments with silent consoles can inspect the discovery
  try {
    const debugDir = path.join(appDir, '.satset');
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    fs.writeFileSync(path.join(debugDir, 'routes-debug.json'), JSON.stringify({
      appPath: appPath,
      pagesPath: pagesPath,
      srcPath: srcPath,
      appPathExists: fs.existsSync(appPath),
      pagesPathExists: fs.existsSync(pagesPath),
      srcPathExists: fs.existsSync(srcPath),
      routes: routes.map(r => ({ path: r.path, component: r.component })),
      apiRoutes: apiRoutes.map(r => ({ path: r.path, component: r.component }))
    }, null, 2));
  } catch (e) {
    // ignore write errors
  }

  return { routes, apiRoutes };
}

function scanDirectory(
  dir: string,
  prefix: string,
  routes: Route[],
  apiRoutes: Route[],
  type: 'app' | 'pages'
) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip utility folders that are not pages
      if (file === 'lib' || file === 'styles' || file === 'assets' || file === 'types') {
        // Also skip TypeScript declaration files under `src/types` that should never be pages
        continue;
      }
      // Special handling for api routes
      if (file === 'api') {
        scanApiDirectory(fullPath, '/api', apiRoutes);
        continue;
      }

      // Skip route groups (folders with parentheses)
      if (file.startsWith('(') && file.endsWith(')')) {
        scanDirectory(fullPath, prefix, routes, apiRoutes, type);
        continue;
      }

      // Handle optional catch-all routes [[...param]]
      if (file.startsWith('[[...') && file.endsWith(']]')) {
        const paramName = file.slice(5, -2);
        // We include a small marker (? after the *) in the prefix so that when
        // a page file is found we can mark the resulting route as optional.
        const newPrefix = prefix + '/*?' + paramName;
        scanDirectory(fullPath, newPrefix, routes, apiRoutes, type);
        continue;
      }

      // Handle catch-all routes [...param]
      if (file.startsWith('[...') && file.endsWith(']')) {
        const paramName = file.slice(4, -1);
        const newPrefix = prefix + '/*' + paramName;
        scanDirectory(fullPath, newPrefix, routes, apiRoutes, type);
        continue;
      }

      // Handle dynamic routes [param]
      if (file.startsWith('[') && file.endsWith(']')) {
        const paramName = file.slice(1, -1);
        const newPrefix = prefix + '/:' + paramName;
        scanDirectory(fullPath, newPrefix, routes, apiRoutes, type);
        continue;
      }

      // Regular folder
      const newPrefix = prefix + '/' + file;
      scanDirectory(fullPath, newPrefix, routes, apiRoutes, type);
    } else if (file === 'page.tsx' || file === 'page.jsx' || file === 'page.ts' || file === 'page.js') {
      // Main page file
      let routePath = prefix === '' ? '/' : prefix;
      // Detect our optional catch-all marker and normalize the path while capturing the flag
      let catchAllOptional = false;
      if (routePath.includes('/*?')) {
        routePath = routePath.replace('/*?', '/*');
        catchAllOptional = true;
      }
      const isDynamic = routePath.includes(':') || routePath.includes('*');
      const params = extractParams(routePath);
      
      routes.push({
        path: routePath,
        component: fullPath,
        exact: !isDynamic,
        dynamic: isDynamic,
        params,
        catchAllOptional,
      });
    } else if (
      file === 'not-found.tsx' || file === 'not-found.jsx' || file === 'not-found.ts' || file === 'not-found.js' ||
      file === '404.tsx' || file === '404.jsx' || file === '404.ts' || file === '404.js'
    ) {
      // Register Not Found / 404 pages
      // If at root, map to /not-found or /404. If nested, map to /path/not-found
      let routePath = prefix + '/' + file.split('.')[0];
      if (prefix === '') routePath = '/' + file.split('.')[0];
      
      // Normalize for dev server lookup which checks /404 and /not-found
      routes.push({
        path: routePath,
        component: fullPath,
        exact: true,
      });
    } else if (
      type === 'pages' &&
      (file.endsWith('.tsx') || file.endsWith('.jsx') || file.endsWith('.ts') || file.endsWith('.js')) &&
      !file.startsWith('_') &&
      !file.endsWith('.d.ts')
    ) {
      // Pages router style
      const fileName = file.replace(/\.(tsx|jsx|ts|js)$/, '');
      
      // Handle dynamic routes and catch-alls in pages router
      if (fileName.startsWith('[') && fileName.endsWith(']') && !fileName.startsWith('[...')) {
        const paramName = fileName.slice(1, -1);
        const routePath = prefix + '/:' + paramName;
        routes.push({
          path: routePath,
          component: fullPath,
          exact: false,
          dynamic: true,
          params: [paramName],
        });
      } else if (fileName.startsWith('[...') && fileName.endsWith(']')) {
        const paramName = fileName.slice(4, -1);
        const routePath = prefix + '/*' + paramName;
        routes.push({
          path: routePath,
          component: fullPath,
          exact: false,
          dynamic: true,
          params: [paramName],
        });
      } else if (fileName.startsWith('[[...') && fileName.endsWith(']]')) {
        const paramName = fileName.slice(5, -2);
        const routePath = prefix + '/*' + paramName;
        routes.push({
          path: routePath,
          component: fullPath,
          exact: false,
          dynamic: true,
          params: [paramName],
          catchAllOptional: true,
        });
      } else {
        const routePath = prefix + '/' + fileName;
        routes.push({
          path: routePath === '/index' ? '/' : routePath,
          component: fullPath,
          exact: true,
        });
      }
    }
  }
}

function scanApiDirectory(dir: string, prefix: string, apiRoutes: Route[]) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Handle optional catch-all API route directories [[...param]]
      if (file.startsWith('[[...') && file.endsWith(']]')) {
        const paramName = file.slice(5, -2);
        const newPrefix = prefix + '/*?' + paramName;
        scanApiDirectory(fullPath, newPrefix, apiRoutes);
        continue;
      }

      // Handle catch-all API route directories [...param]
      if (file.startsWith('[...') && file.endsWith(']')) {
        const paramName = file.slice(4, -1);
        const newPrefix = prefix + '/*' + paramName;
        scanApiDirectory(fullPath, newPrefix, apiRoutes);
        continue;
      }

      // Handle dynamic API route directories [param]
      if (file.startsWith('[') && file.endsWith(']')) {
        const paramName = file.slice(1, -1);
        const newPrefix = prefix + '/:' + paramName;
        scanApiDirectory(fullPath, newPrefix, apiRoutes);
        continue;
      }

      const newPrefix = prefix + '/' + file;
      scanApiDirectory(fullPath, newPrefix, apiRoutes);
    } else if ((file.endsWith('.ts') || file.endsWith('.js')) && !file.endsWith('.d.ts')) {
      const fileName = file.replace(/\.(ts|js)$/, '');

      let routePath: string;
      let params: string[] = [];
      
      // Next.js-style API route convention: `route.ts` uses the folder path as the URL
      // Example: src/api/auth/register/route.ts -> /api/auth/register
      if (fileName === 'route') {
        routePath = prefix || '/';
      } else if (fileName.startsWith('[') && fileName.endsWith(']') && !fileName.startsWith('[...')) {
        const paramName = fileName.slice(1, -1);
        routePath = prefix + '/:' + paramName;
        params = [paramName];
      } else if (fileName.startsWith('[...') && fileName.endsWith(']')) {
        const paramName = fileName.slice(4, -1);
        routePath = prefix + '/*' + paramName;
        params = [paramName];
      } else if (fileName.startsWith('[[...') && fileName.endsWith(']]')) {
        const paramName = fileName.slice(5, -2);
        routePath = prefix + '/*' + paramName;
        params = [paramName];
      } else {
        routePath = prefix + '/' + fileName;
      }

      const isDynamic = routePath.includes(':') || routePath.includes('*');
      if (!params.length && isDynamic) {
        params = extractParams(routePath);
      }

      apiRoutes.push({
        path: routePath,
        component: fullPath,
        dynamic: isDynamic,
        params,
      });
    }
  }
}

function extractParams(routePath: string): string[] {
  const params: string[] = [];
  const segments = routePath.split('/');

  for (const segment of segments) {
    if (segment.startsWith(':')) {
      params.push(segment.slice(1));
    } else if (segment.startsWith('*')) {
      params.push(segment.slice(1));
    }
  }

  return params;
}

export function matchRoute(pathname: string, routes: Route[]): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.dynamic) {
      const match = matchDynamicRoute(pathname, route.path, !!route.catchAllOptional);
      if (match) {
        return { route, params: match };
      }
    } else {
      if (route.exact) {
        if (pathname === route.path) {
          return { route, params: {} };
        }
      } else {
        if (pathname.startsWith(route.path)) {
          return { route, params: {} };
        }
      }
    }
  }

  return null;
}

function matchDynamicRoute(pathname: string, routePath: string, catchAllOptional = false): Record<string, string> | null {
  const pathSegments = pathname.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);

  // Handle catch-all routes
  if (routePath.includes('*')) {
    const params: Record<string, string> = {};
    const catchAllIndex = routeSegments.findIndex(s => s.startsWith('*'));

    // Verify that static prefix segments match the incoming path
    for (let i = 0; i < catchAllIndex; i++) {
      if (pathSegments[i] !== routeSegments[i]) {
        return null;
      }
    }

    // Normalize parameter name (support '*?name' marker from scan)
    let paramName = routeSegments[catchAllIndex].slice(1);
    if (paramName.startsWith('?')) paramName = paramName.slice(1);

    // If path has fewer segments than the catch-all index, allow match for optional catch-all
    if (pathSegments.length <= catchAllIndex && catchAllOptional) {
      params[paramName] = '';
      return params;
    }

    params[paramName] = pathSegments.slice(catchAllIndex).join('/');
    return params;
  }

  // Must have same number of segments
  if (pathSegments.length !== routeSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i++) {
    const routeSegment = routeSegments[i];
    const pathSegment = pathSegments[i];

    if (routeSegment.startsWith(':')) {
      // Dynamic segment
      const paramName = routeSegment.slice(1);
      params[paramName] = pathSegment;
    } else if (routeSegment !== pathSegment) {
      // Static segment doesn't match
      return null;
    }
  }

  return params;
}

export function generateRouteManifest(routes: Route[]): string {
  const manifest = routes.map(route => ({
    path: route.path,
    component: route.component,
    dynamic: route.dynamic,
    params: route.params,
  }));

  return JSON.stringify(manifest, null, 2);
}
