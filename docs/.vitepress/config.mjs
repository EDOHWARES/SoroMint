import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SoroMint',
  description: 'Developer documentation for the SoroMint platform',
  base: '/SoroMint/',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: false,
  themeConfig: {
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'API', link: '/api-documentation' },
      { text: 'Contracts', link: '/smart-contracts' }
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting started', link: '/getting-started' },
          { text: 'Architecture', link: '/architecture' },
          { text: 'Environment variables', link: '/env-variables' },
          { text: 'Freighter wallet', link: '/freighter-setup' }
        ]
      },
      {
        text: 'Backend and API',
        items: [
          { text: 'API reference', link: '/api-documentation' },
          { text: 'Authentication', link: '/backend-auth' },
          { text: 'Validation', link: '/api-validation' },
          { text: 'Pagination', link: '/pagination-guide' },
          { text: 'Rate limiting', link: '/rate-limiting' },
          { text: 'Backend testing', link: '/backend-testing' }
        ]
      },
      {
        text: 'Smart contracts',
        items: [
          { text: 'Overview', link: '/smart-contracts' },
          { text: 'Deploy contracts', link: '/contract-deployment' },
          { text: 'Contract API', link: '/contract-api' },
          { text: 'Contract events', link: '/contract-events' },
          { text: 'Token design', link: '/token-design' },
          { text: 'Vault system', link: '/vault-system' },
          { text: 'Streaming payments', link: '/streaming-payments' },
          { text: 'DAO voting', link: '/dao-voting' },
          { text: 'Multisig', link: '/multisig-integration' }
        ]
      },
      {
        text: 'Operations',
        items: [
          { text: 'Health checks', link: '/health-checks' },
          { text: 'Logging', link: '/logging' },
          { text: 'Backup system', link: '/backup-system' },
          { text: 'RPC failover', link: '/rpc-failover' },
          { text: 'Rust testing', link: '/rust-testing-guide' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/EDOHWARES/SoroMint' }
    ],
    footer: { message: 'SoroMint developer documentation' }
  }
})
