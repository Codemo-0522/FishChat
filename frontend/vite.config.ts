import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',  // 修改为正确的后端地址
        changeOrigin: true,
        secure: false,
        ws: true // 启用WebSocket代理
      }
    }
  },
  css: {
    modules: {
      localsConvention: 'camelCase',
      generateScopedName: '[name]__[local]__[hash:base64:5]'
    }
  },
  // 仅在生产环境移除所有 console 和 debugger 调用
  esbuild: mode === 'production' ? { drop: ['console', 'debugger'] } : undefined
})) 