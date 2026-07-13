// Apple Health plugin module declares its CLI command surface for discovery.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "apple-health",
  name: "Apple Health",
  description: "Ingest Apple Health workouts, metrics, and sleep from Health Auto Export.",
  register(api) {
    api.registerCli(
      async ({ program }) => {
        const { registerAppleHealthCli } = await import("./src/cli.js");
        registerAppleHealthCli(program);
      },
      {
        descriptors: [
          {
            name: "apple-health",
            description: "Apple Health ingestion setup",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
