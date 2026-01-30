---
"better-auth-mercadopago": patch
---

Fixed linting errors reported by Biome without breaking any functionality:
- Replaced non-null assertions with proper conditional checks
- Added explicit types to avoid implicit `any`
- Fixed TypeScript type assertions in test files
