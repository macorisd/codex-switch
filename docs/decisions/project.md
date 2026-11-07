# Project and delivery decisions

Source: explicit user instructions and initialization answers, 2026-11-07.

## Versions and plans

- Start from version **0.1.0**, matching the extension already installed before
  this repository was created. This baseline is not a claim of a published tag.
- Increment the **minor** version only when adding a new provider or making a
  substantial change to an existing provider. Use the skill's planning and
  approval workflow for those changes.
- All other changes and refinements are **patches without a PLAN**, including
  UI, model-list, packaging and repository adjustments. This project-specific
  classification overrides the skill's general definition of a minor change.
- Keep plans versioned in `docs/plans/`; preserve their history and approvals.
- Keep the extension manifest and release history consistent. Record actual
  publication status; do not describe a local build as a published release.
- No new provider is introduced by moving existing ChatGPT and DeepSeek support
  into this repository.

## Product and documentation

- The product is **codex-switch**, a VS Code extension accessible from the
  sidebar. Its UI is minimal and follows the editor's theme.
- Support convenient switching between an existing ChatGPT subscription and
  DeepSeek API models. Provider-specific history and tools can differ; switching
  requires the appropriate Codex client reload and a new conversation.
- Keep the README minimal: a short explanation, a table of integrated providers,
  and a version table listing the changes in codex-switch.
- Keep a suitable `.gitignore` for source, tooling, packaging and local state.

## Credentials and verification

- Preserve the existing API key, ChatGPT sign-in and user configuration during
  migration. Credentials and local configuration backups remain outside Git.
- Keep DeepSeek credentials encrypted for the Windows user. Never put a key in
  the webview, settings, process arguments, logs, source or VSIX artifacts.
- Never force `forced_login_method = "api"` to switch providers: this was
  observed to sign out an existing ChatGPT account during initial setup.
- Verify backend/configuration behavior and the extension tests when their code
  changes. For visible changes, inspect the actual VS Code sidebar; do not claim
  visual verification from automated tests alone.
- This is a VS Code extension project. microplanner's Flutter, Windows release
  bundle and physical Android verification rules do not apply here.
