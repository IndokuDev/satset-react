export interface AdapterConfig {
  platform: 'vercel' | 'node' | 'custom';
  outDir?: string;
}

export interface VercelConfig extends AdapterConfig {
  platform: 'vercel';
  regions?: string[];
  functions?: Record<string, {
    memory?: number;
    maxDuration?: number;
  }>;
}

export interface NodeConfig extends AdapterConfig {
  platform: 'node';
  port?: number;
  host?: string | boolean;
  compress?: boolean;
}

export interface BuildResult {
  success: boolean;
  outDir: string;
  entryPoint?: string;
}