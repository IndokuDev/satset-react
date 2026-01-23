import fs from 'fs';
import path from 'path';

export interface RobotsOptions {
  allow?: string[];
  disallow?: string[];
  sitemap?: string;
  crawlDelay?: number;
  userAgent?: string;
}

export interface RobotsItem {
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
  crawlDelay?: number;
}

export interface RobotsData {
  rules: RobotsItem | RobotsItem[];
  sitemap?: string | string[];
  host?: string;
}

export function generateRobotsTxtFromData(data: RobotsData): string {
  let content = '';
  const rules = Array.isArray(data.rules) ? data.rules : [data.rules];

  for (const rule of rules) {
    const userAgents = Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent || '*'];
    for (const ua of userAgents) {
      content += `User-agent: ${ua}\n`;
    }

    if (rule.allow) {
      const allows = Array.isArray(rule.allow) ? rule.allow : [rule.allow];
      for (const path of allows) content += `Allow: ${path}\n`;
    }

    if (rule.disallow) {
      const disallows = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
      for (const path of disallows) content += `Disallow: ${path}\n`;
    }

    if (rule.crawlDelay) {
      content += `Crawl-delay: ${rule.crawlDelay}\n`;
    }
    
    content += '\n';
  }

  if (data.sitemap) {
    const sitemaps = Array.isArray(data.sitemap) ? data.sitemap : [data.sitemap];
    for (const sm of sitemaps) content += `Sitemap: ${sm}\n`;
  }

  if (data.host) {
    content += `Host: ${data.host}\n`;
  }

  return content.trim();
}

export function generateRobotsTxt(options: RobotsOptions = {}): string {
  const {
    allow = ['/'],
    disallow = [],
    sitemap,
    crawlDelay,
    userAgent = '*',
  } = options;

  return generateRobotsTxtFromData({
    rules: {
      userAgent,
      allow,
      disallow,
      crawlDelay,
    },
    sitemap,
  });
}

export function saveRobotsTxt(root: string, robots: string): void {
  const publicPath = path.join(root, 'public');
  const robotsPath = path.join(publicPath, 'robots.txt');

  fs.mkdirSync(publicPath, { recursive: true });
  fs.writeFileSync(robotsPath, robots);

  console.log('✅ Robots.txt generated: public/robots.txt');
}

export async function generateAndSaveRobots(
  root: string,
  baseUrl?: string,
  options: RobotsOptions = {}
): Promise<void> {
  const publicPath = path.join(root, 'public');
  const robotsPath = path.join(publicPath, 'robots.txt');

  // Always generate (and overwrite) robots.txt. In both dev and build we should write
  // the current generated file so changes to routes or config are reflected immediately.
  if (fs.existsSync(robotsPath)) {
    console.log('ℹ️ Robots.txt exists — overwriting with generated content...');
  }

  // Get base URL
  let url = baseUrl || 'http://localhost:3000';

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.homepage) {
        url = pkg.homepage;
      }
    } catch (e) {
      // Ignore
    }
  }

  if (process.env.SATSET_PUBLIC_URL) {
    url = process.env.SATSET_PUBLIC_URL;
  }

  const robots = generateRobotsTxt({
    ...options,
    sitemap: `${url}/sitemap.xml`,
  });

  saveRobotsTxt(root, robots);
}