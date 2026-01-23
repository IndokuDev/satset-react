export interface OpenGraph {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
  type?: string;
}

export interface TwitterCard {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player';
  site?: string;
  creator?: string;
}

export interface Metadata {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  openGraph?: OpenGraph;
  twitter?: TwitterCard;
  robots?: string;
}

export function renderMetaTags(meta: Metadata | null | undefined): string {
  if (!meta) return '';

  const parts: string[] = [];

  if (meta.title) {
    parts.push(`<title>${escapeHtml(meta.title)}</title>`);
    parts.push(`<meta name="title" content="${escapeHtml(meta.title)}" />`);
  }

  if (meta.description) {
    parts.push(`<meta name="description" content="${escapeHtml(meta.description)}" />`);
  }

  if (meta.keywords) {
    parts.push(`<meta name="keywords" content="${escapeHtml(meta.keywords)}" />`);
  }

  if (meta.canonical) {
    parts.push(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`);
  }

  if (meta.robots) {
    parts.push(`<meta name="robots" content="${escapeHtml(meta.robots)}" />`);
  }

  if (meta.openGraph) {
    const og = meta.openGraph;
    if (og.title) parts.push(`<meta property="og:title" content="${escapeHtml(og.title)}" />`);
    if (og.description) parts.push(`<meta property="og:description" content="${escapeHtml(og.description)}" />`);
    if (og.url) parts.push(`<meta property="og:url" content="${escapeHtml(og.url)}" />`);
    if (og.image) parts.push(`<meta property="og:image" content="${escapeHtml(og.image)}" />`);
    parts.push(`<meta property="og:type" content="${escapeHtml(og.type || 'website')}" />`);
  }

  if (meta.twitter) {
    const t = meta.twitter;
    if (t.card) parts.push(`<meta name="twitter:card" content="${escapeHtml(t.card)}" />`);
    if (t.site) parts.push(`<meta name="twitter:site" content="${escapeHtml(t.site)}" />`);
    if (t.creator) parts.push(`<meta name="twitter:creator" content="${escapeHtml(t.creator)}" />`);
  }

  return parts.join('\n');
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
