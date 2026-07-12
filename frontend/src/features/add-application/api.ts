export const addApplication = (payload: unknown) => fetch('/api/admin/applications', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
