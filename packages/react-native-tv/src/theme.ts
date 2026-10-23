/** 10-foot design tokens. Minimum text size is 24 (readable from a couch). */
export const theme = {
  scrim: 'rgba(0,0,0,0.62)',
  surface: '#14161C',
  surfaceAlt: '#232733',
  primary: '#7CC4FF',
  primaryTint: 'rgba(124,196,255,0.18)',
  focusFill: 'rgba(124,196,255,0.30)',
  text: '#F4F6FA',
  textDim: '#B4BAC8',
  danger: '#FF8A80',
  font: { body: 26, label: 24, caption: 24, heading: 34, answer: 30, hero: 56 },
  /** Matches the Kotlin app's 48dp/27dp TV safe area. */
  safeH: 48,
  safeV: 27,
  panelWidthPct: '40%' as const,
};
