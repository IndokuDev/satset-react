import http from 'http';
import fs from 'fs';
import path from 'path';
import { getRoutes, matchRoute } from '../router/file-system';
import { startHMR } from './hmr';
import { loadEnv, getPublicEnvScript } from './env';
import { generateErrorOverlayHTML, extractCodeSnippet, ErrorInfo } from './error-overlay';
import { bundler } from './bundler';
import { SatsetResponse, buildSatsetRequest, sendSatsetResponse, setCurrentRequestCookies } from './response';
import { requestContext } from './storage';
import { I18nProvider } from '../core/translation';
import util from 'util';
import type { ServerConfig } from './types';
import { tui } from './tui';

let buildCache = new Map<string, string>();

function formatTime(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getDictionaries(root: string): Record<string, Record<string, string>> {
  const langDir = path.join(root, 'src', 'lang');
  const dictionaries: Record<string, Record<string, string>> = {};

  if (fs.existsSync(langDir)) {
    try {
      const files = fs.readdirSync(langDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const locale = path.basename(file, '.json');
          try {
            const content = fs.readFileSync(path.join(langDir, file), 'utf-8');
            dictionaries[locale] = JSON.parse(content);
          } catch (e) {
            console.warn(`[i18n] Failed to load dictionary for ${locale}:`, e);
          }
        }
      }
    } catch (e) {
      console.warn('[i18n] Failed to read lang directory:', e);
    }
  }
  return dictionaries;
}

function parseRequestCookies(req: http.IncomingMessage): Record<string, string> | null {
  const header = req.headers['cookie'];
  if (typeof header !== 'string' || !header.length) return null;
  const store: Record<string, string> = {};
  const parts = header.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const name = trimmed.slice(0, eqIndex).trim();
    if (!name) continue;
    const value = trimmed.slice(eqIndex + 1).trim();
    try {
      store[name] = decodeURIComponent(value);
    } catch {
      store[name] = value;
    }
  }
  return store;
}

function isClientOnlyPage(componentPath: string): boolean {
  try {
    const content = fs.readFileSync(componentPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^['"]use client['"]\s*;?$/.test(line)) {
        return true;
      }
      break;
    }
  } catch (e) {
  }
  return false;
}

