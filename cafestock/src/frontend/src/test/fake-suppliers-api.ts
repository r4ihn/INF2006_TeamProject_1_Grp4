import type { Supplier } from '../api';
import { installFakeApi } from './fake-api';

/** Shorthand used by the suppliers tests: a fake API with just these suppliers. */
export function installFakeSuppliersApi(initial: Partial<Supplier>[] = []) {
  const { fetchMock, suppliers } = installFakeApi({ suppliers: initial });
  return { fetchMock, db: suppliers };
}
