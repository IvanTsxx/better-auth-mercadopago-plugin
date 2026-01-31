# better-auth-mercadopago

## 0.1.8

### Patch Changes

- 79b98d9: rename and type plugin client

## 0.1.7

### Patch Changes

- Fix plugin ID casing so the plugin is mounted under `authClient.mercadopago` instead of `authClient.mercadoPago`.

  This fixes a bug where the plugin ID used camelCase which caused mismatches with expected client property names. Tests were added/updated to validate the plugin structure.

## 0.1.6

### Patch Changes

- Fix client plugin structure to properly expose methods through getActions. This resolves the issue where authClient.mercadoPago.createSubscription and other methods were not accessible, even though they were available when destructuring.

## 0.1.4

### Patch Changes

- 31a0418: fix-github-action

## 0.1.3

### Patch Changes

- 9438e75: Fixed linting errors reported by Biome without breaking any functionality:
  - Replaced non-null assertions with proper conditional checks
  - Added explicit types to avoid implicit `any`
  - Fixed TypeScript type assertions in test files

## 0.1.2

### Patch Changes

- docs: correct package name in readme

## 0.1.1

### Patch Changes

- Initial release: Fixed build issues and updated package name.
