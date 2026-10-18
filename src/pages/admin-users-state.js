export const INITIAL_ADMIN_USERS_FILTERS = Object.freeze({
  search: '',
  role: '',
  active: '',
})

export const ADMIN_USERS_PAGE_SIZE = 20

export function createAdminUsersQuery(filters, page = 1) {
  return Object.freeze({
    search: filters.search.trim(),
    role: filters.role,
    active: filters.active,
    page,
    limit: ADMIN_USERS_PAGE_SIZE,
  })
}
