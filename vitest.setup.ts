// vitest.setup.ts
// This file runs before all tests to set up global mocks

import { vi } from 'vitest';
// vitest.setup.ts
import dotenv from 'dotenv';
// dotenv.config();
dotenv.config({ path: '.env.test' });

// Create mock functqions
const mockOn = vi.fn();
const mockEmit = vi.fn();
const mockOff = vi.fn();
const mockOnce = vi.fn();
const mockSetMaxListeners = vi.fn();

// Mock the events module
vi.mock('./src/lib/events', () => {
  return {
    appEvents: {
      on: mockOn,
      emit: mockEmit,
      off: mockOff,
      once: mockOnce,
      setMaxListeners: mockSetMaxListeners,
    },
  };
});

// Mock the logger
vi.mock('./src/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));
