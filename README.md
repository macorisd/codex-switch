<p align="center">
  <img src="docs/banner.svg" alt="codex-switch: your project, your choice of model" width="100%">
</p>

A minimal VS Code sidebar extension for switching the model provider used by
Codex. Choose a provider, model and reasoning effort, then apply and reload
VS Code. API keys stay encrypted locally; API usage is billed separately.

| Provider | Access | Integrated models |
| --- | --- | --- |
| ChatGPT | Existing ChatGPT subscription and sign-in | Models available to your account |
| DeepSeek | DeepSeek API key | `deepseek-flash`, `deepseek-v4-pro` |

Open **Codex Switch** from the rosette-and-gear icon in the Activity Bar. Use
**Actualizar** to refresh DeepSeek's model catalog. History and tools may vary
between providers. Requires Windows and Python 3.11+ on `PATH`.

| Version | Changes |
| --- | --- |
| 0.1.2 | Add the supplied logo, README banner and sidebar icon; publish VSIX release assets and link release history automatically. |
| [0.1.1](https://github.com/macorisd/codex-switch/releases/tag/v0.1.1) | Move source into this repository, bundle the local connector with the extension, and document project conventions. |
| 0.1.0 | Initial sidebar selector for ChatGPT and DeepSeek, model and reasoning selection, encrypted API key storage, and connection checks. |

<details>
<summary>Development</summary>

Run `npm test` to check the extension and backend. Run `npm run package` to
generate a VSIX, then install it with `code --install-extension <file.vsix>`.
Runtime data stays in `%USERPROFILE%\.codex\provider-switcher`, outside the
repository. Project conventions: [docs/decisions](docs/decisions/README.md).

</details>
