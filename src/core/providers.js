// Curated services only. Exact hosts are configuration,
// not a claim of live interface compatibility.
const entries = [
  ['chatgpt', 'ChatGPT', ['chatgpt.com', 'chat.openai.com'], 'https://chatgpt.com'],
  ['claude', 'Claude', ['claude.ai'], 'https://claude.com/product/overview'],
  ['gemini', 'Google Gemini', ['gemini.google.com'], 'https://gemini.google.com'],
  ['deepseek', 'DeepSeek', ['chat.deepseek.com'], 'https://www.deepseek.com'],
  ['grok', 'Grok', ['grok.com'], 'https://grok.com'],
  ['perplexity', 'Perplexity', ['www.perplexity.ai', 'perplexity.ai'], 'https://www.perplexity.ai'],
  ['copilot', 'Microsoft Copilot', ['copilot.microsoft.com'], 'https://copilot.microsoft.com'],
  ['meta', 'Meta AI', ['www.meta.ai', 'meta.ai'], 'https://www.meta.ai'],
  ['mistral', 'Mistral Chat', ['chat.mistral.ai'], 'https://chat.mistral.ai'],
  ['poe', 'Poe', ['poe.com'], 'https://poe.com'],
  ['you', 'You.com', ['you.com'], 'https://you.com'],
  ['huggingchat', 'HuggingChat', ['huggingface.co'], 'https://huggingface.co/chat'],
  ['qwen', 'Qwen', ['qwen.ai', 'chat.qwen.ai'], 'https://qwen.ai'],
  ['kimi', 'Kimi', ['www.kimi.com', 'kimi.com', 'kimi.moonshot.cn'], 'https://www.kimi.com'],
  ['doubao', 'Doubao', ['www.doubao.com', 'doubao.com'], 'https://www.doubao.com'],
  ['zai', 'Z.ai', ['chat.z.ai'], 'https://chat.z.ai'],
  ['yuanbao', 'Tencent Yuanbao', ['yuanbao.tencent.com'], 'https://yuanbao.tencent.com'],
  [
    'wenxin',
    'Baidu Wenxin',
    ['www.wenxiaoyan.com', 'yiyan.baidu.com'],
    'https://www.wenxiaoyan.com/pc',
  ],
  ['character', 'Character.AI', ['character.ai'], 'https://character.ai'],
  ['arena', 'Arena', ['arena.ai', 'lmarena.ai', 'chat.lmsys.org'], 'https://arena.ai'],
  ['aistudio', 'Google AI Studio', ['aistudio.google.com'], 'https://aistudio.google.com'],
  [
    'notebook',
    'Google Notebook',
    ['notebook.google.com', 'notebooklm.google.com'],
    'https://notebook.google.com',
  ],
  ['duck', 'Duck.ai', ['duck.ai', 'duckduckgo.com'], 'https://duck.ai'],
  ['giga', 'GigaChat', ['giga.chat', 'developers.sber.ru'], 'https://giga.chat'],
  ['alice', 'Алиса AI', ['alice.yandex.ru'], 'https://alice.yandex.ru'],
  ['jasper', 'Jasper', ['app.jasper.ai'], 'https://www.jasper.ai'],
  ['writesonic', 'Writesonic', ['app.writesonic.com'], 'https://writesonic.com'],
  ['copy', 'Copy.ai', ['app.copy.ai'], 'https://www.copy.ai'],
  [
    'cohere',
    'Cohere',
    ['dashboard.cohere.com', 'chat.cohere.com', 'coral.cohere.com'],
    'https://chat.cohere.com',
  ],
  ['reka', 'Reka', ['app.reka.ai', 'chat.reka.ai'], 'https://chat.reka.ai'],
];
export const PROVIDERS = Object.freeze(
  entries.map(([id, name, hosts, source]) =>
    Object.freeze({
      id,
      name,
      hosts: Object.freeze(hosts),
      source,
      reviewedAt: '2026-10-04',
      validation: 'controlled-fixture-only',
    }),
  ),
);
export const DEFAULT_SITES = Object.freeze(
  PROVIDERS.flatMap((provider) => provider.hosts.map((host) => Object.freeze({ host }))),
);
const providersByHost = new Map(
  PROVIDERS.flatMap((provider) => provider.hosts.map((host) => [host, provider])),
);
export function providerForHost(host) {
  return typeof host === 'string' ? providersByHost.get(host.toLowerCase()) : undefined;
}