export async function startDevServer(config: ServerConfig = {}) {
  // Initialize TUI first
  tui.start();

  // Override console for TUI
  const originalLog = console.log;
  console.log = (...args: any[]) => tui.log(util.format(...args), 'info');
  console.warn = (...args: any[]) => tui.log(util.format(...args), 'warn');
  console.error = (...args: any[]) => tui.log(util.format(...args), 'error');
  console.info = (...args: any[]) => tui.log(util.format(...args), 'info');
  console.debug = (...args: any[]) => tui.log(util.format(...args), 'info'); // Treat debug as info for TUI

   const {
    port = 3000,
    host = 'localhost',
    root = process.cwd(),
    publicDir = 'public',
    favicon,
  } = config;

  tui.setPort(port);

  // Clean previous dev artifacts
  const satsetDir = path.join(root, '.satset');
  if (fs.existsSync(satsetDir)) {
    try {
      fs.rmSync(satsetDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  // Favicon link - set during startup
  let faviconHref: string | null = null;

  // Load environment variables
  const env = loadEnv(root, 'development');
  const startTime = Date.now();

  // Scan routes (mutable so HMR can refresh when files are added/removed)
  let { routes, apiRoutes } = getRoutes(root);

  // Generate sitemap and robots into public/ if not present
  let assetsGenerated = false;
  try {
    const { generateAndSaveSitemap } = await import('../assets/sitemap.js');
    const { generateAndSaveRobots } = await import('../assets/robots.js');
    await generateAndSaveSitemap(root, routes);
    await generateAndSaveRobots(root);
    assetsGenerated = true;
  } catch (e) {
  }

  // Ensure favicon if configured or generate default if missing
  async function ensureFavicon(rootDir: string, publicDirName: string, faviconSetting?: string) {
    const publicPath = path.join(rootDir, publicDirName);
    try { if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true }); } catch (e) {}

    // If a setting is provided, handle several types
    if (faviconSetting) {
      // github:username -> use generateFavicon helper
      if (typeof faviconSetting === 'string' && faviconSetting.startsWith('github:')) {
        const username = faviconSetting.split(':', 2)[1];
        try {
          const { generateFavicon } = await import('../assets/favicon.js');
          await generateFavicon(rootDir, username);
          faviconHref = '/favicon.png';
          return;
        } catch (e) {
          console.warn('Could not generate favicon from github username:', e);
        }
      }

      // URL -> download into public
      if (/^https?:\/\//i.test(faviconSetting)) {
        try {
          const url = faviconSetting;
          const ext = path.extname(new URL(url).pathname) || '.png';
          const destName = ext === '.ico' ? 'favicon.ico' : 'favicon.png';
          const destPath = path.join(publicPath, destName);
          await downloadToFile(url, destPath);
          faviconHref = `/${destName}`;
          return;
        } catch (e) {
          console.warn('Failed to download favicon from URL:', e);
        }
      }

      // Local path relative to project
      try {
        const srcPath = path.isAbsolute(faviconSetting) ? faviconSetting : path.join(rootDir, faviconSetting);
        if (fs.existsSync(srcPath)) {
          const ext = path.extname(srcPath) || '.png';
          const destName = ext === '.ico' ? 'favicon.ico' : 'favicon.png';
          const destPath = path.join(publicPath, destName);
          fs.copyFileSync(srcPath, destPath);
          faviconHref = `/${destName}`;
          return;
        }
      } catch (e) {
        console.warn('Failed to use local favicon path:', e);
      }
    }

    // If still no favicon, try to generate a default favicon.png if it doesn't exist
    const pngPath = path.join(publicPath, 'favicon.png');
    const icoPath = path.join(publicPath, 'favicon.ico');
    if (fs.existsSync(pngPath) || fs.existsSync(icoPath)) {
      faviconHref = fs.existsSync(icoPath) ? '/favicon.ico' : '/favicon.png';
      return;
    }

    try {
      const { generateFavicon } = await import('../assets/favicon.js');
      await generateFavicon(rootDir);
      faviconHref = '/favicon.png';
    } catch (e) {
      // ignore - favicon generation optional
    }
  }

  function downloadToFile(url: string, dest: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? require('https') : require('http');
      const file = fs.createWriteStream(dest);
      proto.get(url, (resp: any) => {
        if (resp.statusCode !== 200) return reject(new Error('Failed to download'));
        resp.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (err: any) => {
        try { fs.unlinkSync(dest); } catch (e) {}
        reject(err);
      });
    });
  }

  // Run now
  await ensureFavicon(root, publicDir, favicon);

  // Setup build output directory
  const tempDir = path.join(satsetDir, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Initial build
  await buildClientBundle(root, tempDir, routes);

  // Load dictionaries
  const dictionaries = getDictionaries(root);

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    
    // Parse cookies early for redirection
    const cookieStore = parseRequestCookies(req);
    setCurrentRequestCookies(cookieStore);

    const rawPath = url.split('?')[0].split('#')[0] || '/';

    // Helper to get base URL
    const getBaseUrl = () => {
       if (process.env.SATSET_PUBLIC_SITE_URL) return process.env.SATSET_PUBLIC_SITE_URL;
       const host = req.headers.host || 'localhost';
       const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
       return `${proto}://${host}`;
    };

    // Sitemap.xml Handler
    if (rawPath === '/sitemap.xml') {
        try {
            const sitemapFiles = ['sitemap.ts', 'sitemap.js', 'sitemap.tsx'];
            let sitemapFile = null;
            for (const f of sitemapFiles) {
                const p = path.join(root, 'src', f);
                if (fs.existsSync(p)) {
                    sitemapFile = p;
                    break;
                }
            }

            if (sitemapFile) {
                 const outFile = path.join(tempDir, 'sitemap.server.js');
                 await bundler.bundleServer({ entryPoint: sitemapFile, outfile: outFile, root });
                 try { delete require.cache[require.resolve(outFile)]; } catch (e) {}
                 const mod = require(outFile);
                 const fn = mod.default;

                 if (typeof fn === 'function') {
                    const data = await fn();
                    const { generateSitemapXml } = await import('../assets/sitemap.js');
                    const xml = generateSitemapXml(data);
                    res.writeHead(200, { 'Content-Type': 'application/xml' });
                    res.end(xml);
                    return;
                 }
            }

            // Fallback: Generate from routes on-the-fly
             const { generateSitemap } = await import('../assets/sitemap.js');
             const xml = generateSitemap({ baseUrl: getBaseUrl(), routes });
             res.writeHead(200, { 'Content-Type': 'application/xml' });
             res.end(xml);
             return;
        } catch (e) {
            console.error('Error generating sitemap:', e);
            res.writeHead(500);
            res.end('Error generating sitemap');
            return;
        }
    }

    // Robots.txt Handler
    if (rawPath === '/robots.txt') {
        try {
            const robotsFiles = ['robots.ts', 'robots.js'];
            let robotsFile = null;
            for (const f of robotsFiles) {
                const p = path.join(root, 'src', f);
                if (fs.existsSync(p)) {
                    robotsFile = p;
                    break;
                }
            }
            
            if (robotsFile) {
                 const outFile = path.join(tempDir, 'robots.server.js');
                 await bundler.bundleServer({ entryPoint: robotsFile, outfile: outFile, root });
                 try { delete require.cache[require.resolve(outFile)]; } catch (e) {}
                 const mod = require(outFile);
                 const fn = mod.default;

                 if (typeof fn === 'function') {
                    const data = await fn();
                    const { generateRobotsTxtFromData } = await import('../assets/robots.js');
                    const txt = generateRobotsTxtFromData(data);
                    res.writeHead(200, { 'Content-Type': 'text/plain' });
                    res.end(txt);
                    return;
                 }
            }
            
             // Fallback
             const { generateRobotsTxt } = await import('../assets/robots.js');
             const txt = generateRobotsTxt(); 
             res.writeHead(200, { 'Content-Type': 'text/plain' });
             res.end(txt);
             return;
        } catch(e) {
            console.error('Error generating robots.txt:', e);
            res.writeHead(500);
            res.end('Error generating robots.txt');
            return;
        }
    }
    
    // Virtual Routing / Locale Detection
    let locale = 'en-US';
    let effectivePath = rawPath;
    
    const segments = rawPath.split('/').filter(Boolean);
    const firstSegment = segments[0];
    
    // 1. Detect from URL (Virtual Path)
    if (firstSegment && /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(firstSegment)) {
      locale = firstSegment;
      effectivePath = stripLocaleFromPath(rawPath);
    } else {
      // 2. Detect from Cookie / Header
      if (cookieStore && cookieStore['SATSET_LANG']) {
        locale = cookieStore['SATSET_LANG'];
      } else if (req.headers['accept-language']) {
        const accept = req.headers['accept-language'].split(',')[0].trim();
        const match = accept.match(/^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?/);
        if (match) locale = match[0];
      }
    }

    // Serve bundled JS files
    if (url.startsWith('/_satset/')) {
      // Remove query parameters from the URL before resolving file path
      const cleanUrl = url.split('?')[0];
      const filePath = path.join(tempDir, cleanUrl.replace('/_satset/', ''));
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const contentType = getContentType(ext);
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Serve static files from public/
    if (url.startsWith('/public/') || url.startsWith('/assets/')) {
      const filePath = path.join(root, publicDir, url.replace(/^\/(public|assets)\//, ''));
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const contentType = getContentType(ext);
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Serve direct public files at root URLs (e.g., /image.png -> public/image.png)
    // This mirrors Vite's behavior where static files in `public/` are available at '/{file}'
    try {
      const parsed = path.parse(rawPath);
      if (parsed.ext) {
        const publicFilePath = path.join(root, publicDir, rawPath.replace(/^\/+/, ''));
        if (fs.existsSync(publicFilePath)) {
          const contentType = getContentType(parsed.ext.toLowerCase());
          res.writeHead(200, { 'Content-Type': contentType });
          fs.createReadStream(publicFilePath).pipe(res);
          return;
        }
      }
    } catch (e) {
      // ignore file serving errors
    }

    // Handle error reporting endpoint
    if (url === '/__satset_error' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const errorInfo: ErrorInfo = JSON.parse(body);
          console.error('🔴 Runtime Error:', errorInfo.message);
          
          if (errorInfo.file && errorInfo.line) {
            errorInfo.code = extractCodeSnippet(errorInfo.file, errorInfo.line);
          }

          const overlayHTML = generateErrorOverlayHTML(errorInfo);
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(overlayHTML);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Bad Request');
        }
      });
      return;
    }

    const middlewareHandled = await runMiddleware(root, tempDir, req, res, effectivePath);
    if (middlewareHandled) {
      return;
    }

    // Simple Server Actions endpoint (POST JSON: { name: 'actionName', data: { ... } })
    if (url === '/_satset/action' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const actionName = payload?.name;
          const data = payload?.data || {};

          if (!actionName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing action name' }));
            return;
          }

          // try to find actions file
          const candidates = ['src/app/actions.ts', 'src/app/actions.js', 'src/app/actions.tsx'];
          let actionsPath: string | null = null;
          for (const c of candidates) {
            const p = path.join(root, c.replace(/^src\//, 'src/'));
            if (fs.existsSync(p)) { actionsPath = p; break; }
          }

          if (!actionsPath) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No actions file found' }));
            return;
          }

          const baseName = path.basename(actionsPath).replace(/\.[^.]+$/, '');
          const compiled = path.join(tempDir, baseName + '.actions.server.js');

          try {
            try {
              await bundler.bundleServer({ entryPoint: actionsPath, outfile: compiled, minify: false, root, sourcemap: true });
            } catch (err: any) {
              const msg = String(err && err.message ? err.message : err);
              if (/ENOSPC|not enough space|There is not enough space/i.test(msg)) {
                console.warn('Low disk space detected while bundling actions. Attempting to clear temp and retry without sourcemaps.');
                try {
                  if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                  }
                  fs.mkdirSync(tempDir, { recursive: true });
                } catch (cleanupErr) {
                  console.error('Failed to cleanup temp dir:', cleanupErr);
                }

                await bundler.bundleServer({ entryPoint: actionsPath, outfile: compiled, minify: false, root, sourcemap: false });
              } else {
                throw err;
              }
            }
            try { delete require.cache[require.resolve(compiled)]; } catch (e) {}
            const ActionsModule = require(compiled);
            const fn = ActionsModule && (ActionsModule[actionName] || (ActionsModule.default && ActionsModule.default[actionName]));

            if (!fn || typeof fn !== 'function') {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: `Action not found: ${actionName}` }));
              return;
            }

            // basic FormData-like helper
            const formLike = { _map: data, get(k: string) { return this._map[k]; }, entries() { return Object.entries(this._map); } } as any;

            try { (global as any).__SATSET_ACTION_RES__ = res; } catch (e) {}

            let result: any;
            try {
              result = await fn(formLike);
            } finally {
              try { delete (global as any).__SATSET_ACTION_RES__; } catch (e) {}
            }

            // SatsetResponse handling
            const respMod = require('./response');
            if (result instanceof respMod.SatsetResponse) {
              respMod.sendSatsetResponse(res, result);
              return;
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result }));
            return;
          } catch (e: any) {
            const errInfo: ErrorInfo = { message: (e && e.message) || String(e), stack: e && e.stack, file: actionsPath };
            const overlayHTML = generateErrorOverlayHTML(errInfo);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(overlayHTML);
            return;
          }
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid request' }));
        }
      });
      return;
    }

    const apiMatch = matchRoute(effectivePath, apiRoutes);
    if (apiMatch) {
      await handleApiRoute(apiMatch.route, req, res, root, tempDir, apiMatch.params, locale);
      return;
    }

    if (effectivePath.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 404, message: 'API route not found' }, path: url }));
      return;
    }

    const matched = matchRoute(effectivePath, routes);
    if (matched) {
      await handlePageRoute(matched.route, req, res, root, tempDir, matched.params, routes, publicDir, locale);
      return;
    }

    const notFoundRoute =
      routes.find(r => r.path === '/404') ||
      routes.find(r => r.path === '/not-found');

    if (notFoundRoute) {
      await handlePageRoute(notFoundRoute, req, res, root, tempDir, {}, routes, publicDir, locale);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404 - Page Not Found</h1>');
  });

  // Start HMR with bundler integration
  const hmrServer = startHMR(server, root, async (changedFile) => {
    const rel = path.relative(root, changedFile);
    console.log(`🔄 [${formatTime()}] ${rel} updated`);
    // Re-scan routes so newly added/removed pages and API routes are picked up
    const scanned = getRoutes(root);
    routes = scanned.routes;
    apiRoutes = scanned.apiRoutes;
    tui.setRoutes(routes.map(r => r.path));
    console.log(`📁 Updated to ${routes.length} pages and ${apiRoutes.length} API routes`);
    // Regenerate sitemap/robots to reflect new routes
    try {
      const { generateAndSaveSitemap } = await import('../assets/sitemap.js');
      const { generateAndSaveRobots } = await import('../assets/robots.js');
      await generateAndSaveSitemap(root, routes);
      await generateAndSaveRobots(root);
    } catch (e) {
      // ignore if asset generators aren't available
    }
    await buildClientBundle(root, tempDir, routes);
  });

  const bindHost = host === true ? '0.0.0.0' : (host === false ? 'localhost' : host);

  server.listen(port, bindHost, () => {
    tui.setRoutes(routes.map(r => r.path));
    tui.setHMRStatus('Active');

    const readyIn = Date.now() - startTime;
    const displayHost = bindHost === '0.0.0.0' ? 'localhost' : bindHost;
    
    console.log(`Server ready in ${readyIn}ms`);
    console.log(`Listening on http://${displayHost}:${port}`);
    
    if (host === true) {
      try {
        const os = require('os');
        const nets = os.networkInterfaces();
        const addresses: string[] = [];
        for (const name of Object.keys(nets)) {
          for (const net of (nets as any)[name]) {
            if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
          }
        }
        // Use the first available network address for TUI
        if (addresses.length > 0) {
           tui.setNetworkUrl(`http://${addresses[0]}:${port}`);
        }
        for (const a of addresses) {
          console.log(`Network: http://${a}:${port}`);
        }
      } catch (e) {}
    }
    
    if (assetsGenerated) {
      console.log(`Assets generated: sitemap.xml, robots.txt`);
    }
  });

  return { server, hmrServer };
}

