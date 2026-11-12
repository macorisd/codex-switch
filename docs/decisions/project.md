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
  the supported API-key providers. Provider-specific history and tools can differ; switching
  requires the appropriate Codex client reload and a new conversation. After a
  successful **Switch to ChatGPT** or **Switch to DeepSeek** action, reload VS
  Code automatically without an additional confirmation prompt.
- **Switch to ChatGPT** must always select the official `openai` provider. If a
  saved snapshot contains another provider such as CC Switch's `custom`, or a
  DeepSeek model, recover the most recent valid ChatGPT values from Codex Switch
  configuration backups instead of restoring the incompatible snapshot.
- Follow microplanner's README structure: an SVG banner, a three-line product
  explanation, a provider/access table without an Available models column, **Install**, **Version
  History**, and a **Developer setup** disclosure. Use **Codex Switch** as the
  banner title and **Switch AI providers in Codex with a click. Without ever
  leaving VS Code.** as its subtitle. Treat the slogan as one continuous paragraph;
  wrap only for available space, never force a new paragraph between sentences.
  Source: user refinements, 2026-11-12.
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
- Show ChatGPT with its detected plan subtitle (see ChatGPT Usage) and all nine
  API providers with **API key**, respecting Manage Providers visibility/order.
- Place each provider's recognizable logo in a compact rounded app-icon tile
  to the left of its name and subtitle, aligned as one header identity group.
  Bundle the logo assets locally, retain their attribution, and make the image
  decorative for screen readers because the adjacent name already labels it.
  Preserve identity alignment and narrow layouts.
  Source: explicit patch request, 2026-11-11.
  Use the available brand-color variants for provider logos, preserving their
  colors and gradients with a contrasting tile background. Source: user
  correction about monochrome logos, 2026-11-12.
- Highlight the active provider's card with a blue perimeter.
- Show provider cards in one column below a 550px webview width and two equal
  columns from 550px onward. Allow the content to grow to 960px in the wide
  layout, retain the managed order and visibility, and let a sole visible card
  span the full row. Do not impose a minimum width on the sidebar itself.
  In the two-column layout only, stretch cards in each row to the tallest
  card and put surplus space directly above each shorter card's final switch
  button, aligning the buttons while retaining their existing minimum gap.
  Below 550px, keep natural card heights and existing spacing.
  Source: explicit responsive-layout request, 2026-11-11.
- Aggregators with laboratory/model filters (currently OpenRouter) span the full
  row in the wide layout. Provide a combinable **Free models only** filter using
  the provider's verified free-model metadata/identifier rules. Never guess that
  an unknown price means free. Fill wide-grid gaps with subsequent half-width
  cards: ChatGPT → OpenRouter → DeepSeek renders ChatGPT/DeepSeek in the first
  row and OpenRouter across the next. The managed order still determines the
  narrow layout. Source: explicit refinements, 2026-11-12.
- Place one sync icon to the right of the active provider label in Current
  Configuration. Remove provider-specific balance sync icons. It refreshes
  configuration and all visible providers' account/credential status, catalog
  and usage/balance; keep catalog and connection actions available separately.
  Spin counter-clockwise until all refresh work settles, including failures.
- A provider unchecked in Manage Providers must never load or refresh its data:
  skip initial, automatic and global/manual requests; stop its timers and cancel
  pending requests when hidden. Re-enabling it loads fresh data and resumes
  polling while the panel is visible. Shared local configuration metadata may
  be read to identify the active provider and enforce its mandatory visibility.
  Source: explicit sync and resource-saving instructions, 2026-11-11.
- ChatGPT shows account status and usage (see ChatGPT Usage), followed by
  **Switch to ChatGPT**, or disabled **Current Setting** when it is active.
- DeepSeek shows a red or green status circle with **Not configured** or
  **Configured**, a **Set API key** button, **Check connection**, and a
  **Switch to DeepSeek** button, or a disabled **Current Setting** button when
  it is active. Green **Configured** means the key has been validated, not only
  saved.
- **Check connection** is a discreet text link in its own action row below the
  credential status. Keep provider headers dedicated to logo, name and subtitle.
  Long names must not move credential controls into different rows.
  Source: full responsive-interface review requested on 2026-11-12, superseding
  the previous placement beside the API key subtitle.
