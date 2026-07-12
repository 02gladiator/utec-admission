import { AdminPage } from '../pages/admin'
import { PublicListPage } from '../pages/public-list'

export function Router() {
  return window.location.pathname === '/admin' ? <AdminPage /> : <PublicListPage />
}