async function buildClientBundle(root: string, outdir: string, routes: any[]) {
  try {
    const importLines: string[] = [];
    const routeDefLines: string[] = [];

    let importIndex = 0;
    let clientPages = 0;
    let skippedPages = 0;
    for (const route of routes) {
        if (!fs.existsSync(route.component)) {
        // skip removed/missing components (can happen during HMR file moves)
        console.warn('Skipping missing component while building client bundle:', route.component);
        continue;
      }

      // Only include client components ("use client") in the client bundle
      let includeInClient = false;
      try {
        const content = fs.readFileSync(route.component, 'utf-8');
        if (content.includes("'use client'") || content.includes('"use client"')) {
          includeInClient = true;
        }
      } catch (e) {
        includeInClient = false;
      }

      if (!includeInClient) {
        skippedPages++;
        continue;
      }

      const relativePath = path.relative(root, route.component).replace(/\\/g, '/');
      // Use dynamic import for code splitting
      routeDefLines.push(`  { path: '${route.path}', component: React.lazy(() => import('../../${relativePath}')) },`);
      importIndex++;
      clientPages++;
    }

    const dictionaries = getDictionaries(root);

    const layoutRoute = routes.find(r => r.path === '/layout');
    let layoutImport = '';
    let appCreationBlock: string;
    if (layoutRoute && layoutRoute.component) {
      const layoutRelative = path.relative(root, layoutRoute.component).replace(/\\/g, '/');
      layoutImport = `import Layout from '../../${layoutRelative}';`;
      appCreationBlock = `
    const pageElement = React.createElement(React.Suspense, { fallback: null }, React.createElement(PageComponent, props));
    const withLayout = React.createElement(Layout, null, pageElement);
    const App = React.createElement(
      I18nProvider,
      {
        initialLocale,
        dictionaries: window.__SATSET_DICTIONARIES__
      },
      withLayout
    );`;
    } else {
      appCreationBlock = `
    const App = React.createElement(
      I18nProvider,
      {
        initialLocale,
        dictionaries: window.__SATSET_DICTIONARIES__
      },
      React.createElement(React.Suspense, { fallback: null }, React.createElement(PageComponent, props))
    );`;
    }

    const entryContent = `
import React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { I18nProvider } from 'satset-react';
${layoutImport}

// Import all page components
${importLines.join('\n')}
// Route definitions
const routeDefs = [
${routeDefLines.join('\n')}
];

function stripLocale(pathname) {
  if (!pathname) return '/';
  const raw = pathname.split('?')[0].split('#')[0];
  const segments = raw.split('/').filter(Boolean);
  if (!segments.length) return '/';
  const first = segments[0];
  const localePattern = /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/;
  if (localePattern.test(first)) {
    const rest = segments.slice(1);
    return rest.length ? '/' + rest.join('/') : '/';
  }
  return raw.startsWith('/') ? raw : '/' + raw;
}

function matchPath(pathname) {
  const normalized = stripLocale(pathname);
  const pathSegments = normalized.split('/').filter(Boolean);
  for (const r of routeDefs) {
    const routeSegments = r.path.split('/').filter(Boolean);

    // catch-all
    if (r.path.includes('*')) {
      const catchIndex = routeSegments.findIndex(s => s.startsWith('*'));
      const paramName = routeSegments[catchIndex].slice(1);
      const params = {};
      params[paramName] = pathSegments.slice(catchIndex).join('/');
      return { component: r.component, params };
    }

    if (routeSegments.length !== pathSegments.length) continue;

    let matched = true;
    const params = {};

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

    if (matched) {
      return { component: r.component, params };
    }
  }

  // fallback to root route
  return { component: routeDefs.find(r => r.path === '/')?.component, params: {} };
}

// Hydrate based on current path
const currentPath = stripLocale(window.location.pathname);
const match = matchPath(currentPath);
// expose routes and params to Router
window.__SATSET_ROUTES__ = routeDefs.map(r => r.path);
window.__SATSET_PARAMS__ = match.params || {};
window.__SATSET_DICTIONARIES__ = ${JSON.stringify(dictionaries)};

const PageComponent = match.component;

if (PageComponent) {
  const root = document.getElementById('root');
  if (root) {
    const props = match.params ? { params: match.params } : undefined;
    
    const initialLocale = window.__SATSET_LOCALE__ || 'en-US';

${appCreationBlock}

    if (root.hasChildNodes()) {
      hydrateRoot(root, App);
    } else {
      const rootInstance = createRoot(root);
      rootInstance.render(App);
    }
  }
}
    `;

    const entryPath = path.join(outdir, '_entry.tsx');
    fs.writeFileSync(entryPath, entryContent);

    // Ensure a global CSS exists in outdir
    const cssPath = path.join(outdir, 'globals.css');
    try {
      if (!fs.existsSync(cssPath)) {
        // Try to copy project-specific styles if present
        const projectCss = path.join(root, 'src', 'styles', 'global.css');
        if (fs.existsSync(projectCss)) {
          try {
            console.debug('[dev] copying project global css from', projectCss, 'to', cssPath);
            fs.copyFileSync(projectCss, cssPath);
            console.debug('[dev] copied global css');
          } catch (err) {
            console.warn('[dev] failed to copy project css:', err);
            fs.writeFileSync(cssPath, 'body{font-family:system-ui;}.container{max-width:900px;margin:0 auto;padding:24px}');
          }
        } else {
          fs.writeFileSync(cssPath, 'body{font-family:system-ui;}.container{max-width:900px;margin:0 auto;padding:24px}');
          console.debug('[dev] wrote default globals.css to', cssPath);
        }
      }
    } catch (err) {
      console.warn('[dev] error ensuring globals.css:', err);
    }

    await bundler.bundle({
      entryPoints: [entryPath],
      outdir,
      minify: false,
      sourcemap: true,
      watch: false,
      root,
    });

    console.log(`  📦 Bundle    Client ready (${skippedPages} pages skipped)`);
  } catch (error: any) {
    console.error(`❌ ERROR [${formatTime()}] Client bundle failed:`, error && error.message ? error.message : String(error));
  }
}

