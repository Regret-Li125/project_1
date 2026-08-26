import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 开发模式下 @vitejs/plugin-react 会向 index.html 注入内联 preamble 脚本，
// 与页面中的严格 CSP meta 冲突导致脚本被拦截。因此仅在 dev serve 时移除该
// CSP meta；生产构建（apply: 'serve' 不生效）保持 index.html 原有严格 CSP 不变。
function devRelaxCsp(): Plugin {
  return {
    name: 'dev-relax-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>\s*/i,
        '',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), devRelaxCsp()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // 对齐 Electron 43 内置的 Chromium 150（Electron 版本升级批次会再调整）
    target: 'chrome150',
  },
})
