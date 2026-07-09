import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom gives us window / navigator / localStorage / document so the
    // real shipped browser modules (config.js, EventBus.js, StorageService.js,
    // RateService.js, utils.js) load and run unmodified — no network, no API keys.
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      include: ['src/**/*.js'],
      // Exclude DOM-rendering / IO-heavy modules with no deterministic pure logic.
      exclude: [
        'src/main.js',
        'src/services/TelegramService.js',
        'src/services/BridgeService.js',
        '**/*.ts',
      ],
    },
  },
});
