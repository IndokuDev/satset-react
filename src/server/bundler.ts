import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

export interface BundleOptions {
  entryPoints: string[];
  outdir: string;
  minify?: boolean;
  sourcemap?: boolean;
  watch?: boolean;
  onRebuild?: (result: esbuild.BuildResult) => void;
  root?: string; // project root for resolving path aliases like @/
}

export class Bundler {
  private ctx: esbuild.BuildContext | null = null;

  async bundle(options: BundleOptions): Promise<esbuild.BuildResult> {
    // allow passing a project root so alias plugin can resolve @/ to the right place
    const root = options.root;    const {
      entryPoints,
      outdir,
      minify = false,
      sourcemap = true,
      watch = false,
      onRebuild,
    } = options;

    const buildOptions: esbuild.BuildOptions = {
      entryPoints,
      bundle: true,
      outdir,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      minify,
      sourcemap,
      splitting: true,
      loader: {
        '.tsx': 'tsx',
        '.ts': 'ts',
        '.jsx': 'jsx',
        '.js': 'js',
        '.css': 'css',
        '.json': 'json',
        '.png': 'file',
        '.jpg': 'file',
        '.svg': 'file',
        '.woff': 'file',
        '.woff2': 'file',
      },
      define: {
        'process.env.NODE_ENV': minify ? '"production"' : '"development"',
      },
      jsx: 'automatic',
      jsxDev: !minify,
    };

    // Alias plugin to resolve configured aliases (plus default @ -> <root>/src)
    const aliasPlugin = (rootPath?: string) => {
      const projectRoot = rootPath || process.cwd();

      function loadAliasMap(): Record<string, string> {
        const map: Record<string, string> = {};

        const jsPath = path.join(projectRoot, 'satset.config.js');
        if (fs.existsSync(jsPath)) {
          try {
            // Best effort require for JS configs using module.exports
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cfg = require(jsPath);
            const alias = cfg?.resolve?.alias;
            if (alias && typeof alias === 'object') {
              for (const key of Object.keys(alias)) {
                const target = alias[key];
                if (typeof target === 'string') {
                  map[key] = path.resolve(projectRoot, target);
                }
              }
            }
          } catch {
            // ignore and fallback to TS/regex
          }
        }

        const tsPath = path.join(projectRoot, 'satset.config.ts');
        if (fs.existsSync(tsPath)) {
          try {
            const content = fs.readFileSync(tsPath, 'utf-8');
            const match = content.match(/resolve\s*:\s*\{[\s\S]*?alias\s*:\s*\{([\s\S]*?)\}/);
            if (match) {
              const body = match[1];
              const entryRegex = /['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`]/g;
              let m: RegExpExecArray | null;
              while ((m = entryRegex.exec(body))) {
                const key = m[1];
                const target = m[2];
                map[key] = path.resolve(projectRoot, target);
              }
            }
          } catch {
            // ignore
          }
        }

        // Default alias: '@' -> ./src if user didn't override
        if (!map['@']) {
          map['@'] = path.join(projectRoot, 'src');
        }

        return map;
      }

      const aliasMap = loadAliasMap();
      const aliasKeys = Object.keys(aliasMap).sort((a, b) => b.length - a.length);

      return {
        name: 'satset-alias',
        setup(build: esbuild.PluginBuild) {
          build.onResolve({ filter: /^@.*/ }, (args) => {
            const orig = args.path;

            for (const key of aliasKeys) {
              if (orig === key || orig.startsWith(key + '/')) {
                const rel = orig.slice(key.length).replace(/^\//, '');
                const base = path.join(aliasMap[key], rel);

                if (fs.existsSync(base)) return { path: base };
                const exts = ['.ts', '.tsx', '.js', '.jsx', '.json'];
                for (const ext of exts) {
                  if (fs.existsSync(base + ext)) return { path: base + ext };
                }

                return { path: base };
              }
            }

            return null;
          });
        },
      };
    };

    const streamMockPlugin = {
      name: 'stream-mock',
      setup(build: esbuild.PluginBuild) {
        build.onResolve({ filter: /^stream$/ }, () => {
           return { path: 'stream', namespace: 'stream-mock' };
        });
        build.onLoad({ filter: /^stream$/, namespace: 'stream-mock' }, () => {
          return {
            contents: `
              export class Readable { constructor() {} pipe() {} on() {} }
              export class Writable { constructor() {} }
              export class Stream {
                constructor() {}
                pipe() {}
                on() {}
                static Readable = Readable;
                static Writable = Writable;
              }
              export default Stream;
            `,
            loader: 'ts',
          };
        });
      },
    };

    const plugins = [
      streamMockPlugin,
      {
        name: 'satset-rebuild',
        setup(build: esbuild.PluginBuild) {
          if (watch && onRebuild) {
            build.onEnd((result: esbuild.BuildResult) => {
              onRebuild(result);
            });
          }
        },
      },
      aliasPlugin(root || process.cwd()),
    ];

    if (watch && onRebuild) {
      // Watch mode for dev
      this.ctx = await esbuild.context({
        ...buildOptions,
        plugins,
      });

      await this.ctx.watch();
      return await this.ctx.rebuild();
    } else {
      // One-time build
      return await esbuild.build({ ...buildOptions, plugins });
    }
  }

  async bundleServer(options: {
    entryPoint: string;
    outfile: string;
    minify?: boolean;
    root?: string;
    sourcemap?: boolean;
  }): Promise<esbuild.BuildResult> {
    const { entryPoint, outfile, minify = false, root, sourcemap = true } = options;

    // alias plugin for server builds as well
    const aliasPlugin = (rootPath?: string) => {
      const projectRoot = rootPath || process.cwd();

      function loadAliasMap(): Record<string, string> {
        const map: Record<string, string> = {};

        const jsPath = path.join(projectRoot, 'satset.config.js');
        if (fs.existsSync(jsPath)) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const cfg = require(jsPath);
            const alias = cfg?.resolve?.alias;
            if (alias && typeof alias === 'object') {
              for (const key of Object.keys(alias)) {
                const target = alias[key];
                if (typeof target === 'string') {
                  map[key] = path.resolve(projectRoot, target);
                }
              }
            }
          } catch {
          }
        }

        const tsPath = path.join(projectRoot, 'satset.config.ts');
        if (fs.existsSync(tsPath)) {
          try {
            const content = fs.readFileSync(tsPath, 'utf-8');
            const match = content.match(/resolve\s*:\s*\{[\s\S]*?alias\s*:\s*\{([\s\S]*?)\}/);
            if (match) {
              const body = match[1];
              const entryRegex = /['"`]([^'"`]+)['"`]\s*:\s*['"`]([^'"`]+)['"`]/g;
              let m: RegExpExecArray | null;
              while ((m = entryRegex.exec(body))) {
                const key = m[1];
                const target = m[2];
                map[key] = path.resolve(projectRoot, target);
              }
            }
          } catch {
          }
        }

        if (!map['@']) {
          map['@'] = path.join(projectRoot, 'src');
        }

        return map;
      }

      const aliasMap = loadAliasMap();
      const aliasKeys = Object.keys(aliasMap).sort((a, b) => b.length - a.length);

      return {
        name: 'satset-alias-server',
        setup(build: esbuild.PluginBuild) {
          build.onResolve({ filter: /^@.*/ }, (args) => {
            const orig = args.path;

            for (const key of aliasKeys) {
              if (orig === key || orig.startsWith(key + '/')) {
                const rel = orig.slice(key.length).replace(/^\//, '');
                const base = path.join(aliasMap[key], rel);

                if (fs.existsSync(base)) return { path: base };
                const exts = ['.ts', '.tsx', '.js', '.jsx', '.json'];
                for (const ext of exts) {
                  if (fs.existsSync(base + ext)) return { path: base + ext };
                }

                return { path: base };
              }
            }

            return null;
          });

          build.onResolve({ filter: /^satset-react\/server$/ }, () => {
            const localPkgRoot = path.resolve(projectRoot, '..', '@satset');
            const candidates = [
              path.join(localPkgRoot, 'dist', 'server', 'index.cjs'),
              path.join(localPkgRoot, 'dist', 'server', 'index.js'),
              path.join(localPkgRoot, 'src', 'server', 'index.ts'),
              path.join(localPkgRoot, 'src', 'server', 'index.tsx'),
            ];

            for (const candidate of candidates) {
              if (fs.existsSync(candidate)) {
                return { path: candidate };
              }
            }

            return null;
          });
        },
      };
    };

    return await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile,
      format: 'cjs',
      platform: 'node',
      target: 'node18',
      minify,
      sourcemap,
      external: ['react', 'react-dom', 'esbuild'],
      loader: {
        '.tsx': 'tsx',
        '.ts': 'ts',
        '.css': 'css',
        '.json': 'json',
      },
      jsx: 'automatic',
      plugins: [aliasPlugin(root)],
    });
  }

  async stop() {
    if (this.ctx) {
      await this.ctx.dispose();
      this.ctx = null;
    }
  }

  // Transform single file (for HMR)
  async transform(code: string, filepath: string): Promise<string> {
    const result = await esbuild.transform(code, {
      loader: path.extname(filepath).slice(1) as any,
      jsx: 'automatic',
      sourcemap: 'inline',
    });

    return result.code;
  }

  // Build CSS modules
  async buildCSS(files: string[], outdir: string): Promise<void> {
    const cssFiles = files.filter(f => f.endsWith('.css'));
    
    if (cssFiles.length === 0) return;

    for (const file of cssFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const filename = path.basename(file);
      const isModule = filename.endsWith('.module.css');

      if (isModule) {
        // CSS Modules - scope classes
        const scoped = this.scopeCSS(content, filename);
        fs.writeFileSync(path.join(outdir, filename), scoped);
      } else {
        // Global CSS - copy as-is
        fs.writeFileSync(path.join(outdir, filename), content);
      }
    }
  }

  private scopeCSS(css: string, filename: string): string {
    // Simple CSS Modules implementation
    const hash = filename.replace(/[^a-z0-9]/gi, '_').slice(0, 8);
    
    // Replace class selectors with scoped versions
    return css.replace(/\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g, (match, className) => {
      return `.${className}_${hash}`;
    });
  }
}

export const bundler = new Bundler();
