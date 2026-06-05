import type { zh } from './zh.js';

/** 英文词典:typeof zh 钉死 key 与签名——漏译/签名不符直接编译失败。 */
export const en: typeof zh = {
  clipboardNoImage: 'No image in clipboard',
  officeReady: (n: number) => `✅ Office ready: ${n} workers + console. Ctrl-C to wrap up.`,
};
