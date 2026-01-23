import http from 'http';
import fs from 'fs';
import path from 'path';
import { getRoutes } from '../router/file-system';
import type { NodeConfig, BuildResult } from './types';

export async function nodeAdapter(config: NodeConfig): Promise<BuildResult> {
  const {
    outDir = 'dist',
    port = 3000,
    host = '0.0.0.0',
    compress = true,
  } = config;

  console.log('🟢 Building for Node.js...');

  const root = process.cwd();
  const outputPath = path.join(root, outDir);

  // Clean output directory
  if (fs.existsSync(outputPath)) {
    fs.rmSync(outputPath, { recursive: true });
  }
  fs.mkdirSync(outputPath, { recursive: true });

  // Scan routes
  const { routes, apiRoutes } = getRoutes(root);

  // Generate standalone server.js
  generateNodeServer(outputPath, routes, apiRoutes, { port, host, compress });

  // Copy static files
  const publicPath = path.join(root, 'public');
  if (fs.existsSync(publicPath)) {
    copyFolderRecursive(publicPath, path.join(outputPath, 'public'));
  }

  // Copy src files (for now - TODO: bundle them)
  const srcPath = path.join(root, 'src');
  if (fs.existsSync(srcPath)) {
    copyFolderRecursive(srcPath, path.join(outputPath, 'src'));
  }

  // Generate package.json for production
  const productionPackage = {
    name: 'satset-app-production',
    version: '1.0.0',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
    },
    dependencies: {
      '@satset/core': '^0.0.1',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    },
  };

  fs.writeFileSync(
    path.join(outputPath, 'package.json'),
    JSON.stringify(productionPackage, null, 2)
  );

  console.log('✅ Node.js build complete!');
  console.log(`📂 Output: ${outputPath}`);
  console.log('💡 Run with:');
  console.log(`   cd ${outDir}`);
  console.log('   npm install --production');
  console.log('   npm start');

  return {
    success: true,
    outDir: outputPath,
    entryPoint: 'server.js',
  };
}

function generateNodeServer(
  outputPath: string,
  routes: any[],
  apiRoutes: any[],
  config: { port: number; host: string | boolean; compress: boolean }
) {
  const serverCode = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || ${config.port};
const HOST_RAW = process.env.HOST || '${config.host}';
const HOST = (HOST_RAW === 'true' ? '0.0.0.0' : (HOST_RAW === 'false' ? 'localhost' : HOST_RAW));

// Route manifest
const routes = ${JSON.stringify(routes, null, 2)};
const apiRoutes = ${JSON.stringify(apiRoutes, null, 2)};

// Simple matcher for dynamic routes
function matchPath(pathname, routesArr) {
  const pathSegments = pathname.split('/').filter(Boolean);
  for (const r of routesArr) {
    const routeSegments = r.path.split('/').filter(Boolean);

    if (r.path.includes('*')) {
      const catchIndex = routeSegments.findIndex(s => s.startsWith('*'));
      const paramName = routeSegments[catchIndex].slice(1);
      const params = {};
      params[paramName] = pathSegments.slice(catchIndex).join('/');
      return { route: r, params };
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
      return { route: r, params };
    }
  }

  return null;
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  
  console.log(\`\${req.method} \${url}\`);

  // Serve static files
  if (url.startsWith('/public/')) {
    serveStatic(url, res);
    return;
  }

  // Handle API routes
  const apiRoute = apiRoutes.find(r => r.path === url);
  if (apiRoute) {
    handleApiRoute(apiRoute, req, res);
    return;
  }

  // Handle page routes (dynamic matching)
  const match = matchPath(url, routes);
  if (match) {
    handlePageRoute(match.route, req, res, match.params);
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end('<h1>404 - Page Not Found</h1>');
});

function serveStatic(url, res) {
  const filePath = path.join(__dirname, url);
  
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
    delete require.cache[require.resolve(route.component)];
    const handler = require(route.component);

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

function handlePageRoute(route, req, res, params = {}) {
  try {
    // TODO: Implement actual SSR
  const paramJson = JSON.stringify(params);
  const html = '<!DOCTYPE html>' +
    '<html lang="en">' +
    '<head>' +
    '<meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    '<title>Satset App</title>' +
    '</head>' +
    '<body>' +
    '<div id="root">' +
    '<h1>Satset.js Production</h1>' +
    '<p>Route: ' + route.path + '</p>' +
    '<pre>Params: ' + paramJson + '</pre>' +
    '</div>' +
    '</body>' +
    '</html>';


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
  };
  return types[ext] || 'text/plain';
}

server.listen(PORT, HOST, () => {
  console.log(\`✅ Server running at http://\${HOST}:\${PORT}\`);
});
  `;

  fs.writeFileSync(path.join(outputPath, 'server.js'), serverCode);
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