export default function manifest() {
  return {
    name: 'CRM Dra. Kely León',
    short_name: 'Dra. Kely',
    description: 'Sistema de Agendamiento por WhatsApp con IA',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FFFFFF',
    theme_color: '#22C55E',
    icons: [
      {
        src: '/icon.svg?v=2',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
