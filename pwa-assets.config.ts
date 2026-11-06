import { defineConfig, minimal2023Preset as preset } from '@vite-pwa/assets-generator/config';

// Placeholder icons generated from public/logo.svg:
//   npx pwa-assets-generator
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...preset,
    // iOS turns transparency black, so the touch icon gets a solid background.
    apple: { ...preset.apple, resizeOptions: { background: '#4f46e5' } },
    maskable: { ...preset.maskable, resizeOptions: { background: '#4f46e5' } },
  },
  images: ['public/logo.svg'],
});
