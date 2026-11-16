# codex-switch

Switch Codex between ChatGPT and nine API-key providers: DeepSeek, OpenRouter,
OpenAI API, Z.AI (GLM), Moonshot AI (Kimi), Alibaba Cloud (Qwen), xAI (Grok),
MiniMax and Xiaomi MiMo. Each workspace remembers its provider and model choices.
A successful switch reloads only that window and opens a new Codex conversation.
Other workspaces keep their providers; existing chats keep their original provider.

**Current Configuration** describes the configuration confirmed by this window's
Codex process for new chats. If it has not been confirmed, or another window of
the same workspace saved a change, use **Reload this window**. The panel never
marks a saved preference as active without a runtime confirmation.

The rosette-and-gear icon opens the selector. Your existing encrypted key is
reused; **Set API key** opens VS Code's native password dialog. No keys are
saved in workspace settings. When a key already exists, that dialog includes a
trash button that removes only the selected provider's credential. DeepSeek API
usage is billed separately.

Select a model inside the collapsed **Model catalog**; set reasoning in Codex's
chat. OpenRouter includes search, laboratory
and free-model filtering. Its model list shows readable provider/model names
without model IDs, adding **(free)** only to verified free models. **Test model**
(uses API credits) checks a synthetic function call and its result via two Responses
requests. Catalog discovery alone does not establish inference compatibility.
No local protocol proxy is used.

DeepSeek and OpenRouter show USD credits; Kimi shows its region's USD/CNY balance.
MiniMax shows explicit remaining percentages when its M Plan API supplies them.
Unsupported metrics stay hidden. Each API provider has an independent alert
threshold, disabled at 0 by default. Positive thresholds enable yellow low-balance
and red exhausted states with one warning on each downward crossing. Startup and
repeated readings are silent. Alerts require a reliable reported balance/quota.

ChatGPT shows the plan and configuration status of your existing Codex account,
remaining five-hour and weekly usage, local reset dates with countdowns, and
available banked resets. Usage refreshes every minute while the panel is open.
The sync icon beside the current configuration refreshes all visible providers.
Providers hidden in Manage Providers do not load or refresh until enabled again.
Unavailable data is labeled explicitly. No resets are consumed. This requires
the Codex executable bundled with the OpenAI extension, or Codex on PATH.

Requires VS Code desktop on Windows, macOS or Linux (x64/ARM64), Python 3.11+
and a compatible Codex installation. Compatible Python interpreters are discovered
automatically. Set codexSwitch.pythonPath for a custom
Python executable. API keys use VS Code's encrypted SecretStorage on the client,
shared by local and SSH windows. Existing desktop keys migrate automatically
when a local workspace opens. Local native encrypted copies remain available
for the standalone credential helper. No additional Python packages are needed.
Runtime paths honor CODEX_HOME. See the repository installation requirements.
For SSH, WSL and containers, install alongside Codex on the remote host. The
extension uses that host's ChatGPT sign-in. API keys reach Codex in memory through
the connected VS Code window; headless servers need no desktop keyring and store
no API keys. A standalone remote CLI without VS Code needs its own secure vault.

An existing custom Codex executable is preserved. If it becomes unavailable,
**Use bundled Codex** restores the executable shipped with the official extension.
If Python cannot start, first correct `codexSwitch.pythonPath`, then reload.
Disabling or removing Codex Switch lets the official extension launch ordinary
Codex directly. Other windows can keep their workspace providers. Old managed
executable settings are retired automatically on their owning host; their retained
recovery launcher still works without Python or the removed extension.
Keys, sign-in, conversations and workspace choices are retained.

Startup setup adds an optional entry beside the official Codex extension and
updates its manifest entry point. Its original code and binaries stay intact.
The entry waits for Switch when enabled and starts ordinary Codex when Switch
is disabled, removed or fails to activate. Uninstall restores the owned manifest
entry conditionally, preserving subsequent user and extension changes.

[Providers, version history and downloads](https://github.com/macorisd/codex-switch)

[Endpoint setup and verification limits](https://github.com/macorisd/codex-switch/blob/main/docs/providers.md)
