import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'vocab',
    short_name: 'vocab',
    description: 'Capture and review English vocabulary',
    start_url: '/',
    display: 'standalone',
    background_color: '#14120f',
    theme_color: '#14120f',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
