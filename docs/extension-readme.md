# codex-switch

Switch Codex between your ChatGPT subscription and DeepSeek API models from the
VS Code sidebar. The panel shows the current provider and the available actions
for ChatGPT and DeepSeek. VS Code reloads automatically after a successful
switch; start a new Codex conversation afterward.

The rosette-and-gear icon opens the selector. Your existing encrypted key is
reused; **Set API key** opens VS Code's native password dialog. No keys are
saved in workspace settings. DeepSeek API usage is billed separately.

DeepSeek's model catalog is available in a collapsed disclosure. The Usage
section shows the current USD balance, refreshes every minute while open, and can
notify you when credits cross a configured low-balance threshold or reach zero.

Requires Windows and Python 3.11+ on PATH.

[Providers, version history and downloads](https://github.com/macorisd/codex-switch)