- Place **API endpoint** to the right of **Check connection** in that action row,
  with feedback in its fixed result slot. Hide the endpoint action whenever the
  provider is not configured. Initial setup for providers with regional or
  plan-specific endpoints must remain possible through the native key setup.
  Source: explicit placement/visibility refinement, 2026-11-12.
- **Set API key** opens VS Code's native password dialog. The key is not entered,
  displayed or retained in the sidebar GUI.
- Model catalog and Available balance remain absent while DeepSeek has no
  validated API key. A new provider without a catalog endpoint may reveal its
  documented fallback models for an explicit validation test; switching stays
  disabled until credentials have been validated. Saving a key triggers validation automatically; only a
  successful validation reveals those sections. The provider switch button
  remains visible directly below the credential controls whether or not the key
  is configured, and becomes enabled only after successful validation.
- A failed API-key validation must release busy controls immediately and keep
  **Set API key** available for another attempt. Show that validation failure in
  the local connection feedback rather than waiting for a native notification
  to be dismissed.
- While a stored or newly entered API key is being read and validated, show
  **Loading...** with a neutral status indicator. Do not show a transient
  **Not configured** state before that check completes, and disable credential
  actions until it resolves to **Configured** or **Not configured**.
- **Update model catalog** and **Check connection** show green success or red
  error feedback next to the action that produced it. The feedback has no icon
  or emoji, remains visible for exactly 5 seconds, then disappears.
  Use plain colored text in a fixed result column beside each action, with no
  badge border, background or padding. Reserve the result column in the action
  row so feedback cannot move neighboring controls or alter card height. Keep
  empty/expired messages hidden. Source: full responsive-interface review,
  2026-11-12, refining the earlier empty-feedback correction.
- Give all cards the same header, spacing, control sizing and section alignment.
  Keep titles, model identifiers, errors and secondary controls contained at
  narrow widths. Model updates must retain picker scroll position and focus.
  Connection checks require a saved key and never report success for a missing
  key. Source: full responsive-interface review, 2026-11-12.
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
  Checkbox and ordering actions must use the current layout after host
  acknowledgements and account/configuration refreshes. Verify repeated edits
  through the real webview/host message loop, including persistence and hidden
  request suppression. Source: reported visibility regression, 2026-11-12.
- Keep the sidebar compact. API-key providers expose searchable model selection
  inside their collapsed catalog; persist each provider's model. Do not include
  Reasoning controls in any provider card: users set reasoning in Codex's chat.
  Preserve capability metadata for Codex's native model controls.
  Source: explicit refinement, 2026-11-12, superseding sidebar effort selection.
- Providers with API-key credentials show the model catalog in a disclosure that
  is collapsed by default. Expanding it shows model selection and
  **Update model catalog**. The collapsed disclosure has a single bottom divider,
  never both top and bottom borders. The following Available balance section
  must not add a second top divider.

## API provider architecture

Source: explicit implementation request, 2026-11-12.

- Support ten provider cards: ChatGPT subscription, DeepSeek, OpenRouter,
  OpenAI API, Z.AI (GLM), Moonshot AI (Kimi), Alibaba Cloud (Qwen), xAI (Grok),
  MiniMax and Xiaomi MiMo. ChatGPT authentication remains a separate case.
- Share declarative definitions, encrypted credential storage, lifecycle,
  model discovery, validation, selection, switching and card rendering across
  API providers. Preserve the existing DeepSeek key and ChatGPT restore path.
- Connect directly using native OpenAI Responses endpoints. Never introduce
  local protocol converters or proxies for Anthropic or Google models.
- Discover catalogs and capabilities from official APIs where available;
  documented model-specific overrides and bounded fallbacks cover missing
  metadata. Do not label catalog discovery as a successful inference test.
- OpenRouter remains one provider with search and laboratory filtering. Filter
  out models without text output and tool support. Explain remaining tool and
  reasoning compatibility limits and provide an explicit model test.
- Show only reliable published balance/usage metrics; hide unsupported metrics.
  Ordinary keys must not require organization-admin billing credentials.
- Tests use mocked APIs because the user has no keys for the eight new services.
  Record official sources and distinguish documentation, mocks and real-key
  verification. Never claim actual inference was verified without executing it.

## ChatGPT Usage

Source: user request and approved 0.3.0 PLAN, 2026-11-11.

