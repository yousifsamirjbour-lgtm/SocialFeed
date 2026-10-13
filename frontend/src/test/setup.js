import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Cleanup DOM after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Polyfill window methods used across components
if (typeof window !== 'undefined') {
  window.scrollTo = vi.fn();
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();

  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url');
  }
  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = vi.fn();
  }
}
