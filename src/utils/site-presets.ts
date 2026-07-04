export interface SitePreset {
  id: string
  name: string
  domain: string
  selector: string
  selectors?: string[]
  hint?: string
}

export const SITE_PRESETS: SitePreset[] = [
  {
    id: 'netflix',
    name: 'Netflix',
    domain: 'https://www.netflix.com',
    selector: '.player-timedtext-text-container',
  },
  {
    id: 'udemy',
    name: 'Udemy',
    domain: 'https://www.udemy.com',
    selector: '.shaka-text-container span',
    selectors: [
      '.shaka-text-container span',
      '.shaka-text-wrapper span',
      '.shaka-text-container',
      '[data-purpose="captions-cue"]',
      '[data-purpose="captions-cue-text"]',
      '[class*="cue-text"]',
      '.transcript--cue-text--3osqK',
      'div[class*="captions"] span',
    ],
    hint: 'Udemy uses Shaka Player; subtitle spans live inside .shaka-text-container.',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    domain: 'https://www.youtube.com',
    selector: '.ytp-caption-segment',
  },
  {
    id: 'amazon',
    name: 'Amazon Prime Video',
    domain: 'https://www.amazon.com',
    selector: '.atvwebplayersdk-captions-text',
  },
  {
    id: 'disney',
    name: 'Disney+',
    domain: 'https://www.disneyplus.com',
    selector: '.dss-subtitle-renderer-cue',
  },
  {
    id: 'hbomax',
    name: 'HBO Max',
    domain: 'https://play.max.com',
    selector: '[class*="subtitle"]',
  },
  {
    id: 'hulu',
    name: 'Hulu',
    domain: 'https://www.hulu.com',
    selector: '[class*="caption"]',
  },
  {
    id: 'paramount',
    name: 'Paramount+',
    domain: 'https://www.paramountplus.com',
    selector: '[class*="subtitle"]',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Learning',
    domain: 'https://www.linkedin.com',
    selector: '[class*="transcript"]',
  },
  {
    id: 'shaka',
    name: 'Shaka Player (custom)',
    domain: '',
    selector: '.shaka-text-container span',
    selectors: [
      '.shaka-text-container span',
      '.shaka-text-wrapper span',
      '.shaka-text-container',
      '[class*="shaka-text"]',
    ],
    hint: 'Generic preset for any site using Google Shaka Player.',
  },
]