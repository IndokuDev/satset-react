export interface SatsetServerConfig {
  host?: string | boolean;
  port?: number;
}

export interface SatsetAssetsConfig {
  favicon?: string;
}

export interface SatsetResolveConfig {
  alias?: Record<string, string>;
}

export interface SatsetExperimentalConfig {
  optimizePackageImports?: string[];
}

export interface SatsetConfig {
  server?: SatsetServerConfig;
  assets?: SatsetAssetsConfig;
  resolve?: SatsetResolveConfig;
  experimental?: SatsetExperimentalConfig;
}

export function defineConfig(config: SatsetConfig): SatsetConfig {
  return config;
}

export const satsetConfig = defineConfig;
