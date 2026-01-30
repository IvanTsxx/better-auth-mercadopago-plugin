# Contributing

Thanks for your interest in contributing to `@better-auth/mercadopago`!

## Getting Started

1.  **Fork and Clone**: Fork the repo and clone it locally.
2.  **Install Dependencies**: Run `pnpm install` in the root directory.
3.  **Run Tests**: Run `pnpm test` to ensure everything is working.

## Development Workflow

1.  Create a branch for your feature or fix: `git checkout -b feature/my-cool-feature`.
2.  Make your changes.
3.  Run `pnpm typecheck` and `pnpm lint` to ensure code quality.

## Versioning with Changesets

We use [Changesets](https://github.com/changesets/changesets) for versioning.

**If your changes affect the published package (bug fixes, features, breaking changes):**

1.  Run `pnpm changeset`.
2.  Follow the prompts to select the package and bump type (patch, minor, major).
3.  Write a summary of your changes.
4.  Commit the generated changeset file along with your code.

This allows us to automatically generate changelogs and bump versions upon release.

## Pull Requests

1.  Push your branch to your fork.
2.  Open a Pull Request against the `main` branch.
3.  Ensure CI checks pass.

Thank you!
