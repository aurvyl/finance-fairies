import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { agentApi } from './server/agentApi.ts'

export default defineConfig({
  plugins: [react(), agentApi()],
})
