import path from "path";
import fs from 'fs';
import { startDevServer } from "../server/dev";
import { build as buildProject } from "../server/build";

function loadConfig(root: string) {
  // Try JS first
  const jsPath = path.join(root, 'satset.config.js');
  if (fs.existsSync(jsPath)) {
    try {
      return require(jsPath);
    } catch (e) {
      // ignore and try other forms
    }
  }

  // Try TypeScript config by simple static extraction (no TS runtime required)
  const tsPath = path.join(root, 'satset.config.ts');
  if (fs.existsSync(tsPath)) {
    try {
      const content = fs.readFileSync(tsPath, 'utf-8');
      const out: any = {};

      // Prefer nested server / assets blocks (defineConfig style)
      const serverBlock = content.match(/server\s*:\s*\{([\s\S]*?)\}/);
      if (serverBlock) {
        const portMatch = serverBlock[1].match(/port\s*:\s*(\d+)/);
        if (portMatch) out.port = Number(portMatch[1]);

        const hostBoolMatch = serverBlock[1].match(/host\s*:\s*(true|false)/);
        const hostStrMatch = serverBlock[1].match(/host\s*:\s*['"`]([^'"`]+)['"`]/);
        if (hostBoolMatch) out.host = hostBoolMatch[1] === 'true';
        else if (hostStrMatch) out.host = hostStrMatch[1];
      }

      const assetsBlock = content.match(/assets\s*:\s*\{([\s\S]*?)\}/);
      if (assetsBlock) {
        const favMatch = assetsBlock[1].match(/favicon\s*:\s*['"`]([^'"`]+)['"`]/);
        if (favMatch) out.favicon = favMatch[1];
      }

      // Fallback to top-level keys for backward compatibility
      if (out.port == null) {
        const portMatch = content.match(/port\s*:\s*(\d+)/);
        if (portMatch) out.port = Number(portMatch[1]);
      }

      if (out.host == null) {
        const hostBoolMatch = content.match(/host\s*:\s*(true|false)/);
        const hostStrMatch = content.match(/host\s*:\s*['"`]([^'"`]+)['"`]/);
        if (hostBoolMatch) out.host = hostBoolMatch[1] === 'true';
        else if (hostStrMatch) out.host = hostStrMatch[1];
      }

      if (out.favicon == null) {
        const favMatch = content.match(/favicon\s*:\s*['"`]([^'"`]+)['"`]/);
        if (favMatch) out.favicon = favMatch[1];
      }

      return out;
    } catch (e) {
      // ignore
    }
  }

  return {};
}

export async function dev() {
  const root = process.cwd();

  // Load config
  const config = loadConfig(root);

  await startDevServer({ ...config, root });
}

export async function build() {
  const root = process.cwd();

  await buildProject({ root });
}

export async function start() {
  const root = process.cwd();
  const distPath = path.join(root, "dist");
  // Check if build exists
  const fs = require("fs");
  if (!fs.existsSync(distPath)) {
    console.error("❌ Build not found. Run satset build first.");
    process.exit(1);
  }
  // Start production server
  const serverPath = path.join(distPath, "server.js");
  require(serverPath);
}