async function handleApiRoute(
  route: any,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  tempDir: string,
  params: Record<string, string> = {},
  locale: string = 'en-US'
) {
  const dictionaries = getDictionaries(root);
  return requestContext.run({ locale, dictionaries, params, pathname: req.url || '/' }, async () => {
    try {
      // Compile API module to CJS before requiring to support TS/ESM sources.
    // Cache the compiled file between requests and only re-bundle when the
    // source file is newer. Use a per-route file name derived from the
    // component's relative path to avoid collisions between different API
    // handlers that share the same base file name (e.g. multiple `route.ts`).
    const relComponentPath = path
      .relative(root, route.component)
      .replace(/\\/g, '/')
      .replace(/\.[^.]+$/, '');
    const safeComponentKey = relComponentPath.replace(/[^a-zA-Z0-9_-]/g, '_');
    const compiledApiPath = path.join(tempDir, safeComponentKey + '.api.server.js');
    console.log('[API Debug] route:', route.path, 'component:', route.component);
    console.log('[API Debug] safeKey:', safeComponentKey, 'compiledPath:', compiledApiPath);
    let ApiModule: any = null;

    async function safeBundleApi(entry: string, outfile: string) {
      try {
        await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: true });
      } catch (err: any) {
        const msg = String(err && err.message ? err.message : err);
        if (/ENOSPC|not enough space|There is not enough space/i.test(msg)) {
          try {
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
            fs.mkdirSync(tempDir, { recursive: true });
          } catch (cleanupErr) {
            console.error('Failed to cleanup temp dir:', cleanupErr);
          }

          await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: false });
          return;
        }
        throw err;
      }
    }

    try {
      let needsBundle = true;
      if (fs.existsSync(compiledApiPath)) {
        try {
          const srcStat = fs.statSync(route.component);
          const outStat = fs.statSync(compiledApiPath);
          if (outStat.mtimeMs >= srcStat.mtimeMs) {
            needsBundle = false;
          }
        } catch (e) {}
      }

      if (needsBundle) {
        await safeBundleApi(route.component, compiledApiPath);
      }

      try { delete require.cache[require.resolve(compiledApiPath)]; } catch (e) {}
      ApiModule = require(compiledApiPath);
    } catch (err: any) {
      console.error('API bundling failed for', route.component, err);
      const errMsg = String(err && err.message ? err.message : err);
      const message = /ENOSPC|not enough space|There is not enough space/i.test(errMsg)
        ? 'API bundling failed: not enough disk space. Free disk space or delete .satset/temp'
        : 'API bundling failed';
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 500, message }, file: route.component }));
      return;
    }

    function resolveHandler(mod: any) {
      if (!mod) return null;
      // default export function
      if (typeof mod === 'function') return { default: mod };
      if (mod && typeof mod === 'object') {
        if (typeof mod.default === 'function') return { default: mod.default };
        // method-named exports (GET, POST, etc.)
        const methods = ['GET','POST','PUT','PATCH','DELETE','OPTIONS'];
        const out: any = {};
        for (const m of methods) {
          if (typeof mod[m] === 'function') out[m] = mod[m];
        }
        if (Object.keys(out).length) return out;
      }
      return null;
    }

    const handlerObj = resolveHandler(ApiModule);
    const method = (req.method || 'GET').toUpperCase();

    async function callHandlerWithNodeStyle(fn: Function) {
      // If function declares at least two args, assume Node-style (req, res)
      if (fn.length >= 2) {
        // Inject locale into request object for Node-style handlers
        (req as any).locale = locale;
        (req as any).lang = locale;
        const maybe = await fn(req, res, params);
        // If the handler returns a SatsetResponse, send it
        if (SatsetResponse.isSatsetResponse(maybe)) {
          sendSatsetResponse(res, maybe);
        }
        // assume the handler handled the Node res
        return true;
      }
      return false;
    }

    async function callHandlerWithWebStyle(fn: Function) {
      // Build a lightweight Request-like object for route handlers
      const webReq = await buildSatsetRequest(req);
      // Inject locale into context
      const context = { params, locale, lang: locale };
      const result = await fn(webReq, context);

      if (SatsetResponse.isSatsetResponse(result)) {
        sendSatsetResponse(res, result);
        return true;
      }

      // If result is a native Response-like object with json/text, try to handle
      if (result && typeof result === 'object' && typeof (result as any).status === 'number' && ((result as any).headers || (result as any).json)) {
        // Try basic mapping
        const status = (result as any).status || 200;
        // Normalize headers: support Headers instance, array of tuples, or plain object
        let headers: Record<string,string> = {};
        const rawHeaders = (result as any).headers;
        if (rawHeaders) {
          if (typeof rawHeaders.get === 'function' && typeof rawHeaders.entries === 'function') {
            headers = Object.fromEntries(rawHeaders.entries());
          } else if (Array.isArray(rawHeaders)) {
            headers = Object.fromEntries(rawHeaders as [string,string][]);
          } else if (typeof rawHeaders === 'object') {
            headers = rawHeaders as Record<string,string>;
          }
        }
        let body = undefined;
        try {
          if (typeof (result as any).json === 'function') {
            body = await (result as any).json();
            res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
            res.end(JSON.stringify(body));
            return true;
          }
          if (typeof (result as any).text === 'function') {
            body = await (result as any).text();
            res.writeHead(status, headers);
            res.end(body);
            return true;
          }
        } catch (e) {
          // fallthrough
        }
      }

      // If result is an object, return as JSON
      if (result && typeof result === 'object') {
        const sat = SatsetResponse.json(result as any);
        sendSatsetResponse(res, sat);
        return true;
      }

      // If result is string or number, send as text
      if (result != null) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(String(result));
        return true;
      }

      // undefined -> assume handler will manage res; if not, leave to caller
      return false;
    }

    // Prefer method-named export for App-style handlers
    if (handlerObj && typeof handlerObj[method] === 'function') {
      const fn = handlerObj[method];

      // Try node-style first
      const nodeTook = await callHandlerWithNodeStyle(fn);
      if (nodeTook) return;

      // Fallback to Web-style
      const webTook = await callHandlerWithWebStyle(fn);
      if (webTook) return;

      // no response produced
      res.writeHead(204);
      res.end();
      return;
    }

    // Default export fallback
    if (handlerObj && typeof handlerObj.default === 'function') {
      const fn = handlerObj.default;

      const nodeTook = await callHandlerWithNodeStyle(fn);
      if (nodeTook) return;

      const webTook = await callHandlerWithWebStyle(fn);
      if (webTook) return;

      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 405, message: 'Method not allowed' } }));
  } catch (error: any) {
    const errorPayload = {
      code: 500,
      message: error && error.message ? error.message : 'Internal Server Error',
    };
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: errorPayload, file: route.component, stack: error && error.stack }));
  }
  });
}

