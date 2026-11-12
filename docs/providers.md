# API providers

All nine API-key cards use `backend/providers.json`, `backend/api_providers.py`,
`api-session.js` and `media/api-view.js`. ChatGPT subscription authentication
and usage remain separate. Private runtime state stays outside this repository.

## Setup

1. Enable the provider in **Manage Providers**. Hidden cards make no requests.
2. If necessary, use **API endpoint** for your official regional/plan URL.
   Alibaba PAYG needs your workspace hostname. Only official HTTPS hosts are
   accepted; redirects never forward credentials.
3. **Set API key** uses the native password dialog and existing OS secure store.
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
grid fills gaps with subsequent ordinary cards: ChatGPT → OpenRouter → DeepSeek
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
Recovery rearms subsequent downward crossings, including red → yellow → red.
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
