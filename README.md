<p align="center">
  <img src="docs/banner.svg" alt="Codex Switch: Switch AI providers in Codex with a click. Without ever leaving VS Code." width="100%">
</p>

Codex Switch is a VS Code sidebar extension that switches Codex between your ChatGPT subscription and nine API-key providers.
Keep account usage, searchable models and supported balances with optional alerts in one panel.
Keys use your operating system secure storage; switching preserves ChatGPT sign-in and reloads VS Code automatically.

| Provider | Access | Available models |
| --- | --- | --- |
| ChatGPT | Existing ChatGPT subscription and sign-in | Models available to your account |
| DeepSeek | API key | Refreshed official Codex catalog |
| OpenRouter | API key | Discover text/tool-capable models; search and filter laboratories |
| OpenAI API | API key, separate billing | Discover Responses model candidates |
| Z.AI (GLM) | Coding Plan API key | Discover models; documented GLM fallback |
| Moonshot AI (Kimi) | Regional API key | Discover native Responses models |
| Alibaba Cloud (Qwen) | Token Plan or workspace PAYG key | Discover models; documented plan-specific fallback |
| xAI (Grok) | API key | Discover Grok models |
| MiniMax | M Plan or PAYG API key | Discover native Responses M-series models |
| Xiaomi MiMo | PAYG or Token Plan API key | Discover native Responses models |

See [provider setup, official sources and compatibility limits](docs/providers.md).
Catalog validation is separate from inference. **Test selected model (uses API credits)**
checks a synthetic function-tool round-trip; it does not certify a full Codex session.

## Install

1. Open [GitHub Releases](https://github.com/macorisd/codex-switch/releases) and
   choose the newest version with a VSIX attached.
2. Download `codex-switch-<version>.vsix`.
3. In VS Code, open **Extensions**, choose **Install from VSIX...**, and select
   the downloaded file.
4. Reload VS Code, open **Codex Switch** from the Activity Bar, configure
   an API key if needed, and switch providers.

Codex Switch supports VS Code desktop on Windows, macOS and Linux (x64/ARM64),
with Python 3.11+ and a compatible Codex installation. Windows uses `python`;
macOS/Linux use `python3`. Set `codexSwitch.pythonPath` to select another
interpreter, including a virtual environment.

Windows retains existing DPAPI-encrypted keys. macOS uses Keychain and Linux uses
Secret Service through Python `keyring` (25.7.x); Linux needs an unlocked
Secret Service provider such as GNOME Keyring and a D-Bus session. Install the
package into the selected interpreter with `python3 -m pip install 'keyring>=25.7,<26'`.
If the system Python is managed, use a virtual environment and select its Python
with `codexSwitch.pythonPath`. No plaintext credential fallback is used.

Runtime state stays in `~/.codex/provider-switcher`, or under `CODEX_HOME` when
set, outside the repository. With SSH, WSL or containers, the UI extension still
manages the local desktop's Codex account, not a remote machine's account.

## Version History

The table describes the changes introduced by each version. Release links open
the matching GitHub Release, including its installable VSIX and checksum.

| Version | Changes |
| --- | --- |
| 0.4.0 | Add eight API-key providers through a shared engine, searchable model selection, full-width OpenRouter with laboratory/free-model filtering, explicit model tests, and supported balance/quota information with opt-in alerts. |
| [0.3.3](https://github.com/macorisd/codex-switch/releases/tag/v0.3.3) | Arrange providers in two columns from a panel width of 550px with equal card heights and aligned bottom buttons, retaining natural heights on narrower panels and full width for a single visible provider. |
| [0.3.2](https://github.com/macorisd/codex-switch/releases/tag/v0.3.2) | Add rounded app-style ChatGPT and DeepSeek logos beside each provider name and subtitle. |
| [0.3.1](https://github.com/macorisd/codex-switch/releases/tag/v0.3.1) | Support Windows, macOS and Linux with native credential stores, portable Python paths, configurable interpreter, CODEX_HOME support and cross-platform CI. |
| [0.3.0](https://github.com/macorisd/codex-switch/releases/tag/v0.3.0) | Show the signed-in ChatGPT plan and configuration status, remaining five-hour and weekly usage with exact reset times and countdowns, and available banked resets. Refresh visible providers from one sync control next to the current configuration, without loading hidden providers. |
| [0.2.1](https://github.com/macorisd/codex-switch/releases/tag/v0.2.1) | Hide DeepSeek's model catalog and balance until its API key is validated, show Loading while credential status is pending, keep the provider switch button visible, reveal the API-only sections automatically after successful validation, and allow immediate retries after an invalid key without leaving controls blocked. |
| [0.2.0](https://github.com/macorisd/codex-switch/releases/tag/v0.2.0) | Collapse API-key model catalogs by default, add DeepSeek USD balance with one-minute polling and configurable low or zero balance alerts, and recover ChatGPT settings after CC Switch leaves a custom provider. |
| [0.1.3](https://github.com/macorisd/codex-switch/releases/tag/v0.1.3) | Simplify the English sidebar, add persistent provider visibility and ordering, restore native API key entry and configuration status, improve active and action feedback states, and reload automatically after a successful provider switch. |
| [0.1.2](https://github.com/macorisd/codex-switch/releases/tag/v0.1.2) | Add the supplied logo, README banner and sidebar icon; publish VSIX release assets and link release history automatically. |
| [0.1.1](https://github.com/macorisd/codex-switch/releases/tag/v0.1.1) | Move source into this repository, bundle the local connector with the extension, and document project conventions. |
| 0.1.0 | Initial sidebar selector for ChatGPT and DeepSeek, model and reasoning selection, encrypted API key storage, and connection checks. |

<details>
<summary><strong>Developer setup</strong></summary>

Use Node.js 24, npm, Python 3.11+, and VS Code 1.100 or newer. Install
`backend/requirements.txt` in the chosen Python on macOS/Linux. Tests exercise
the native credential store with isolated temporary identities.

1. Clone the repository and install the locked dependencies:

   ```powershell
   git clone https://github.com/macorisd/codex-switch.git
   cd codex-switch
   npm ci
   ```

2. Run the extension, backend, webview, and release tests:

   ```powershell
   npm test
   ```

3. Regenerate the banner and Activity Bar icon when the logo changes, then build
   the installable package:

   ```powershell
   npm run brand
   npm run package
   ```

4. Install the resulting VSIX in the VS Code profile you are testing:

   ```powershell
   code --install-extension codex-provider-switch-<version>.vsix --force
   ```

Runtime state remains in `~/.codex/provider-switcher` (or under `CODEX_HOME`). Preserve
`auth.json`, `config.toml`, the encrypted key, and local configuration backups
when testing provider switches. Never commit credentials or runtime state.

See [project decisions](docs/decisions/README.md) for the product and delivery
rules used by this repository.

</details>
