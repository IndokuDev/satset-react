import fs from 'fs';
import path from 'path';
import { Route } from '../router/file-system';

export interface SitemapOptions {
  baseUrl: string;
  routes: Route[];
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  lastmod?: Date;
}

export interface SitemapItem {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export function generateSitemapXml(items: SitemapItem[]): string {
  const urls = items.map(item => {
    const lastmod = item.lastModified
      ? (item.lastModified instanceof Date ? item.lastModified : new Date(item.lastModified)).toISOString().split('T')[0]
      : undefined;

    return `  <url>
    <loc>${escapeXml(item.url)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}${item.changeFrequency ? `\n    <changefreq>${item.changeFrequency}</changefreq>` : ''}${item.priority ? `\n    <priority>${item.priority}</priority>` : ''}
  </url>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export function generateSitemap(options: SitemapOptions): string {
  const {
    baseUrl,
    routes,
    changefreq = 'weekly',
    priority = 0.7,
    lastmod = new Date(),
  } = options;

  const items: SitemapItem[] = routes
    .filter(route => !route.dynamic)
    .map(route => ({
      url: `${baseUrl}${route.path}`,
      lastModified: lastmod,
      changeFrequency: changefreq,
      priority: priority,
    }));

  return generateSitemapXml(items);
}

export function saveSitemap(root: string, sitemap: string): void {
  const publicPath = path.join(root, 'public');
  const sitemapPath = path.join(publicPath, 'sitemap.xml');

  fs.mkdirSync(publicPath, { recursive: true });
  fs.writeFileSync(sitemapPath, sitemap);

  console.log('✅ Sitemap generated: public/sitemap.xml');
}

export async function generateAndSaveSitemap(
  root: string,
  routes: Route[],
  baseUrl?: string
): Promise<void> {
  // Get base URL from package.json or env
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

  // Check for env var
  if (process.env.SATSET_PUBLIC_URL) {
    url = process.env.SATSET_PUBLIC_URL;
  }

  const sitemap = generateSitemap({
    baseUrl: url,
    routes,
  });

  saveSitemap(root, sitemap);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}