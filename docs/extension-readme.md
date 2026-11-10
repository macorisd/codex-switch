# codex-switch

Switch Codex between your ChatGPT subscription and DeepSeek API models from the
VS Code sidebar. The panel shows the current provider and the available actions
for ChatGPT and DeepSeek. VS Code reloads automatically after a successful
switch; start a new Codex conversation afterward.

The rosette-and-gear icon opens the selector. Your existing encrypted key is
reused; **Set API key** opens VS Code's native password dialog. No keys are
saved in workspace settings. DeepSeek API usage is billed separately.

After DeepSeek successfully validates your API key, its model catalog appears in
a collapsed disclosure and Available balance shows the current USD balance. The
balance refreshes every minute while open and can notify you when credits cross
a configured low-balance threshold or reach zero.

Requires Windows and Python 3.11+ on PATH.

[Providers, version history and downloads](https://github.com/macorisd/codex-switch)
