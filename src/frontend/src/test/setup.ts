import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy…/waitFor give up after 1 s by default. Typing a whole form with user-event can take
// longer than that when many test files run at once (e.g. in `npm run check`), so allow 5 s —
// passing tests are no slower, a busy machine just no longer causes a false failure.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
