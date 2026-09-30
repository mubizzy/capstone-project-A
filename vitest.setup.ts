// vitest.setup.ts
// This file runs before all tests to set up global config

import dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

// NOTE: Do NOT globally mock appEvents or logger here.
// - Unit tests (e.g. auth.service.test.ts) define their own vi.mock() per file.
// - Integration tests (e.g. rbac.test.ts) need real event emitters so that
//   event-driven audit logging (UsageLog) actually runs.