- Read the existing Codex ChatGPT account without changing sign-in or the
  selected provider. Account configuration is independent of provider selection.
- Use **Your Free/Go/Plus/Pro/Business Plan** when identified, otherwise
  **Your Plan**, consistently in the card, Current Configuration and Manage
  Providers. Show **Loading...**, then **Configured** or **Not configured**
  with the corresponding neutral, green or red indicator. A request failure
  is not proof that no account exists; mark retained information as out of date.
- ChatGPT never shows a model catalog.
- Show remaining percentages in accessible five-hour and weekly usage bars,
  identifying windows by their actual duration. Each includes an exact local
  reset date and time in the user's local time zone without a GMT/UTC suffix.
  Label countdowns **Resets in**; use hours and minutes for five-hour usage
  and days, hours and minutes (`xd xh xm`) for weekly usage. Source: explicit
  refinement and clarification, 2026-11-11.
- Omit every zero-valued countdown unit in both windows. When no complete
  minute remains, display **Resets in a few seconds. Blink and you'll miss it!**
  Source: explicit refinement, 2026-11-11.
- Show the available **Banked resets** count, without consuming resets.
- Missing fields are **Unavailable**, never assumed to be zero. Refresh when
  the panel opens and every 60 seconds while visible, without overlapping
  requests; stop polling when hidden/disposed. Update countdowns each minute.
- Keep tokens, email, account identifiers and unfiltered service responses
  outside the webview and logs. Preserve existing credentials and configuration.

## DeepSeek Usage

Source: approved PLAN for version 0.2.0, 2026-11-09.

- Providers with API-key credentials may show a minimal **Available balance**
  section. DeepSeek is the only provider in version 0.2.0.
- The section has no subtitle or secondary heading. The historical usage dashboard,
  period selector and spending chart are deferred until DeepSeek publishes an
  official usage API; the documented balance endpoint provides current balance
  only.
- Display DeepSeek's USD `total_balance` as dollars. Never present another
  currency as USD.
- Sync balance when the panel opens, when the global sync is pressed, and every 60
  seconds while the panel remains visible. Cancel polling when hidden or
  disposed and prevent overlapping requests.
- The global sync spinner rotates counter-clockwise while provider refreshes
  are active. It stops when all requests settle, independently of how long a
  native balance notification remains open.
- **Balance alert** is shared by every API-key provider and stores an independent
  threshold, default **0**. This new opt-in system replaces the legacy automatic
  DeepSeek threshold; old implicit settings do not activate it. Its bordered
  editor has an X close control and a 10 px gap before the switch button.
  Keep its copy concise: omit "Initial readings are silent"; silent startup is
  behavior, not explanatory UI copy. Source: explicit correction, 2026-11-12.
  Clamp negative input to 0 on blur. At 0, disable every notification and keep
  the balance in the normal theme foreground, including exhausted balances.
- With a positive threshold, balances at/above it use the normal foreground,
  positive balances below it are yellow, and exhausted balances are red.
  Use reported currency units or, for quota-only providers, the lowest reported
  remaining percentage. Never fabricate data for a provider without a reliable
  balance/quota API; explain that limitation in its alert editor.
- On each extension start, the first valid reading establishes a silent baseline
  per provider. Notify once on normal-to-low and low-to-exhausted transitions.
  A direct normal-to-exhausted transition produces only the exhausted warning.
  Never notify on unchanged states or recovery; recovery rearms subsequent
  downward transitions, including exhausted-to-low-to-exhausted. Threshold,
  currency/metric or credential changes establish a new silent baseline.
  Source for the shared opt-in transition rules: explicit user refinement,
  2026-11-12, superseding the earlier DeepSeek-only alert behavior.
- Balance notifications must not block completion of a balance sync. Showing a
  warning is fire-and-forget, and the manual update always clears its loading
  state in a cleanup path even if synchronization throws.
- Hide every webview scrollbar visually while preserving wheel, touch and
  keyboard scrolling. Put vertical scrolling on the `main` element, hide its
  native bar and prevent the root `html`/`body` from creating a second bar.

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
- Use a restrained minimal banner with a considered switching motif in its right
  sector. Preserve the supplied logo, its purple identity, the title and complete
  slogan. This redesign supersedes the earlier white/purple background-gradient
  and no-decoration requirements. Source: explicit redesign request, 2026-11-12.
  The first tiny two-line detail was rejected as too sparse. Develop the same
  concept with stronger presence, deliberate proportions and refined execution
  integrated with the overall composition. Preserve restraint and the continuous
  slogan. Source: explicit design-review correction, 2026-11-12.
