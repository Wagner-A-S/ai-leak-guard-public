export const isExtension = !!(globalThis.browser?.runtime?.id || globalThis.chrome?.runtime?.id);
const previewStorage = {
  async get(key) {
    const raw = localStorage.getItem(`guard-${key}`);
    return raw ? { [key]: JSON.parse(raw) } : {};
  },
  async set(values) {
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(`guard-${key}`, JSON.stringify(value));
  },
};
export const api = isExtension
  ? globalThis.browser || globalThis.chrome
  : {
      storage: {
        local: previewStorage,
        managed: {
          async get() {
            return {};
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: { getURL: (path) => path },
      tabs: {
        async sendMessage() {
          throw new Error('Install the browser extension to send to a provider.');
        },
        async get() {
          throw new Error('No browser tab connected in preview.');
        },
      },
    };