async function handlePageRoute(
  route: any,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  tempDir: string,
  initialParams: Record<string, string> = {},
  allRoutes: any[] = [],
  publicDirName: string = 'public',
  locale: string = 'en-US'
) {
  const dictionaries = getDictionaries(root);
  return requestContext.run({ locale, dictionaries, params: initialParams, pathname: req.url || '/' }, async () => {
    try {
      const env = loadEnv(root, 'development');
    const envScript = getPublicEnvScript(env.publicVars);

    if (isClientOnlyPage(route.component)) {
      const routePaths = allRoutes.length ? allRoutes.map(r => r.path) : [];

      let metaHtml = '';
      let htmlLang = locale;
      let faviconLink = '';

      try {
        // dictionaries already loaded in context


        // Auto-inject hreflang tags for SEO
        try {
          const supportedLocales = Object.keys(dictionaries);
          if (supportedLocales.length > 0) {
            const host = req.headers.host || 'localhost';
            // Determine protocol (assume http for dev, but honor x-forwarded-proto if present)
            const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
            const origin = `${proto}://${host}`;
            
            const urlObj = new URL(req.url || '/', origin);
            const currentPath = urlObj.pathname;
            
            // Determine clean path (strip locale prefix if present in URL)
            let cleanPath = currentPath;
            if (currentPath === `/${locale}` || currentPath.startsWith(`/${locale}/`)) {
              cleanPath = currentPath.substring(locale.length + 1);
              if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;
            }
            
            supportedLocales.forEach(lang => {
              let href = origin;
              if (lang !== 'en-US') { // Assuming en-US is default/root
                href += `/${lang}`;
              }
              href += cleanPath === '/' ? '' : cleanPath;
              
              metaHtml += `<link rel="alternate" hreflang="${lang}" href="${href}" />\n`;
            });
            
            // Add x-default pointing to default language (en-US)
            const defaultHref = origin + (cleanPath === '/' ? '' : cleanPath);
            metaHtml += `<link rel="alternate" hreflang="x-default" href="${defaultHref}" />\n`;
          }
        } catch (e) {
          // ignore hreflang generation errors
        }

        try {
          const { renderMetaTags } = await import('../assets/metadata.js');

          const baseName = path.basename(route.component).replace(/\.[^.]+$/, '');
          const compiledMetaPath = path.join(tempDir, baseName + '.meta.server.js');

          try {
            await bundler.bundleServer({
              entryPoint: route.component,
              outfile: compiledMetaPath,
              minify: false,
              root,
              sourcemap: false,
            });
            try {
              delete require.cache[require.resolve(compiledMetaPath)];
            } catch (e) {
            }
            const PageModule = require(compiledMetaPath);

            let metaObj: any = null;
            if (PageModule && PageModule.metadata) {
              metaObj = PageModule.metadata;
            } else if (PageModule && typeof PageModule.getMetadata === 'function') {
              const t = (key: string, params?: Record<string, string>): string => {
                const dict = dictionaries[locale] || dictionaries['en-US'] || dictionaries[Object.keys(dictionaries)[0]] || {};
                let text = dict[key] || key;
                if (params) {
                  Object.entries(params).forEach(([k, v]) => {
                    text = text.replace(new RegExp(`{${k}}`, 'g'), v);
                  });
                }
                return text;
              };
              try {
                metaObj = await PageModule.getMetadata({ params: initialParams, locale, t });
              } catch (e) {
                metaObj = null;
              }
            }

            if (metaObj && typeof metaObj.lang === 'string' && metaObj.lang.trim()) {
              htmlLang = metaObj.lang.trim();
            }
            metaHtml = renderMetaTags(metaObj);
          } catch (e) {
          }
        } catch (e) {
        }

        try {
          let computedFavicon: string | null = null;
          const publicPath = path.join(root, publicDirName);
          if (fs.existsSync(path.join(publicPath, 'favicon.ico'))) computedFavicon = '/favicon.ico';
          else if (fs.existsSync(path.join(publicPath, 'favicon.png'))) computedFavicon = '/favicon.png';
          if (computedFavicon) {
            faviconLink = `<link rel="icon" href="${computedFavicon}" />`;
          }
        } catch (e) {
        }
      } catch (e) {
      }

      const initialParamsScript = `<script>
      window.__SATSET_ROUTES__ = ${JSON.stringify(routePaths)};
      window.__SATSET_PARAMS__ = ${JSON.stringify(initialParams)};
      window.__SATSET_DICTIONARIES__ = ${JSON.stringify(getDictionaries(root))};
      window.__SATSET_LOCALE__ = "${locale}";
    </script>`;

      const html = `
<!DOCTYPE html>
<html lang="${htmlLang}" suppressHydrationWarning>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaHtml}
    ${faviconLink}
    <link rel="stylesheet" href="/_satset/globals.css" />
  </head>
  <body>
    <div id="root"></div>
    <script>${envScript}</script>
    ${initialParamsScript}
    <script type="module" src="/_satset/_entry.js"></script>
    <script src="/__hmr"></script>
  </body>
</html>
      `;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    // Server-side render the component
    // Compile page module to a temporary server file so Node can require it (handles tsx/esm)
    const baseName = path.basename(route.component).replace(/\.[^.]+$/, '');
    const compiledServerPath = path.join(tempDir, baseName + '.server.js');
    let PageModule: any = null;

    // Helper: bundle server build with low-disk fallback
    async function safeBundleServer(entry: string, outfile: string) {
      try {
        await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: true });
      } catch (err: any) {
        const msg = String(err && err.message ? err.message : err);
        // detect low-disk / ENOSPC errors (esbuild reports "There is not enough space on the disk" in Windows)
        if (/ENOSPC|not enough space|There is not enough space/i.test(msg)) {
          console.warn('Low disk space detected while bundling. Attempting to clear temp and retry without sourcemaps.');
          try {
            // clear temp dir to free space
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
            fs.mkdirSync(tempDir, { recursive: true });
          } catch (cleanupErr) {
            console.error('Failed to cleanup temp dir:', cleanupErr);
          }

          try {
            await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: false });
            return;
          } catch (retryErr: any) {
            // still failed
            throw retryErr;
          }
        }

        // Not a disk-space issue, rethrow
        throw err;
      }
    }

    try {
      // Bundle the page for Node (CJS)
      await safeBundleServer(route.component, compiledServerPath);
      try {
        delete require.cache[require.resolve(compiledServerPath)];
      } catch (e) {
        // ignore
      }
      PageModule = require(compiledServerPath);
    } catch (err: any) {
      // If bundling fails, show an overlay with the bundling error and do NOT require the original TSX (which would crash)
      console.error('SSR bundling failed for', route.component, err);

      let message = 'SSR bundling failed';
      const errMsg = String(err && err.message ? err.message : err);
      if (/ENOSPC|not enough space|There is not enough space/i.test(errMsg)) {
        message = 'SSR bundling failed: not enough disk space. Try freeing disk space or deleting the .satset/temp folder.';
      }

      const errorInfo: ErrorInfo = {
        message,
        stack: err && err.stack ? err.stack : String(err),
        file: route.component,
      };

      const overlayHTML = generateErrorOverlayHTML(errorInfo);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(overlayHTML);
      return;
    }

    function resolveExportedComponent(mod: any) {
      if (!mod) return null;
      if (typeof mod === 'function') return mod;
      if (mod && typeof mod === 'object') {
        if (typeof mod.default === 'function') return mod.default;
        if (mod.default && typeof mod.default === 'object' && typeof mod.default.default === 'function') return mod.default.default;
        for (const key of Object.keys(mod)) {
          if (typeof mod[key] === 'function') return mod[key];
        }
      }
      return null;
    }

    const PageComponent = resolveExportedComponent(PageModule);
    console.log('SSR: used component from', compiledServerPath, 'PageModule keys:', Object.keys(PageModule || {}), 'Resolved component type:', typeof PageComponent);


    console.log('SSR: PageModule keys:', Object.keys(PageModule || {}), 'PageComponent type:', typeof PageComponent);

    // Simple SSR with optional global layout composition
    const React = require('react');
    const { renderToString } = require('react-dom/server');
    
    let pageHTML = '<div>Loading...</div>';

    async function renderComponentToHtml(Comp: any, props: any = {}) {
      if (!Comp || typeof Comp !== 'function') {
        throw new Error('Invalid component to render');
      }

      const isAsync = Comp.constructor && Comp.constructor.name === 'AsyncFunction';
      if (isAsync) {
        const maybeNode = Comp(props);
        const resolved = await Promise.resolve(maybeNode);
        return renderToString(resolved);
      }

      return renderToString(React.createElement(Comp, props));
    }

    let statusCode = 200;

    // Determine locale for SSR
    // locale is now passed as argument
    // const dictionaries = getDictionaries(root); // Already defined in outer scope and context

    try {
      if (!PageComponent || typeof PageComponent !== 'function') {
        console.error('SSR Error: resolved page component is not a function. PageModule:', util.inspect(PageModule, { depth: 2 }));

        const diagHtml = `<!doctype html><html><body><h1>500 - Component export error</h1><pre>${util.format('PageModule keys: %o\nResolved: %o', Object.keys(PageModule || {}), PageComponent)}</pre></body></html>`;
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(diagHtml);
        return;
      }

      // Recursive Layout Loading
      const layouts: any[] = [];
      try {
        const findLayoutFiles = (dir: string): string[] => {
          const results: string[] = [];
          let current = dir;
          const rootSrc = path.join(root, 'src');
          // Go up until we reach the root
          while (current.startsWith(root)) {
            const extensions = ['.tsx', '.jsx', '.ts', '.js'];
            for (const ext of extensions) {
              const layoutPath = path.join(current, `layout${ext}`);
              if (fs.existsSync(layoutPath)) {
                // Check if already added (to avoid duplicates if loop logic is flawed)
                if (!results.includes(layoutPath)) results.unshift(layoutPath);
                break;
              }
            }
            if (current === root) break;
            current = path.dirname(current);
          }
          return results;
        };

        const pageDir = path.dirname(route.component);
        const layoutFiles = findLayoutFiles(pageDir);
        
        for (const layoutFile of layoutFiles) {
           const layoutBase = path.basename(layoutFile).replace(/\.[^.]+$/, '');
           const crypto = require('crypto');
           const hash = crypto.createHash('md5').update(layoutFile).digest('hex').substring(0, 8);
           const layoutCompiled = path.join(tempDir, `${layoutBase}.${hash}.layout.server.js`);
           
           await bundler.bundleServer({ entryPoint: layoutFile, outfile: layoutCompiled, minify: false, root });
           try { delete require.cache[require.resolve(layoutCompiled)]; } catch (e) {}
           const LayoutModule = require(layoutCompiled);
           
           let LayoutComp = null;
           if (typeof LayoutModule === 'function') LayoutComp = LayoutModule;
           else if (LayoutModule && typeof LayoutModule === 'object') {
             if (typeof LayoutModule.default === 'function') LayoutComp = LayoutModule.default;
             else {
               for (const key of Object.keys(LayoutModule)) {
                 if (typeof LayoutModule[key] === 'function') { LayoutComp = LayoutModule[key]; break; }
               }
             }
           }
           if (LayoutComp) layouts.push(LayoutComp);
        }
      } catch (e: unknown) {
        console.warn('Could not load layout modules:', e);
      }

      const isPageAsync =
        PageComponent &&
        PageComponent.constructor &&
        PageComponent.constructor.name === 'AsyncFunction';

      let pageNode: any;
      if (isPageAsync) {
        const maybeNode = PageComponent({ params: initialParams, searchParams: {} });
        pageNode = await Promise.resolve(maybeNode);
      } else {
        pageNode = React.createElement(PageComponent, { params: initialParams, searchParams: {} });
      }

      let appElement = pageNode;
      // Wrap from inner to outer
      for (let i = layouts.length - 1; i >= 0; i--) {
        appElement = React.createElement(layouts[i], { params: initialParams, locale }, appElement);
      }

      const Wrapper = () =>
        React.createElement(
          I18nProvider,
          { initialLocale: locale, dictionaries },
          appElement
        );
      pageHTML = await renderComponentToHtml(Wrapper);
    } catch (err: any) {
      console.error('SSR Error:', err);

      if (err && (err as any).__SATSET_REDIRECT) {
        const info = (err as any).__SATSET_REDIRECT || {};
        const url = typeof info.url === 'string' && info.url.length ? info.url : '/';
        const status = typeof info.status === 'number' ? info.status : 307;
        const sat = SatsetResponse.redirect(url, status);
        sendSatsetResponse(res, sat);
        return;
      }

      if (err && (err as any).__SATSET_NOT_FOUND) {
        statusCode = 404;
        const errorPayload = { code: 404, message: 'Page not found' };
        try {
          const nf =
            allRoutes.find(r => r.path === '/404') ||
            allRoutes.find(r => r.path === '/not-found');
          if (nf && nf.component) {
            const nfBase = path.basename(nf.component).replace(/\.[^.]+$/, '');
            const nfCompiled = path.join(tempDir, nfBase + '.notfound.server.js');
            await bundler.bundleServer({ entryPoint: nf.component, outfile: nfCompiled, minify: false, root });
            try { delete require.cache[require.resolve(nfCompiled)]; } catch (e) {}
            const NfModule = require(nfCompiled);
            const NfComp = (typeof NfModule === 'function') ? NfModule : (NfModule && typeof NfModule.default === 'function') ? NfModule.default : null;
            if (NfComp) {
              pageHTML = await renderComponentToHtml(NfComp, { params: initialParams, error: errorPayload });
            } else {
              pageHTML = '<h1>404 - Page Not Found</h1>';
            }
          } else {
            pageHTML = '<h1>404 - Page Not Found</h1>';
          }
        } catch (e) {
          pageHTML = '<h1>404 - Page Not Found</h1>';
        }
      } else {
        const maybeStatus =
          (err && (err as any).statusCode) ??
          (err && (err as any).status) ??
          (err && typeof (err as any).code === 'number' ? (err as any).code : undefined);

        if (typeof maybeStatus === 'number' && maybeStatus >= 400 && maybeStatus <= 599) {
          statusCode = maybeStatus;
        } else {
          statusCode = 500;
        }

        const errorPayload = {
          code: statusCode,
          message: (err && err.message) ? err.message : (statusCode === 404 ? 'Page not found' : 'Server error'),
        };

        const candidatePaths: string[] = [];
        candidatePaths.push(`/${statusCode}`);
        if (statusCode === 404) candidatePaths.push('/404', '/not-found');
        if (statusCode === 500) candidatePaths.push('/500');
        candidatePaths.push('/error');

        let errorRoute: any = null;
        for (const p of candidatePaths) {
          const found = allRoutes.find(r => r.path === p);
          if (found) {
            errorRoute = found;
            break;
          }
        }

        try {
          if (errorRoute && errorRoute.component) {
            const erBase = path.basename(errorRoute.component).replace(/\.[^.]+$/, '');
            const erCompiled = path.join(tempDir, erBase + '.error.server.js');
            await bundler.bundleServer({ entryPoint: errorRoute.component, outfile: erCompiled, minify: false, root });
            try { delete require.cache[require.resolve(erCompiled)]; } catch (e) {}
            const ErModule = require(erCompiled);
            const ErComp = (typeof ErModule === 'function') ? ErModule : (ErModule && typeof ErModule.default === 'function') ? ErModule.default : null;
            if (ErComp) {
              pageHTML = await renderComponentToHtml(ErComp, { error: errorPayload, reset: () => {} });
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        } catch (e) {
          // Attempt to extract title from metadata for the error overlay
          let pageTitle: string | undefined;
          try {
            if (PageModule) {
              if (PageModule.metadata && PageModule.metadata.title) {
                pageTitle = PageModule.metadata.title;
              } else if (typeof PageModule.getMetadata === 'function') {
                const t = (key: string, params?: Record<string, string>): string => {
                  const dict = dictionaries[locale] || dictionaries['en-US'] || dictionaries[Object.keys(dictionaries)[0]] || {};
                  let text = dict[key] || key;
                  if (params) {
                    Object.entries(params).forEach(([k, v]) => {
                      text = text.replace(new RegExp(`{${k}}`, 'g'), v);
                    });
                  }
                  return text;
                };
                const meta = await PageModule.getMetadata({ params: initialParams, locale, t });
                if (meta && meta.title) pageTitle = meta.title;
              }
            }
          } catch (metaErr) {
            // ignore metadata extraction errors during error handling
          }

          const errorInfo: ErrorInfo = {
            message: (err as any)?.message || String(err),
            stack: (err as any)?.stack,
            file: route.component,
            title: pageTitle,
          };

          const overlayHTML = generateErrorOverlayHTML(errorInfo);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(overlayHTML);
          return;
        }
      }
    }

    // expose routes + initial params to client for Router
    const routePaths = allRoutes.length ? allRoutes.map(r => r.path) : [];

    // Check whether layout and CSS ended up in the rendered HTML for debugging
    try {
      const hasHeader = pageHTML.includes('<header');
      const hasFooter = pageHTML.includes('<footer');
      console.log(`SSR: rendered page includes header=${hasHeader} footer=${hasFooter}`);

      const cssPath = path.join(tempDir, 'globals.css');
      console.log('SSR: globals.css exists at', cssPath, fs.existsSync(cssPath));
    } catch (e: unknown) {
      // ignore
    }

    // attempt to obtain metadata from the page module (static or via getMetadata)
    let metaHtml = '';
    let htmlLang = 'en';
    try {
      const { renderMetaTags } = await import('../assets/metadata.js');

      // metadata may be exported as `metadata` or `getMetadata` function
      let metaObj: any = null;
      if (PageModule && PageModule.metadata) {
        metaObj = PageModule.metadata;
      } else if (PageModule && typeof PageModule.getMetadata === 'function') {
        try {
          const t = (key: string, params?: Record<string, string>): string => {
            const dict = dictionaries[locale] || dictionaries['en-US'] || dictionaries[Object.keys(dictionaries)[0]] || {};
            let text = dict[key] || key;
            if (params) {
              Object.entries(params).forEach(([k, v]) => {
                text = text.replace(new RegExp(`{${k}}`, 'g'), v);
              });
            }
            return text;
          };
          metaObj = await PageModule.getMetadata({ params: initialParams, locale, t });
        } catch (e) {
          metaObj = null;
        }
      }

      // The `<Head>` component was removed; rely on exported `metadata` or `getMetadata` from the page/layout module.

      // Detect html lang from metadata if provided
      if (metaObj && typeof metaObj.lang === 'string' && metaObj.lang.trim()) {
        htmlLang = metaObj.lang.trim();
      }

      metaHtml = renderMetaTags(metaObj);
    } catch (e) {
      // ignore
    }
    const initialParamsScript = `<script>
      window.__SATSET_ROUTES__ = ${JSON.stringify(routePaths)};
      window.__SATSET_PARAMS__ = ${JSON.stringify(initialParams)};
      window.__SATSET_DICTIONARIES__ = ${JSON.stringify(getDictionaries(root))};
      window.__SATSET_LOCALE__ = "${locale}";
    </script>`;

    // Determine favicon at request time (in case it was created/changed)
    let computedFavicon: string | null = null;
    try {
      const publicPath = path.join(root, publicDirName);
      if (fs.existsSync(path.join(publicPath, 'favicon.ico'))) computedFavicon = '/favicon.ico';
      else if (fs.existsSync(path.join(publicPath, 'favicon.png'))) computedFavicon = '/favicon.png';
    } catch (e) {
      // ignore
    }
    const faviconLink = computedFavicon ? `<link rel="icon" href="${computedFavicon}" />` : '';

    let html = '';
    const trimmedPageHTML = pageHTML.trim();
    if (trimmedPageHTML.toLowerCase().startsWith('<html')) {
        html = '<!DOCTYPE html>\n' + trimmedPageHTML;
        
        const headContent = `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaHtml}
    ${faviconLink}
    <link rel="stylesheet" href="/_satset/globals.css" />`;
        
        if (html.includes('</head>')) {
             html = html.replace('</head>', `${headContent}</head>`);
        }

        const bodyScripts = `
    <script>${envScript}</script>
    ${initialParamsScript}
    <script type="module" src="/_satset/_entry.js"></script>
    <script src="/__hmr"></script>`;

        if (html.includes('</body>')) {
            html = html.replace('</body>', `${bodyScripts}</body>`);
        }
    } else {
        html = `
<!DOCTYPE html>
<html lang="${htmlLang}" suppressHydrationWarning>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${metaHtml}
    ${faviconLink}
    <link rel="stylesheet" href="/_satset/globals.css" />
  </head>
  <body>
    <div id="root">${pageHTML}</div>
    <script>${envScript}</script>
    ${initialParamsScript}
    <script type="module" src="/_satset/_entry.js"></script>
    <script src="/__hmr"></script>
  </body>
</html>
    `;
    }

    res.writeHead(statusCode, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error: any) {
    const errorInfo: ErrorInfo = {
      message: error.message,
      stack: error.stack,
      file: route.component,
    };

    if (route.component && fs.existsSync(route.component)) {
      const stackLines = error.stack?.split('\n') || [];
      const lineMatch = stackLines[0]?.match(/:(\d+):(\d+)/);
      if (lineMatch) {
        const line = parseInt(lineMatch[1]);
        errorInfo.line = line;
        errorInfo.column = parseInt(lineMatch[2]);
        errorInfo.code = extractCodeSnippet(route.component, line);
      }
    }

    const overlayHTML = generateErrorOverlayHTML(errorInfo);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(overlayHTML);
  } finally {
    setCurrentRequestCookies(null);
  }
  });
}

