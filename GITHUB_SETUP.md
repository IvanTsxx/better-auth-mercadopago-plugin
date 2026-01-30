# Setting Up Your GitHub Repository

## 1. Initialize Local Git Repository

Open your terminal in the project root:

```bash
git init
git add .
git commit -m "Initial commit for Mercado Pago plugin (v1.0.0)"
```

## 2. Create Repository on GitHub

1.  Go to [GitHub](https://github.com) and click **New Repository**.
2.  Name it: `better-auth-mercadopago` (or preferred name).
3.  Set visibility: **Public** (important for community plugins) or Private.
4.  Do *not* add README/gitignore/license (we already have them).
5.  Click **Create repository**.

## 3. Link Remote and Push

Run the commands shown by GitHub:

```bash
git remote add origin https://github.com/YOUR_USERNAME/better-auth-mercadopago.git
git push -u origin main
```

## 4. Configure Secrets for CI/CD

To make the tests pass in GitHub Actions, you need to add your Mercado Pago Access Token as a secret.

1.  Go to **Settings** > **Secrets and variables** > **Actions** in your GitHub repo.
2.  Click **New repository secret**.
3.  **Name:** `MP_ACCESS_TOKEN`
4.  **Value:** Your test access token (e.g., `APP_USR-xxxx...`).
5.  Click **Add secret**.
6.  (Optional) Add `MP_WEBHOOK_SECRET` if tests rely on it (currently mocked tests don't strictly need it unless integration tests are added).

## 5. Publishing to NPM (Future Step)

If you plan to publish the package to NPM:
1.  Create an NPM account and an Automation Access Token.
2.  Add it as a secret: `NPM_TOKEN`.
3.  The `.github/workflows/release.yml` workflow is configured to publish automatically when you merge a changeset PR.
