import React from 'react';

export interface SatsetApp {
  default: React.ComponentType<any>;
  getServerSideProps?: (context: ServerContext) => Promise<any>;
  getStaticProps?: () => Promise<any>;
}

export interface ServerContext {
  req: any;
  res: any;
  params: Record<string, string>;
  query: Record<string, string>;
}

export interface PageProps {
  [key: string]: any;
}

export interface LayoutProps {
  children: React.ReactNode;
  params?: Record<string, string>;
}

export interface ErrorPageProps {
  error: Error;
  reset: () => void;
}

export namespace MetadataRoute {
  export type Sitemap = Array<{
    url: string;
    lastModified?: string | Date;
    changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
    priority?: number;
  }>;

  export type Robots = {
    rules: {
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
      crawlDelay?: number;
    } | Array<{
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
      crawlDelay?: number;
    }>;
    sitemap?: string | string[];
    host?: string;
  };
}