async function runMiddleware(
  root: string,
  tempDir: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  effectivePath: string
) {
  try {
    const candidates = ['middleware.ts', 'middleware.tsx', 'middleware.js', 'middleware.jsx'];
    let srcPath: string | null = null;
    for (const c of candidates) {
      const p = path.join(root, c);
      if (fs.existsSync(p)) {
        srcPath = p;
        break;
      }
    }

    if (!srcPath) {
      return false;
    }

    const baseName = path.basename(srcPath).replace(/\.[^.]+$/, '');
    const compiledPath = path.join(tempDir, baseName + '.middleware.server.js');

    async function safeBundle(entry: string, outfile: string) {
      try {
        await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: true });
      } catch (err: any) {
        const msg = String(err && err.message ? err.message : err);
        if (/ENOSPC|not enough space|There is not enough space/i.test(msg)) {
          try {
            if (fs.existsSync(tempDir)) {
              fs.rmSync(tempDir, { recursive: true, force: true });
            }
            fs.mkdirSync(tempDir, { recursive: true });
          } catch (cleanupErr) {
            console.error('Failed to cleanup temp dir:', cleanupErr);
          }

          await bundler.bundleServer({ entryPoint: entry, outfile, minify: false, root, sourcemap: false });
          return;
        }
        throw err;
      }
    }

    try {
      await safeBundle(srcPath, compiledPath);
      try { delete require.cache[require.resolve(compiledPath)]; } catch (e) {}
      const mod = require(compiledPath);
      const fn = mod && (typeof mod.middleware === 'function' ? mod.middleware : (typeof mod.default === 'function' ? mod.default : null));
      if (!fn) {
        return false;
      }

      const webReq = await buildSatsetRequest(req);
      (webReq as any).effectivePath = effectivePath;

      const result = await fn(webReq);
      if (SatsetResponse.isSatsetResponse(result)) {
        const headers = result.headers || {};
        const isNext =
          result.status === 204 &&
          !headers.Location &&
          !headers['X-Satset-Rewrite'] &&
          (result.body == null);
        if (isNext) {
          return false;
        }
        sendSatsetResponse(res, result);
        return true;
      }

      return false;
    } catch (err: any) {
      const errMsg = String(err && err.message ? err.message : err);
      const errorInfo: ErrorInfo = {
        message: errMsg,
        stack: err.stack,
        file: srcPath,
      };
      const overlayHTML = generateErrorOverlayHTML(errorInfo);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(overlayHTML);
      return true;
    }
  } catch (e) {
    return false;
  }
}

function stripLocaleFromPath(pathname: string): string {
  if (!pathname) return '/';
  const raw = pathname.split('?')[0].split('#')[0];
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

function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return types[ext] || 'text/plain';
}
