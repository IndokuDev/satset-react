import fs from 'fs';
import path from 'path';
import { getRoutes } from '../router/file-system';
import { bundler } from './bundler';
import type { BuildOptions } from './types';
import { loadEnv, getPublicEnvScript } from './env';
import { generateAndSaveSitemap } from '../assets';

export async function build(options: BuildOptions) {
  const {
    root,
    outDir = 'dist',
    minify = true,
  } = options;

  // Load production env
  const env = loadEnv(root, 'production');

  console.log('📦 Building for production...');

  const distPath = path.join(root, outDir);

  // Clean dist folder
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true });
  }
  fs.mkdirSync(distPath, { recursive: true });

  // Scan routes
  const { routes, apiRoutes } = getRoutes(root);
  console.log(`📁 Found ${routes.length} pages and ${apiRoutes.length} API routes`);

  // 1. Build client bundle
  console.log('🔨 Building client bundle...');
  await buildClientBundle(root, distPath, routes, minify);

  // 2. Build server bundle (for SSR)
  console.log('🔨 Building server bundle...');
  await buildServerBundle(root, distPath, routes, minify);

  // 3. Copy public folder
  const publicPath = path.join(root, 'public');
  if (fs.existsSync(publicPath)) {
    console.log('📁 Copying public assets...');
    copyFolderRecursive(publicPath, path.join(distPath, 'public'));
  }

  // 3.5. Generate sitemap
  console.log('🗺️  Generating sitemap...');
  try {
    await generateAndSaveSitemap(root, routes);
    // Copy sitemap to dist
    const sitemapSource = path.join(root, 'public', 'sitemap.xml');
    const sitemapDest = path.join(distPath, 'public', 'sitemap.xml');
    if (fs.existsSync(sitemapSource)) {
      fs.copyFileSync(sitemapSource, sitemapDest);
    }
  } catch (e) {
    console.log('⚠️  Sitemap generation skipped');
  }

  // 4. Generate route manifest
  console.log('📝 Generating route manifest...');
  const manifest = {
    routes: routes.map(r => ({ path: r.path, component: r.component })),
    apiRoutes: apiRoutes.map(r => ({ path: r.path, component: r.component })),
    buildTime: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(distPath, 'routes.json'),
    JSON.stringify(manifest, null, 2)
  );

  // 5. Copy API routes
  console.log('📁 Copying API routes...');
  for (const route of apiRoutes) {
    const dest = path.join(distPath, 'api', path.relative(path.join(root, 'src/app/api'), route.component));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(route.component, dest);
  }

  // 6. Generate production server.js
  console.log('🔨 Generating production server...');
  generateProductionServer(distPath, routes, apiRoutes, env);

  console.log('✅ Build complete!');
  console.log(`📂 Output: ${distPath}`);
  console.log('\n🚀 To run production server:');
  console.log(`   cd ${outDir}`);
  console.log('   node server.js');

  return { outDir: distPath };
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

async function buildClientBundle(
  root: string,
  outdir: string,
  routes: any[],
  minify: boolean
) {
  const clientDir = path.join(outdir, 'client');
  fs.mkdirSync(clientDir, { recursive: true });

  const dictionaries = getDictionaries(root);

  const entryContent = `
import React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { I18nProvider } from 'satset-react';

${routes.map((route, idx) => {
  const relativePath = path.relative(root, route.component).replace(/\\/g, '/');
  return `import Page${idx} from '../../${relativePath}';`;
}).join('\n')}

// Route definitions
const routeDefs = [
${routes.map((route, idx) => `  { path: '${route.path}', component: Page${idx} },`).join('\n')}
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

  return { component: routeDefs.find(r => r.path === '/')?.component, params: {} };
}

const currentPath = stripLocale(window.location.pathname);
const match = matchPath(currentPath);
window.__SATSET_ROUTES__ = routeDefs.map(r => r.path);
window.__SATSET_PARAMS__ = match.params || {};
window.__SATSET_DICTIONARIES__ = ${JSON.stringify(dictionaries)};

const PageComponent = match.component;

if (PageComponent) {
  const root = document.getElementById('root');
  if (root) {
    const props = match.params ? { params: match.params } : undefined;
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const firstSegment = pathSegments[0];
    const initialLocale = (firstSegment && /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(firstSegment)) ? firstSegment : 'en-US';

    const App = React.createElement(I18nProvider, {
      initialLocale,
      dictionaries: window.__SATSET_DICTIONARIES__
    }, React.createElement(PageComponent, props));

    if (root.hasChildNodes()) {
      hydrateRoot(root, App);
    } else {
      const rootInstance = createRoot(root);
      rootInstance.render(App);
    }
  }
}
  `;

  const tempDir = path.join(root, '.satset');
  fs.mkdirSync(tempDir, { recursive: true });
  const entryPath = path.join(tempDir, '_entry.tsx');
  fs.writeFileSync(entryPath, entryContent);

  await bundler.bundle({
    entryPoints: [entryPath],
    outdir: clientDir,
    minify,
    sourcemap: false,
    watch: false,
  });

  const appDir = path.join(root, 'src/app');
  const cssFiles = findFiles(appDir, '.css');
  for (const cssFile of cssFiles) {
    const dest = path.join(clientDir, path.basename(cssFile));
    fs.copyFileSync(cssFile, dest);
  }

  console.log('✅ Client bundle built');
}

