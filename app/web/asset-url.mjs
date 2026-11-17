// Guest assets use a separate, no-store static namespace.
export const browserAsset = route => typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') && new URL(import.meta.url).pathname.startsWith('/guest/') && !route.startsWith('/guest/') ? `/guest${route}` : route;
