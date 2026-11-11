import type { NextConfig } from 'next';

// STATIC_EXPORT=1 : site exporté en fichiers statiques (dossier out/), servi par l'API en production.
const staticExport = process.env.STATIC_EXPORT === '1';

const config: NextConfig = {
  reactStrictMode: true,
  ...(staticExport ? { output: 'export', trailingSlash: true } : {}),
};

export default config;