async function buildServerBundle(
  root: string,
  outdir: string,
  routes: any[],
  minify: boolean
) {
  const serverDir = path.join(outdir, 'server');
  fs.mkdirSync(serverDir, { recursive: true });

  const dictionaries = getDictionaries(root);

  const serverEntry = `
import React from 'react';
import { renderToString } from 'react-dom/server';
import { I18nProvider } from 'satset-react';

${routes.map((route, idx) => {
  const relativePath = path.relative(root, route.component).replace(/\\/g, '/');
  return `import * as Page${idx} from '../../${relativePath}';`;
}).join('\n')}

const dictionaries = ${JSON.stringify(dictionaries)};

const routeDefs = [
${routes.map((route, idx) => `  { path: '${route.path}', module: Page${idx} },`).join('\n')}
];

function getComponentFromModule(m) {
  if (!m) return null;
  if (typeof m.default === 'function') return m.default;
  for (const k of Object.keys(m)) {
    if (typeof m[k] === 'function') return m[k];
  }
  return null;
}

function matchPath(pathname) {
  const normalized = stripLocale(pathname);
  const pathSegments = normalized.split('/').filter(Boolean);
  for (const r of routeDefs) {
    const routeSegments = r.path.split('/').filter(Boolean);

    if (r.path.includes('*')) {
      const catchIndex = routeSegments.findIndex(s => s.startsWith('*'));
      const paramName = routeSegments[catchIndex].slice(1);
      const params = {};
      params[paramName] = pathSegments.slice(catchIndex).join('/');
      return { module: r.module, params };
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
      return { module: r.module, params };
    }
  }

  return null;
}

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

export function renderPage(pathname) {
  const match = matchPath(pathname);
  if (!match || !match.module) return null;
  const PageComponent = getComponentFromModule(match.module);
  const params = match.params || {};
  if (!PageComponent) return null;

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  const locale = (first && /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(first)) ? first : 'en-US';

  return renderToString(
    React.createElement(I18nProvider, { initialLocale: locale, dictionaries },
      React.createElement(PageComponent, { params })
    )
  );
}

export function getMetadataForPath(pathname) {
  const match = matchPath(pathname);
  if (!match || !match.module) return null;
  const m = match.module;

  const segments = pathname.split('/').filter(Boolean);
  const first = segments[0];
  const locale = (first && /^[a-zA-Z]{2}(?:-[a-zA-Z]{2})?$/.test(first)) ? first : 'en-US';

  const t = (key, params) => {
    const dict = dictionaries[locale] || dictionaries['en-US'] || {};
    let text = dict[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp('{' + k + '}', 'g'), v);
      });
    }
    return text;
  };

  if (m && m.metadata) return m.metadata;
  if (m && typeof m.getMetadata === 'function') {
    try { return m.getMetadata({ params: match.params || {}, locale, t }); } catch (e) { return null; }
  }
  return null;
}

export { routeDefs as routes, dictionaries };
  `;

  const tempDir = path.join(root, '.satset');
  const serverEntryPath = path.join(tempDir, '_server.tsx');
  fs.writeFileSync(serverEntryPath, serverEntry);

  await bundler.bundleServer({
    entryPoint: serverEntryPath,
    outfile: path.join(serverDir, 'render.js'),
    minify,
  });

  console.log('✅ Server bundle built');
}

