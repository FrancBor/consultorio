import { describe, expect, it } from 'vitest';
import {
  createAdminUsersQuery,
  INITIAL_ADMIN_USERS_FILTERS,
} from '../../src/pages/admin-users-state.js';

describe('admin users request state', () => {
  it('creates an immutable request snapshot without sharing editable filters', () => {
    const editable = { search: '  Cuenta  ', role: 'consulta', active: 'true' };
    const request = createAdminUsersQuery(editable, 3);
    editable.search = 'changed';

    expect(request).toEqual({
      search: 'Cuenta',
      role: 'consulta',
      active: 'true',
      page: 3,
      limit: 20,
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('provides the unfiltered first-page defaults', () => {
    expect(createAdminUsersQuery(INITIAL_ADMIN_USERS_FILTERS)).toEqual({
      search: '',
      role: '',
      active: '',
      page: 1,
      limit: 20,
    });
  });
});
