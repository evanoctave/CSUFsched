import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// RTL auto-cleanup requires a global afterEach; vitest globals are off, so register manually.
afterEach(cleanup);