- Use a transparent monochrome SVG for the VS Code Activity Bar, with the gear
  expressed as negative space. It replaces the original two-arrow symbol and
  follows the editor's icon color in both light and dark themes.

## Credentials and verification

Source for cross-platform compatibility: explicit user request, 2026-11-11.
Windows, macOS and Linux desktop use the same provider features. Preserve the
Windows DPAPI format and existing keys; use macOS Keychain and Linux Secret
Service directly, without requiring users to install Python keyring or configure
a virtual environment. Bundle the small Linux D-Bus client with the extension
and deploy it with the standalone auth helper. No runtime pip installation or
dependency downloads. Preserve existing service/account identities and fail
closed if the native secure store is unavailable; never use a plaintext fallback.
Allow the OS to present normal unlock/authorization dialogs when needed. An OS
without a functioning secure store cannot be silently treated as encrypted.
Keep the standalone Codex credential helper functional outside the extension
host. Source for automatic credential setup: explicit Mac failure report and
Windows/macOS/Linux usability requirement, 2026-11-12.
Use Python 3.11+, defaulting to python on Windows and python3 on macOS/Linux;
allow codexSwitch.pythonPath to select a compatible virtual environment.
Honor CODEX_HOME consistently. Keep extensionKind=ui: remote workspaces continue
to manage the local desktop account. CI must test real native credential stores,
provider behavior and packaging across the three OSes and x64/ARM64, with
minimum/current Python coverage. Report actual execution evidence separately
from platform detection tests; do not claim untested systems are verified.

- Preserve the existing API key, ChatGPT sign-in and user configuration during
  migration. Credentials and local configuration backups remain outside Git.
- Keep DeepSeek credentials encrypted for the Windows user. Never put a key in
  settings, process arguments, logs, source or VSIX artifacts.
- Enter the DeepSeek API key through VS Code's native password dialog as refined
  on 2026-11-08. The sidebar only receives the configured/not-configured state;
  never send, prefill or retain the key in the webview.
- Never force `forced_login_method = "api"` to switch providers: this was
  observed to sign out an existing ChatGPT account during initial setup.
- **Do not use computer-use tools in this project**, including native Windows
  automation and browser computer-use integrations. Source: explicit user
  instruction, 2026-11-11. Use terminal, tests and supported non-UI APIs for
  development, installation and verification. This supersedes earlier directions
  to automate inspection of the VS Code sidebar.
  Exception: on 2026-11-12 the user explicitly authorized computer use for the
  current responsive-interface review. Scope it to this extension's interface
  and visual fixtures, with capture cleanup after the review. The default rule
  remains applicable to subsequent work without another authorization.
  The resumed review explicitly excludes Chrome and uses VS Code instead.
- Verify backend/configuration behavior and extension tests when code changes.
  For visible changes, report the automated checks and any pending user visual
  review separately; automated tests do not establish visual verification.
- Before delivering a PR, install the exact VSIX built from that PR's
  final source into the user's **current VS Code instance and active profile**.
  Verify the version actually loaded in that window through supported non-UI
  evidence when available; leave visual review to the user.
  Installing into the default CLI profile, inspecting an installation directory,
  or testing only in an isolated development host is not sufficient.
- Reload that actual window when needed so the user can inspect the proposed
  changes before merging. Preserve workspace, open editors, credentials and
  configuration. If an active agent connection prevents a safe reload, explain
  the concrete blocker and do not claim the installation is active until the
  current-window check is complete. If that check
  requires UI interaction, request the user's reload/review instead of using
  computer use.
- Always publish the implementation branch and open a real PR in the same
  delivery. A pending reload, current-window check or user visual review must
  never prevent PR creation: open a normal PR, never a draft, record remaining
  checks in the PLAN and report them honestly. The user tests and merges when
  satisfied, or requests fixes in the same PR while it remains open. If it is
  closed, start a new branch and PR from current main. Do not ask whether to
  create the PR. Source: explicit corrections, 2026-11-11, superseding the
  earlier requirement to defer PR creation and the proposed draft workaround.
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
