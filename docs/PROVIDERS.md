# Provider coverage

AI Leak Guard Public includes **30 curated services** with exact host entries in `src/core/providers.js`. It does not include the commercial project's imported directory catalog. Entries are configuration, not a "top 30" ranking or proof that every live service is leak-proof.

The guard uses semantic editable fields, accessible action names, form association and open shadow roots. Controlled browser fixtures demonstrate the generic guard/handoff behavior under configured hostnames. They do not establish authenticated live compatibility, current availability, real upload handling or programmatic network interception. Some configured entries use broad shared hostnames; review that scope before deployment.

| Service           | Exact configured hosts                                        | Source                                                | Live validation                  |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| ChatGPT           | `chatgpt.com`, `chat.openai.com`                              | [Official entry](https://chatgpt.com)                 | Configured; live flow unverified |
| Claude            | `claude.ai`                                                   | [Official entry](https://claude.com/product/overview) | Configured; live flow unverified |
| Google Gemini     | `gemini.google.com`                                           | [Official entry](https://gemini.google.com)           | Configured; live flow unverified |
| DeepSeek          | `chat.deepseek.com`                                           | [Official entry](https://www.deepseek.com)            | Configured; live flow unverified |
| Grok              | `grok.com`                                                    | [Official entry](https://grok.com)                    | Configured; live flow unverified |
| Perplexity        | `www.perplexity.ai`, `perplexity.ai`                          | [Official entry](https://www.perplexity.ai)           | Configured; live flow unverified |
| Microsoft Copilot | `copilot.microsoft.com`                                       | [Official entry](https://copilot.microsoft.com)       | Configured; live flow unverified |
| Meta AI           | `www.meta.ai`, `meta.ai`                                      | [Official entry](https://www.meta.ai)                 | Configured; live flow unverified |
| Mistral Chat      | `chat.mistral.ai`                                             | [Official entry](https://chat.mistral.ai)             | Configured; live flow unverified |
| Poe               | `poe.com`                                                     | [Official entry](https://poe.com)                     | Configured; live flow unverified |
| You.com           | `you.com`                                                     | [Official entry](https://you.com)                     | Configured; live flow unverified |
| HuggingChat       | `huggingface.co`                                              | [Official entry](https://huggingface.co/chat)         | Configured; live flow unverified |
| Qwen              | `qwen.ai`, `chat.qwen.ai`                                     | [Official entry](https://qwen.ai)                     | Configured; live flow unverified |
| Kimi              | `www.kimi.com`, `kimi.com`, `kimi.moonshot.cn`                | [Official entry](https://www.kimi.com)                | Configured; live flow unverified |
| Doubao            | `www.doubao.com`, `doubao.com`                                | [Official entry](https://www.doubao.com)              | Configured; live flow unverified |
| Z.ai              | `chat.z.ai`                                                   | [Official entry](https://chat.z.ai)                   | Configured; live flow unverified |
| Tencent Yuanbao   | `yuanbao.tencent.com`                                         | [Official entry](https://yuanbao.tencent.com)         | Configured; live flow unverified |
| Baidu Wenxin      | `www.wenxiaoyan.com`, `yiyan.baidu.com`                       | [Official entry](https://www.wenxiaoyan.com/pc)       | Configured; live flow unverified |
| Character.AI      | `character.ai`                                                | [Official entry](https://character.ai)                | Configured; live flow unverified |
| Arena             | `arena.ai`, `lmarena.ai`, `chat.lmsys.org`                    | [Official entry](https://arena.ai)                    | Configured; live flow unverified |
| Google AI Studio  | `aistudio.google.com`                                         | [Official entry](https://aistudio.google.com)         | Configured; live flow unverified |
| Google Notebook   | `notebook.google.com`, `notebooklm.google.com`                | [Official entry](https://notebook.google.com)         | Configured; live flow unverified |
| Duck.ai           | `duck.ai`, `duckduckgo.com`                                   | [Official entry](https://duck.ai)                     | Configured; live flow unverified |
| GigaChat          | `giga.chat`, `developers.sber.ru`                             | [Official entry](https://giga.chat)                   | Configured; live flow unverified |
| Алиса AI          | `alice.yandex.ru`                                             | [Official entry](https://alice.yandex.ru)             | Configured; live flow unverified |
| Jasper            | `app.jasper.ai`                                               | [Official entry](https://www.jasper.ai)               | Configured; live flow unverified |
| Writesonic        | `app.writesonic.com`                                          | [Official entry](https://writesonic.com)              | Configured; live flow unverified |
| Copy.ai           | `app.copy.ai`                                                 | [Official entry](https://www.copy.ai)                 | Configured; live flow unverified |
| Cohere            | `dashboard.cohere.com`, `chat.cohere.com`, `coral.cohere.com` | [Official entry](https://chat.cohere.com)             | Configured; live flow unverified |
| Reka              | `app.reka.ai`, `chat.reka.ai`                                 | [Official entry](https://chat.reka.ai)                | Configured; live flow unverified |

Adding a provider requires a reviewed source/catalog and manifest update, followed by tests and a rebuilt package. Personal settings cannot enable arbitrary hosts or advanced label adapters.

A hostname redirect or new app subdomain is outside the configured entry until separately authorized. Native/API traffic, unconfigured sites, missing site permission and disabled extensions are outside this guard. A DOM extension cannot guarantee every network transmission. Current check results are recorded separately in [validation](VALIDATION.md).
