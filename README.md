<p align="center">
  <img src="docs/banner.svg" alt="Codex Switch: Switch AI providers in Codex with a click" width="100%">
</p>

Codex Switch is a VS Code sidebar extension that moves Codex between your existing ChatGPT subscription and DeepSeek API providers.
Current provider, provider visibility, model catalog and switching actions stay in one focused panel.
DeepSeek credentials remain encrypted for your Windows user and provider switches reload VS Code automatically.

| Provider | Access | Available models |
| --- | --- | --- |
| ChatGPT | Existing ChatGPT subscription and sign-in | Models available to your account |
| DeepSeek | Encrypted DeepSeek API key | `deepseek-flash`, `deepseek-v4-pro` |

## Install

1. Open [GitHub Releases](https://github.com/macorisd/codex-switch/releases) and
   choose the newest version with a VSIX attached.
2. Download `codex-switch-<version>.vsix`.
3. In VS Code, open **Extensions**, choose **Install from VSIX...**, and select
   the downloaded file.
4. Reload VS Code, open **Codex Switch** from the Activity Bar, configure
   DeepSeek if needed, and switch providers.

Codex Switch requires Windows and Python 3.11+ on `PATH`. Runtime credentials and
configuration stay in `%USERPROFILE%\.codex\provider-switcher`, outside the
repository.

## Version History

The table describes the changes introduced by each version. Release links open
the matching GitHub Release, including its installable VSIX and checksum.

| Version | Changes |
| --- | --- |
| [0.1.3](https://github.com/macorisd/codex-switch/releases/tag/v0.1.3) | Simplify the English sidebar, add persistent provider visibility and ordering, restore native API key entry and configuration status, improve active and action feedback states, and reload automatically after a successful provider switch. |
| [0.1.2](https://github.com/macorisd/codex-switch/releases/tag/v0.1.2) | Add the supplied logo, README banner and sidebar icon; publish VSIX release assets and link release history automatically. |
| [0.1.1](https://github.com/macorisd/codex-switch/releases/tag/v0.1.1) | Move source into this repository, bundle the local connector with the extension, and document project conventions. |
| 0.1.0 | Initial sidebar selector for ChatGPT and DeepSeek, model and reasoning selection, encrypted API key storage, and connection checks. |

<details>
<summary><strong>Developer setup</strong></summary>

Use Node.js 24, npm, Python 3.11+, and VS Code 1.100 or newer on Windows. Windows
DPAPI encrypts the local DeepSeek credential.

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

Runtime state remains in `%USERPROFILE%\.codex\provider-switcher`. Preserve
`auth.json`, `config.toml`, the encrypted key, and local configuration backups
when testing provider switches. Never commit credentials or runtime state.

See [project decisions](docs/decisions/README.md) for the product and delivery
rules used by this repository.

</details>
