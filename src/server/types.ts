export interface ServerConfig {
  port?: number;
  host?: string | boolean;
  root?: string;
  publicDir?: string;
  favicon?: string;
}

export interface BuildOptions {
  root: string;
  outDir?: string;
  minify?: boolean;
}