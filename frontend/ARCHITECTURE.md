# Frontend architecture

The frontend uses a lightweight Feature-Sliced Design structure.

- `app` — application bootstrapping and route selection.
- `pages` — URL-level screens with minimal composition only.
- `widgets` — large reusable screen blocks, such as the administrator workspace and applicants table.
- `features` — user actions: add, edit, and delete an application.
- `entities` — domain types for programs and applications.
- `shared` — cross-cutting API helpers, assets, and styles.

The next feature, Excel import, belongs in `features/import-applications` and can be used by the administrator workspace without coupling it to the page.
