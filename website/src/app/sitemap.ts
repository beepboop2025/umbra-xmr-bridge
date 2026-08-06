import type { MetadataRoute } from 'next';

const SITE_URL = 'https://umbra-xmr.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/bridge', '/explorer', '/transparency', '/verify'].map((route) => ({
    url: `${SITE_URL}${route}`,
    lastModified: new Date('2026-08-06'),
    changeFrequency: 'monthly',
    priority: route === '/' ? 1 : 0.7,
  }));
}