function generateProductionServer(distPath: string, routes: any[], apiRoutes: any[], env: any) {
  const envScript = getPublicEnvScript(env.publicVars || {});
  
  const serverCode = `
const http = require('http');
const fs = require('fs');
const path = require('path');

${Object.entries(env.privateVars || {}).map(([key, value]) => 
  `process.env.${key} = '${value}';`
).join('\n')}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const { renderPage, routes, getMetadataForPath, dictionaries } = require('./server/render.js');

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

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const pathOnly = url.split('?')[0].split('#')[0];
  const normalizedPath = stripLocale(pathOnly);
  console.log(\`\${req.method} \${url}\`);

  if (url.startsWith('/client/')) {
    serveStatic(path.join(__dirname, url), res);
    return;
  }

  if (url.startsWith('/public/')) {
    serveStatic(path.join(__dirname, url), res);
    return;
  }

  const apiRoute = ${JSON.stringify(apiRoutes)}.find(r => r.path === normalizedPath);
  if (apiRoute) {
    handleApiRoute(apiRoute, req, res);
    return;
  }

  const pageHTML = renderPage(url);
  if (pageHTML) {
    // Page found, assemble HTML and return
    let metaHtml = '';
    let htmlLang = 'en';
    try {
      const metaObj = await getMetadataForPath(url);
      const metadataAsset = require('./assets/metadata');
      if (metaObj && typeof metaObj.lang === 'string' && metaObj.lang.trim()) {
        htmlLang = metaObj.lang.trim();
      }
      metaHtml = metadataAsset.renderMetaTags(metaObj);
    } catch (e) {
      metaHtml = '';
    }

    const html = '<!DOCTYPE html>' +
      '<html lang="' + htmlLang + '">' +
      '<head>' +
      metaHtml +
      '<meta charset="UTF-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
      '<link rel="stylesheet" href="/client/globals.css" />' +
      '</head>' +
      '<body>' +
      '<div id="root">' + pageHTML + '</div>' +
      '<script>' + envScript + '</script>' +
      '<script>window.__SATSET_DICTIONARIES__ = ' + JSON.stringify(dictionaries) + ';</script>' +
      '<script type="module" src="/client/_entry.js"></script>' +
      '</body>' +
      '</html>';

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<h1>404 - Page Not Found</h1>');
});

function serveStatic(filePath, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = getContentType(ext);
  
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

function handleApiRoute(route, req, res) {
  try {
    const apiPath = path.join(__dirname, 'api', path.basename(route.component));
    delete require.cache[require.resolve(apiPath)];
    const handler = require(apiPath);

    if (typeof handler.default === 'function') {
      handler.default(req, res);
    } else if (typeof handler[req.method] === 'function') {
      handler[req.method](req, res);
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

function handlePageRoute(pathname, req, res) {
  try {
    const pageHTML = renderPage(pathname);
    
    const html = \`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Satset App</title>
    <link rel="stylesheet" href="/client/globals.css" />
  </head>
  <body>
    <div id="root">\${pageHTML}</div>
    <script>${envScript}</script>
    <script type="module" src="/client/_entry.js"></script>
  </body>
</html>
    \`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(\`<h1>Error</h1><pre>\${error.stack}</pre>\`);
  }
}

function getContentType(ext) {
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.xml': 'application/xml',
  };
  return types[ext] || 'text/plain';
}

server.listen(PORT, HOST, () => {
  console.log(\`✅ Server running at http://\${HOST}:\${PORT}\`);
});
  `;

  fs.writeFileSync(path.join(distPath, 'server.js'), serverCode);
}

function findFiles(dir: string, ext: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...findFiles(fullPath, ext));
    } else if (fullPath.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

function copyFolderRecursive(source: string, target: string) {
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  for (const file of files) {
    const sourcePath = path.join(source, file);
    const targetPath = path.join(target, file);
    const stat = fs.statSync(sourcePath);

    if (stat.isDirectory()) {
      copyFolderRecursive(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}
