import React from 'react';
import { renderToString as reactRenderToString } from 'react-dom/server';

export interface RenderOptions {
  url: string;
  lang?: string;
  head?: {
    title?: string;
    meta?: Array<{ name?: string; property?: string; content: string }>;
    links?: Array<{ rel: string; href: string }>;
  };
  scripts?: string[];
  styles?: string[];
}

export interface SSRResult {
  html: string;
  head: string;
  body: string;
}

export function renderToString(
  App: React.ComponentType<any>,
  options: RenderOptions
): SSRResult {
  const appHtml = reactRenderToString(React.createElement(App));
  
  const { title = 'Satset App', meta = [], links = [] } = options.head || {};
  const { scripts = [], styles = [] } = options;
  
  // Generate meta tags
  const metaTags = meta
    .map(m => {
      if (m.name) {
        return `<meta name="${m.name}" content="${m.content}" />`;
      } else if (m.property) {
        return `<meta property="${m.property}" content="${m.content}" />`;
      }
      return '';
    })
    .join('\n    ');

  // Generate link tags
  const linkTags = links
    .map(l => `<link rel="${l.rel}" href="${l.href}" />`)
    .join('\n    ');

  // Generate style tags
  const styleTags = styles
    .map(s => `<link rel="stylesheet" href="${s}" />`)
    .join('\n    ');

  // Generate script tags
  const scriptTags = scripts
    .map(s => `<script type="module" src="${s}"></script>`)
    .join('\n    ');

  const head = `
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    ${metaTags}
    ${linkTags}
    ${styleTags}
  `.trim();

  const body = `
    <div id="root">${appHtml}</div>
    ${scriptTags}
  `.trim();

  const html = `
<!DOCTYPE html>
<html lang="${options.lang || 'en'}">
  <head>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>
  `.trim();

  return { html, head, body };
}

export function renderToStaticMarkup(App: React.ComponentType<any>): string {
  const { renderToStaticMarkup: reactRenderToStaticMarkup } = require('react-dom/server');
  return reactRenderToStaticMarkup(React.createElement(App));
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Stream SSR (for large pages)
export async function renderToStream(
  App: React.ComponentType<any>,
  options: RenderOptions
): Promise<ReadableStream> {
  const { renderToPipeableStream } = require('react-dom/server');
  
  return new Promise((resolve, reject) => {
    const stream = renderToPipeableStream(React.createElement(App), {
      onShellReady() {
        resolve(stream);
      },
      onError(error: Error) {
        reject(error);
      },
    });
  });
}