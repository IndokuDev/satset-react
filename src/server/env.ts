import fs from 'fs';
import path from 'path';

interface EnvConfig {
  parsed: Record<string, string>;
  publicVars: Record<string, string>;
  privateVars: Record<string, string>;
}

export function loadEnv(root: string, mode: 'development' | 'production' = 'development'): EnvConfig {
  const envFiles = [
    `.env.${mode}.local`,
    `.env.local`,
    `.env.${mode}`,
    `.env`,
  ];

  const parsed: Record<string, string> = {};

  // Load env files in order (later files override earlier ones)
  for (const file of envFiles) {
    const filePath = path.join(root, file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const vars = parseEnvFile(content);
      Object.assign(parsed, vars);
      console.log(`✅ Loaded env from: ${file}`);
    }
  }

  // Separate public and private vars
  const publicVars: Record<string, string> = {};
  const privateVars: Record<string, string> = {};

  Object.entries(parsed).forEach(([key, value]) => {
    if (key.startsWith('SATSET_PUBLIC_')) {
      publicVars[key] = value;
    } else {
      privateVars[key] = value;
    }
  });

  // Inject into process.env
  Object.entries(parsed).forEach(([key, value]) => {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });

  return { parsed, publicVars, privateVars };
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip comments and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse KEY=VALUE
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (match) {
      const key = match[1];
      let value = match[2].trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Expand variables (e.g., $VAR or ${VAR})
      value = expandVariables(value, vars);

      vars[key] = value;
    }
  }

  return vars;
}

function expandVariables(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/gi, (match, varName) => {
    return vars[varName] || process.env[varName] || match;
  });
}

export function getPublicEnvScript(publicVars: Record<string, string>): string {
  const envObj = Object.entries(publicVars).reduce((acc, [key, value]) => {
    // Remove SATSET_PUBLIC_ prefix for client-side
    const clientKey = key.replace('SATSET_PUBLIC_', '');
    acc[clientKey] = value;
    return acc;
  }, {} as Record<string, string>);

  return `
window.__SATSET_ENV__ = ${JSON.stringify(envObj)};

// Helper to get env vars
window.getEnv = function(key) {
  return window.__SATSET_ENV__[key];
};
  `.trim();
}

export function validateRequiredEnv(required: string[]) {
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    process.exit(1);
  }
}