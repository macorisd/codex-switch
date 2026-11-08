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

## Sidebar interface

Source: explicit user instructions, 2026-11-08.

- The view tab is titled **Codex Switch**. All visible interface copy is in
  English.
- Show only **Current Configuration** and **Provider**. Current Configuration
  names the active provider, ChatGPT or DeepSeek, and never exposes a concrete
  model.
- Under Provider, show one section for **ChatGPT** with the subtitle
  **Your Plan**, and one section for **DeepSeek** with the subtitle **API key**.
- ChatGPT contains only a **Switch to ChatGPT** button, or a disabled
  **Current Setting** button when it is active.
- DeepSeek contains only an API key input, the available models as a
  non-interactive fixed list, **Update model catalog**, **Check connection**, and
  **Switch to DeepSeek**, or a disabled **Current Setting** button when it is
  active.
- Do not add introductory, explanatory, credential-status, footer or other
  informational copy to the sidebar. Do not add provider selection controls,
  model selectors or reasoning-effort controls.
- Use the first available model from the refreshed catalog when switching to
  DeepSeek because model choice is internal to the provider action.

## Brand assets

Source: user-supplied logo and explicit instructions, 2026-11-07.

- Preserve the supplied purple rosette silhouette and its internal six-tooth
  gear when vectorizing the logo. Remove the white rounded-square backdrop.
- Reuse one vector geometry for the colored logo, README banner and sidebar
  icon; avoid redrawing or simplifying the icon into a different symbol.
- Start the README with an SVG banner in the same general composition as
  microplanner: logo on the left, product title and a short subtitle. Include
  only the title and subtitle; omit platform labels, badges and extra copy.
- Use a transparent monochrome SVG for the VS Code Activity Bar, with the gear
  expressed as negative space. It replaces the original two-arrow symbol and
  follows the editor's icon color in both light and dark themes.

## Credentials and verification

- Preserve the existing API key, ChatGPT sign-in and user configuration during
  migration. Credentials and local configuration backups remain outside Git.
- Keep DeepSeek credentials encrypted for the Windows user. Never put a key in
  settings, process arguments, logs, source or VSIX artifacts.
- The DeepSeek API key is entered through the sidebar's masked input as requested
  on 2026-11-08. Send it once from the webview to the extension process to save
  it; never return, prefill or retain that value in webview state.
- Never force `forced_login_method = "api"` to switch providers: this was
  observed to sign out an existing ChatGPT account during initial setup.
- Verify backend/configuration behavior and the extension tests when their code
  changes. For visible changes, inspect the actual VS Code sidebar; do not claim
  visual verification from automated tests alone.
- Before opening or updating a PR, install the exact VSIX built from that PR's
  final source into the user's **current VS Code instance and active profile**.
  Verify the version actually loaded in that window and its visible changes.
  Installing into the default CLI profile, inspecting an installation directory,
  or testing only in an isolated development host is not sufficient.
- Reload that actual window when needed so the user can inspect the proposed
  changes before merging. Preserve workspace, open editors, credentials and
  configuration. If an active agent connection prevents a safe reload, explain
  the concrete blocker and do not claim the installation is active or publish
  the PR as ready until the current-window check is complete.
- This current-window installation requirement was explicitly added by the user
  on 2026-11-07 after a CLI installation left the current window stale. It applies
  to every future codex-switch PR and update.
- This is a VS Code extension project. microplanner's Flutter, Windows release
  bundle and physical Android verification rules do not apply here.

## Release artifacts

Source: explicit user request, 2026-11-07.

- Every GitHub version release must provide the corresponding installable VSIX.
  Package the source at its immutable version tag and verify that the manifest
  version matches the tag before publication.
- After successful artifact publication, automatically hyperlink the matching
  version in the README history table to its GitHub Release. Preserve the
  banner, provider table, descriptions and other version rows.
- Release publication must be repeatable without replacing different existing
  artifacts or moving tags. An existing tag without a Release must be
  recoverable through a manual workflow dispatch.
