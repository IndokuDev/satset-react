import fs from 'fs';
import path from 'path';
import { getRoutes } from '../router/file-system';
import type { VercelConfig, BuildResult } from './types';

export async function vercelAdapter(config: VercelConfig): Promise<BuildResult> {
  const { outDir = '.vercel/output', regions = ['iad1'] } = config;
  
  console.log('🔷 Building for Vercel...');

  const root = process.cwd();
  const outputPath = path.join(root, outDir);

  // Create Vercel output structure
  createVercelStructure(outputPath);

  // Scan routes
  const { routes, apiRoutes } = getRoutes(root);

  // Generate config.json for Vercel
  const vercelConfig = {
    version: 3,
    routes: [
      // Static files
      {
        src: '/public/(.*)',
        dest: '/public/$1',
      },
      // API routes
      ...apiRoutes.map(route => ({
        src: route.path,
        dest: `/api${route.path}`,
      })),
      // Page routes (SSR) - convert Next-like paths to Vercel regex src patterns
      ...routes.map(route => {
        const srcPattern = route.path === '/' ? '^/$' : `^${route.path.replace(/:([^/]+)/g, '([^/]+)').replace(/\\*([^/]+)/g, '(.*)')}$`;
        return {
          src: srcPattern,
          dest: route.path === '/' ? '/index' : route.path,
        };
      }),
      // Catch-all 404
      {
        src: '/(.*)',
        dest: '/404',
      },
    ],
  };

  fs.writeFileSync(
    path.join(outputPath, 'config.json'),
    JSON.stringify(vercelConfig, null, 2)
  );

  // Copy static files
  const publicPath = path.join(root, 'public');
  if (fs.existsSync(publicPath)) {
    const staticPath = path.join(outputPath, 'static');
    fs.mkdirSync(staticPath, { recursive: true });
    copyFolderRecursive(publicPath, staticPath);
  }

  // Generate serverless functions for each page
  for (const route of routes) {
    generateVercelFunction(outputPath, route);
  }

  // Generate API functions
  for (const route of apiRoutes) {
    generateVercelApiFunction(outputPath, route);
  }

  console.log('✅ Vercel build complete!');
  console.log(`📂 Output: ${outputPath}`);
  console.log('💡 Deploy with: vercel --prebuilt');

  return {
    success: true,
    outDir: outputPath,
  };
}

function createVercelStructure(outputPath: string) {
  const dirs = [
    'functions',
    'static',
  ];

  dirs.forEach(dir => {
    fs.mkdirSync(path.join(outputPath, dir), { recursive: true });
  });
}

function generateVercelFunction(outputPath: string, route: any) {
  const functionName = route.path === '/' ? 'index' : route.path.replace(/^\//, '').replace(/\//g, '-');
  const functionPath = path.join(outputPath, 'functions', `${functionName}.func`);

  fs.mkdirSync(functionPath, { recursive: true });

  // .vc-config.json
  const vcConfig = {
    runtime: 'nodejs18.x',
    handler: 'index.js',
    launcherType: 'Nodejs',
    shouldAddHelpers: true,
  };

  fs.writeFileSync(
    path.join(functionPath, '.vc-config.json'),
    JSON.stringify(vcConfig, null, 2)
  );

  // index.js (serverless function)
  const handlerCode = `
const { renderToString } = require('@satset/core');

module.exports = async (req, res) => {
  try {
    // TODO: Import actual component
    const html = \`
<!DOCTYPE html>
<html>
  <head>
    <title>Satset App</title>
  </head>
  <body>
    <div id="root">
      <h1>Route: ${route.path}</h1>
    </div>
  </body>
</html>
    \`;
    
    res.status(200).send(html);
  } catch (error) {
    res.status(500).send('Internal Server Error');
  }
};
  `;

  fs.writeFileSync(path.join(functionPath, 'index.js'), handlerCode);
}

function generateVercelApiFunction(outputPath: string, route: any) {
  const functionName = route.path.replace(/^\/api\//, '').replace(/\//g, '-');
  const functionPath = path.join(outputPath, 'functions', `api-${functionName}.func`);

  fs.mkdirSync(functionPath, { recursive: true });

  // .vc-config.json
  const vcConfig = {
    runtime: 'nodejs18.x',
    handler: 'index.js',
    launcherType: 'Nodejs',
  };

  fs.writeFileSync(
    path.join(functionPath, '.vc-config.json'),
    JSON.stringify(vcConfig, null, 2)
  );

  // index.js (API handler)
  const handlerCode = `
const handler = require('${route.component}');

module.exports = async (req, res) => {
  try {
    if (typeof handler.default === 'function') {
      return handler.default(req, res);
    }
    
    const method = req.method || 'GET';
    if (typeof handler[method] === 'function') {
      return handler[method](req, res);
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
  `;

  fs.writeFileSync(path.join(functionPath, 'index.js'), handlerCode);
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