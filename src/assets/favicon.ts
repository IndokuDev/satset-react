import fs from 'fs';
import path from 'path';
import https from 'https';

export async function generateFavicon(root: string, username?: string): Promise<void> {
  const publicPath = path.join(root, 'public');
  const faviconPath = path.join(publicPath, 'favicon.png');

  // Skip if favicon already exists
  if (fs.existsSync(faviconPath)) {
    console.log('✅ Favicon already exists, skipping...');
    return;
  }

  console.log('🎨 Generating favicon...');

  // Get username from package.json or use default
  const faviconUrl = "https://raw.githubusercontent.com/IndokuDev/IndokuDev-all-Logo/refs/heads/main/satset.png"
  try {
    await downloadImage(faviconUrl, faviconPath);
    console.log(`✅ Favicon generated`);
  } catch (error) {
    console.error('❌ Failed to generate favicon:', error);
    // Create default SVG favicon
    createDefaultFavicon(faviconPath);
  }
}

function downloadImage(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

function createDefaultFavicon(dest: string) {
  // Create a simple SVG favicon
  const svg = `
<svg width="256" height="256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#grad)" rx="32"/>
  <text x="128" y="180" font-family="Arial, sans-serif" font-size="140" font-weight="bold" fill="white" text-anchor="middle">S</text>
</svg>
  `.trim();

  fs.writeFileSync(dest.replace('.png', '.svg'), svg);
  console.log('✅ Default SVG favicon created');
}