export const editApplication = (id: number, payload: unknown) => fetch(`/api/admin/applications/${id}`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
