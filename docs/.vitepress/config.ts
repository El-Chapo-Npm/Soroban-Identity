import { defineConfig } from 'vitepress'

const isConfigured = Boolean(process.env.VITEPRESS_ALGOLIA_APP_ID && process.env.VITEPRESS_ALGOLIA_SEARCH_KEY)

export default defineConfig({
  title: 'Soroban Identity',
  description: 'Developer documentation for Soroban Identity',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: [/^http:\/\/localhost:16686/],
  themeConfig: {
    search: isConfigured
      ? {
          provider: 'algolia',
          options: {
            appId: process.env.VITEPRESS_ALGOLIA_APP_ID,
            apiKey: process.env.VITEPRESS_ALGOLIA_SEARCH_KEY,
            indexName: process.env.VITEPRESS_ALGOLIA_INDEX_NAME || 'soroban-identity',
            searchParameters: { facetFilters: ['version:current'] },
          },
        }
      : { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/api-server' },
      { text: 'Migrations', link: '/migrations/' },
      { text: 'GitHub', link: 'https://github.com/El-Chapo-Npm/Soroban-Identity' },
    ],
    sidebar: [
      {
        text: 'Documentation',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'API server', link: '/api-server' },
          { text: 'Security', link: '/security/incident-response' },
          { text: 'Documentation style guide', link: '/DOCUMENTATION_STYLE' },
        ],
      },
      {
        text: 'Migrations',
        items: [{ text: 'Migration overview', link: '/migrations/' }],
      },
    ],
  },
})
