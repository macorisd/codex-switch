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
  requires the appropriate Codex client reload and a new conversation. After a
  successful **Switch to ChatGPT** or **Switch to DeepSeek** action, reload VS
  Code automatically without an additional confirmation prompt.
- Follow microplanner's README structure: an SVG banner, a three-line product
  explanation, the available-provider and model table, **Install**, **Version
  History**, and a **Developer setup** disclosure. Use **Codex Switch** as the
  banner title and **Switch AI providers in Codex with a click.** as its subtitle.
- Document installation from the latest GitHub Release, plus local development,
  tests, packaging and runtime-state requirements in the developer disclosure.
- Keep a suitable `.gitignore` for source, tooling, packaging and local state.

## Sidebar interface

Source: explicit user instructions, 2026-11-08.

- The view tab is titled **Codex Switch**. All visible interface copy is in
  English.
- Show only **Current Configuration** and **Provider**. Current Configuration
  names the active provider and its subtitle, such as **ChatGPT (Your Plan)** or
  **DeepSeek (API key)**, and never exposes a concrete model.
- Under Provider, show one section for **ChatGPT** with the subtitle
  **Your Plan**, and one section for **DeepSeek** with the subtitle **API key**.
- Highlight the active provider's card with a blue perimeter.
- ChatGPT contains only a **Switch to ChatGPT** button, or a disabled
  **Current Setting** button when it is active.
- DeepSeek shows a red or green status circle with **Not configured** or
  **Configured**, a **Set API key** button, the available models as a
  non-interactive fixed list, **Update model catalog**, **Check connection**, and
  **Switch to DeepSeek**, or a disabled **Current Setting** button when it is
  active.
- **Set API key** opens VS Code's native password dialog. The key is not entered,
  displayed or retained in the sidebar GUI.
- **Update model catalog** and **Check connection** show a prominent green
  success feedback or red error feedback in the DeepSeek card. The feedback has
  no icon or emoji, remains visible for exactly 3 seconds, then disappears.
- A **Manage Providers** action next to the Provider heading opens the complete
  provider list, with an X control that closes the panel. Each provider is labeled
  as **Provider (subtitle)**, has a checkbox and controls to move it up or down;
  checking and unchecking update the Provider section immediately and reliably.
  Unchecked providers are absent from that section and checked providers appear
  in the managed order. Persist that selection and order across reloads. The
  active provider cannot be unchecked and must remain visible in Current
  Configuration and the Provider section; repair any persisted layout that hides
  it. Keep the provider section hidden until the persisted filter and order have
  been applied so a window reload never flashes the complete provider list.
- Do not add introductory, explanatory, footer or other informational copy to
  the sidebar. Do not add model selectors or reasoning-effort controls.
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
- The banner subtitle ends with a period and the title/subtitle block is
  optically centered vertically against the logo.
- The banner background is a single diagonal two-stop gradient from white to a
  soft purple. Do not add decorative motifs or additional vector details.
- Use a transparent monochrome SVG for the VS Code Activity Bar, with the gear
  expressed as negative space. It replaces the original two-arrow symbol and
  follows the editor's icon color in both light and dark themes.

## Credentials and verification

- Preserve the existing API key, ChatGPT sign-in and user configuration during
  migration. Credentials and local configuration backups remain outside Git.
- Keep DeepSeek credentials encrypted for the Windows user. Never put a key in
  settings, process arguments, logs, source or VSIX artifacts.
- Enter the DeepSeek API key through VS Code's native password dialog as refined
  on 2026-11-08. The sidebar only receives the configured/not-configured state;
  never send, prefill or retain the key in the webview.
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
