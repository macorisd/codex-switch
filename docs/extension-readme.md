# codex-switch

Switch Codex between ChatGPT and nine API-key providers: DeepSeek, OpenRouter,
OpenAI API, Z.AI (GLM), Moonshot AI (Kimi), Alibaba Cloud (Qwen), xAI (Grok),
MiniMax and Xiaomi MiMo. VS Code reloads automatically after a successful switch;
start a new Codex conversation afterward.

The rosette-and-gear icon opens the selector. Your existing encrypted key is
reused; **Set API key** opens VS Code's native password dialog. No keys are
saved in workspace settings. DeepSeek API usage is billed separately.

Select a model and supported reasoning inside the collapsed **Model catalog**.
OpenRouter includes search and laboratory filtering. **Test selected model (uses
API credits)** checks a synthetic function call and its result via two Responses
requests. Catalog discovery alone does not establish inference compatibility.
No local protocol proxy is used.

DeepSeek and OpenRouter show USD credits; Kimi shows its region's USD/CNY balance.
MiniMax shows explicit remaining percentages when its M Plan API supplies them.
Unsupported metrics stay hidden. DeepSeek retains its persisted balance alerts.

ChatGPT shows the plan and configuration status of your existing Codex account,
remaining five-hour and weekly usage, local reset dates with countdowns, and
available banked resets. Usage refreshes every minute while the panel is open.
The sync icon beside the current configuration refreshes all visible providers.
Providers hidden in Manage Providers do not load or refresh until enabled again.
Unavailable data is labeled explicitly. No resets are consumed. This requires
the Codex executable bundled with the OpenAI extension, or Codex on PATH.

Requires VS Code desktop on Windows, macOS or Linux (x64/ARM64), Python 3.11+
and a compatible Codex installation. Set codexSwitch.pythonPath for a custom
Python executable. macOS/Linux also require Python keyring 25.7.x in that
interpreter. Linux requires an unlocked Secret Service keyring and D-Bus session.
Windows preserves existing DPAPI keys; macOS uses Keychain. No plaintext fallback.
Runtime paths honor CODEX_HOME. See the repository installation requirements.

[Providers, version history and downloads](https://github.com/macorisd/codex-switch)

[Endpoint setup and verification limits](https://github.com/macorisd/codex-switch/blob/main/docs/providers.md)
