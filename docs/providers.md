# API providers

All nine API-key cards use `backend/providers.json`, `backend/api_providers.py`,
`api-session.js` and `media/api-view.js`. ChatGPT subscription authentication
and usage remain separate. Private runtime state stays outside this repository.

## Setup

1. Enable the provider in **Manage Providers**. Hidden cards make no requests.
2. **Set API key** uses the native password dialog and existing OS secure store.
   Initial setup for Kimi, Qwen, MiniMax and MiMo also asks for the official
   regional/plan endpoint before saving or validating the key. Accept the
   default or enter your official URL; Alibaba PAYG needs its workspace hostname.
   Canceling that step leaves credentials unchanged. Only official HTTPS hosts
   are accepted; redirects never forward credentials.
3. Once **Configured**, **API endpoint** appears to the right of **Check connection**
   for later changes. It is hidden while **Not configured**.
4. Expand **Model catalog** and choose a model. Selection persists per provider.
   Set reasoning in Codex's chat; provider cards have no Reasoning controls.
   OpenRouter combines search, laboratory filtering and **Free models only**.
5. Optionally **Test model** (uses API credits). Two synthetic Responses
   requests test function calling and continuation with its result, replaying
   returned reasoning items. Each has a 1,024 output-token cap. No tool executes
   and no workspace file is sent. This does not certify a complete Codex session.
6. Switch and start a new conversation after the automatic VS Code reload.
   Changing selection on the active card enables its switch button again.

**Configured** means an authenticated catalog request or explicit model test
succeeded, not that every model supports Codex. OpenRouter checks `/key` before
its public `/models`. A missing models endpoint (404/405/501) reveals documented
fallbacks, but switching requires a successful test. Authorization, quota and
network failures never authenticate through a fallback. A successful fallback
test is remembered until the key/endpoint changes. Refreshing an absent catalog
does not perform billable inference again; test again to check revocation.

## Official Responses endpoints

Reviewed on 2026-11-12. Native Codex connects directly: no local converter,
proxy, or separate Claude/Gemini provider cards.

