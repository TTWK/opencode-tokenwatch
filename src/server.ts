import type { PluginModule } from "@opencode-ai/plugin"

const plugin: PluginModule & { id: string } = {
  id: "opencode-tokenwatch",
  server: async () => {
    return {}
  },
}

export default plugin