| Card | Default base URL | Restriction / official source |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | Preserve the [official Codex catalog](https://api-docs.deepseek.com/guides/responses_api/). |
| OpenRouter | `https://openrouter.ai/api/v1` | [Responses](https://openrouter.ai/docs/api/api-reference/responses/create-a-response); capabilities differ by model/route. |
| OpenAI API | `https://api.openai.com/v1` | [Responses](https://developers.openai.com/api/docs/guides/responses); API billing/access differs from ChatGPT. |
| Z.AI | `https://api.z.ai/api/v1` | [Dedicated Codex endpoint](https://docs.z.ai/devpack/tool/codex); Coding Plan and standard API keys are separate. |
| Moonshot | `https://api.moonshot.ai/v1` | [Kimi Responses guide](https://platform.kimi.com/docs/guide/codex-kimi.md); China uses `https://api.moonshot.cn/v1` with a separate key. |
| Alibaba | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | [Token Plan/workspace PAYG](https://www.alibabacloud.com/help/en/model-studio/codex); PAYG replaces `token-plan` with the workspace ID. China workspace hosts are also accepted. Old Coding Plan is Chat Completions-only and excluded. |
| xAI | `https://api.x.ai/v1` | [Native Responses](https://docs.x.ai/developers/rest-api-reference/inference/responses). |
| MiniMax | `https://api.minimax.io/v1` | [Official Codex setup](https://platform.minimax.io/docs/m-plan/codex), recommends Codex 0.146+; China uses `api.minimaxi.com`. Plan/PAYG keys differ. |
| MiMo | `https://api.xiaomimimo.com/v1` | [Codex configuration](https://mimo.mi.com/docs/en-US/tokenplan/integration/codex-configuration); Token Plan uses `https://token-plan-cn.xiaomimimo.com/v1`. |

Do not enter dashboard, Anthropic Messages or Chat Completions URLs. Changing
endpoint invalidates validation and model-test status.

## Discovery and capabilities

`GET /models` supplies IDs/metadata where supported. Unsupported image/audio/
embedding-only candidates are excluded. Services also listing incompatible legacy
models use native-family filters. Unknown capabilities default conservatively to
text, a 32K harness context fallback, no advertised reasoning levels, no custom tools and
no parallel tools. That fallback is not a claim about a model's actual maximum.

OpenRouter uses [model properties](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties):
text output and `tools` must be advertised. Context/image inputs come from
metadata; common low/medium/high efforts appear when reasoning is advertised.
The service normalizes reasoning across laboratories; identical replay behavior
is not established for every route. Custom/freeform tools are disabled for
OpenRouter: Codex uses function tools and shell edits. Eligible Claude/Gemini
models therefore need no local protocol conversion. Routing, billing, encrypted
reasoning, streaming and full agent sessions still need real-key verification.

Aggregator cards declare `modelFilters` and span a full row from 550px. The wide
grid fills gaps with subsequent ordinary cards: ChatGPT Ã¢â€ â€™ OpenRouter Ã¢â€ â€™ DeepSeek
places ChatGPT/DeepSeek together before the full-width OpenRouter card. Below
550px, the managed order remains unchanged. Search, laboratory and free filters
combine without implicitly changing the selected model or writing Codex config.

Free classification uses explicit zero prompt/completion pricing and rejects
any reported nonzero charge. When pricing is absent, OpenRouter's documented
[`:free` variants and `openrouter/free`](https://openrouter.ai/docs/guides/routing/model-variants/free)
are recognized. Missing prices, malformed values and marketing names do not
establish free access. Other aggregators can declare their own verified free IDs/
suffix and normalize official pricing to the shared format. Free models still
need text/tool support; free access does not certify Responses compatibility or
remove upstream rate limits. The filter never introduces paid fallbacks.

Small model-specific rules in the definitions cover missing metadata: GLM 5.3,
Kimi K3, MiniMax M3 code mode, MiMo 2.6 (including required `use_responses_lite`),
and documented Grok/OpenAI efforts. Dynamic `supported_reasoning_levels` overrides
fallback efforts. See [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning),
[GPT-5.1](https://developers.openai.com/api/docs/models/gpt-5.1),
[GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2) and
[Grok reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).

OpenAI's ordinary model listing does not expose reasoning/context capabilities.
For matching accessible API IDs, reuse Codex's local `models_cache.json` metadata
when present, then fall back to documented rules. Cache identity, instructions
and account fields never enter the API catalog or webview. Missing cache metadata
does not invent effort choices for newer model names.

Missing listings use bounded documented fallbacks: GLM 5.3, Kimi K3.1 Pro, Qwen
auto/3.7 Max, MiniMax M3.1 Flash, MiMo 2.6 Pro/Flash. Discovery is attempted first.
Selection is checked against the saved catalog before writing Codex config.

## Balance and limits

- DeepSeek: [USD balance](https://api-docs.deepseek.com/api/get-user-balance).
- OpenRouter: [credits](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits),
  account `total_credits - total_usage`, not a per-key spending limit. Missing
  billing permission hides balance without invalidating model access.
- Kimi: [available balance](https://platform.kimi.ai/docs/api/balance), USD on
  the global endpoint and [CNY in China](https://platform.kimi.com/docs/api/balance.md).
- MiniMax: M Plan `/v1/token_plan/remains`, as used by the
  [official CLI](https://github.com/MiniMax-AI/cli/blob/main/src/client/endpoints.ts).
  Display explicit remaining percentages, resets and the server's weekly boost.
  Legacy count fields have ambiguous consumed/remaining semantics even in the
  [official resolver](https://github.com/MiniMax-AI/cli/blob/main/src/utils/quota.ts),
  so no percentages are guessed from counts. PAYG monetary balance stays hidden
  because that response does not identify its currency.

OpenAI organization-admin billing requires different permissions from ordinary
inference keys. No dependable ordinary-key remaining balance/limit contract was
established for Z.AI, Qwen, xAI or MiMo. Those cards show no fabricated zero
balances, estimated spend or guessed limits. Missing/non-finite data stays hidden.

Every API card has an independent **Balance alert**, disabled at the default 0.
The new opt-in preferences replace the legacy automatic DeepSeek alert setting.
Negative input becomes 0 on blur. At 0, balances use the normal theme foreground
even when exhausted, and no warnings appear. A positive threshold uses the
reported currency, or the lowest reported remaining percentage for quota-only
providers. Cards without reliable readings explain why alerts cannot run.

At/above the threshold the amount is neutral; below it is yellow; at/below 0 is
red. Initial readings after starting the extension are silent. Notify only when
crossing from neutral to yellow or from yellow to red; a direct neutral-to-red
drop produces one exhausted warning. Repeated reads and recovery never notify.
Recovery rearms subsequent downward crossings, including red Ã¢â€ â€™ yellow Ã¢â€ â€™ red.
Threshold, credential or metric/currency changes establish a silent new baseline;
settings changes do not make extra API requests. Only thresholds persist, so
restarting never replays an old warning. Hidden providers remain inactive.

## CC Switch and maintenance

Reference: [Codex presets at 664a46a](https://github.com/farion1231/cc-switch/blob/664a46ab88991e54fb53768eff4084a4412e0929/src/config/codexProviderPresets.ts)
and its native catalog builder. Adopted ideas: native Responses, regional
endpoints, declarative capabilities and conservative function tools. Newer
official docs take precedence: Kimi now recommends K3.1 Pro; MiniMax recommends
M3.1 Flash/code mode; Alibaba distinguishes native Token Plan/workspace PAYG
from old Coding Plan. Reference setup scripts are never executed.

Unlike auth-file examples, the extension preserves the OS credential helper,
never overwrites ChatGPT authentication and never forces API-only login.
API-to-API switching cannot replace the saved ChatGPT snapshot. Unrelated TOML
settings and unmanaged provider sections are preserved.

Add one definition, logo and contract tests for another provider. Add an adapter
only for a genuinely different published catalog/usage shape, not another card,
controller or config writer. Verify effort/wire changes against official docs.

## Verification boundary

### Credential storage without package setup

Windows keeps the original DPAPI-encrypted files. macOS calls Apple's
[Keychain Services](https://developer.apple.com/documentation/security/keychain-services)
directly through Python's standard-library ctypes. Linux bundles the unmodified
Jeepney 0.9.0 wheel (49 KB, MIT license) to access the desktop's native
[Secret Service](https://specifications.freedesktop.org/secret-service/latest/).
Its pinned hash is checked before import; attribution and the source are in
`backend/vendor/NOTICE.md`. No pip, virtual environment or download is required
for credential storage. Python 3.11+ remains the connector's runtime requirement.

Existing Windows blobs, Keychain generic-password service/account attributes and
Linux service/username lookup attributes are preserved. Existing vault items are
updated in place. Runtime files on macOS/Linux contain only a non-secret presence
marker. The standalone auth helper receives its bundled code/client automatically
and continues working without the extension host or installed Python packages.

The OS may present an authorization/unlock prompt; cancellation fails safely.
On Linux the service is activated through the desktop's D-Bus session and a
default collection can be created through the vault's own prompt. A desktop with
no secure vault cannot be turned into one without OS facilities; the connector
fails closed rather than fabricating encryption or writing a plaintext fallback.
The standard `plain` session algorithm describes the local D-Bus transfer encoding,
not file storage. Disk encryption remains the native vault's responsibility;
the extension never writes a secret or master password into a local fallback.

### Tests and real-key limits

Mocks cover every API provider: credential isolation, discovery, fallback and
401/403/429/500 failures, selection persistence, Responses tools/reasoning replay,
API-to-API-to-ChatGPT restoration, currencies, absent metrics and host validation.
Existing native-store tests remain in the Windows/macOS/Linux CI matrix. DOM
tests execute the actual HTML/renderer; extension tests cover sync, alerts and
hidden-provider cancellation. There are no new runtime npm dependencies.

No real keys were available for the eight new services. Their inference,
streaming, route-specific tools, plan permissions and long-running sessions
remain unverified. A synthetic function test does not verify images, parallel/
freeform tools or a full Codex session. Visual review remains with the user;
computer use is prohibited for this project.


### Workspace provider isolation

Each folder workspace or saved `.code-workspace` has its own provider and model
preferences under `provider-switcher/workspaces/<identity>`. Multi-folder identity
uses the workspace file, independently of folder order and the active editor.
Empty windows use their workbench-window identity. Different windows of the same
workspace share its saved preference; a window with an older applied revision
shows a reload action rather than a false current setting.

An early-activated local UI extension binds each app-server launch to its own
workspace and extension-host process. `chatgpt.cliExecutable` installs one common
launcher; provider and model overrides remain private to each launched process.
A restored Codex view that starts first waits for its own parent host's binding,
checking the OS process creation identity to reject stale PID reuse. Native
Responses requests and tool messages are forwarded unchanged. One private
`config/read` exchange confirms the actual app-server default; only minimal
provider/model/process metadata reaches the runtime receipt. Full configuration,
authentication and account responses are never stored in it or sent to the panel.
The receipt does not identify an arbitrary visible historical conversation.
Confirmation starts after the successful `initialize` response. The official IDE
does not send an `initialized` notification; clients that do send it still cause
only one private confirmation request. An absent notification is not a reason to
keep a working client unconfirmed or ask for repeated reloads.

The launcher keeps the original `CODEX_HOME`, encrypted key identities, ChatGPT
account and conversation storage. It neither copies `auth.json` nor creates
separate account homes. The first migration retires only an old global provider
block with this extension's ownership markers, preserving its configuration
backup, valid ChatGPT restore values and unrelated TOML. Subsequent workspace
switches do not rewrite the global selection. Project `.codex/config.toml` is
not used to select providers because Codex ignores provider keys in that layer.
See the [official configuration reference](https://developers.openai.com/codex/config-reference/).

On Windows the small bootstrap is built from bundled C# source using the .NET
Framework compiler included with desktop Windows. It forwards binary stdio and
uses a job object to close its process tree when the editor stops it. The Python
launcher is bundled as source on every platform. macOS/Linux use an executable
shell entry point and a pipe guard owning only the launched client's process
group. There are no runtime downloads or additional package-install commands.

Existing custom Codex executables are remembered and passed through. If a custom
path disappears, **Use bundled Codex** (also in the Command Palette) explicitly
selects the executable supplied by the official extension. Python failures need
`codexSwitch.pythonPath` corrected before reloading.

Each activation claims its own extension-host process before asynchronous setup.
An owned setup failure stays an explicit error. An invocation without an active
owner runs the original custom CLI, or the current official Codex binary from the
IDE's appended PATH. If that invocation races eager activation, successful setup
reloads the window before confirming its workspace selection.

On disable or shutdown the last owning activation conditionally restores the
previous executable setting through VS Code's configuration API, with conditional
JSONC-file recovery if shutdown has already closed that API. Another enabled
window or profile keeps the shared launcher available. The official uninstall
hook provides final conditional settings cleanup. Recovery code, JSONC parsing
and bootstrap files are deployed automatically from the VSIX outside the extension
directory and use VS Code's Node runtime, so outstanding references remain usable
after removal or a crash. A small installation index under `~/.codex-switch`
records runtime locations for the uninstall hook, including custom CODEX_HOME
directories. It contains no credentials. Launchers and saved preferences remain
available for delayed references and future reinstallation.
If a client is still departing during shutdown, recovery remains selected until
the next ordinary start can retire its final writes and restore the setting.

Native API-model writes to shared defaults are journaled with their previous
scalar values and table/provider guards. Recovery restores only still-matching
owned values, retaining unrelated TOML and subsequent user changes. Credentials,
sign-in and conversations are preserved throughout disable and uninstall.

Switching reloads only the requesting window, then invokes the official new-chat
command without sending a message. Pending new-chat requests use the workbench's
window container identity from `ExtensionContext.logUri`; the telemetry session
ID changes on reload and cannot identify that request. Current Configuration
and the blue card describe the confirmed default for **new chats**. Reopening an
old conversation does not migrate it to that default. Dead, mismatched or
unconfirmed clients are never labeled Current Setting.


Native model choices are synchronized back to the workspace after successful
`config/batchWrite`, `config/value/write` or known-provider
`thread/settings/update` responses. Only model/effort identifiers are retained;
prompts, tool data and complete RPC payloads are not stored. Rejected requests,
unknown conversations and conversations using a different provider do not change
the workspace preference. Accepted events survive closing the panel or editor:
the next startup consumes the persisted event before constructing its overrides.
The sidebar updates Selected through local metadata, without refreshing provider
APIs, changing provider or reloading a working window. Codex's own user-config
writes retain their native behavior; an attempted private config-write target was
rejected by the installed app-server, so no unsupported redirection is used.
