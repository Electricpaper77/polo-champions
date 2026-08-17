import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir:"tests",
  // Each live match owns a heavyweight WebGL context; serialize to avoid GPU contention.
  workers:1,
  use:{ baseURL:"http://127.0.0.1:4173", headless:true },
  webServer:[
    { command:"npm.cmd run dev -- --host 127.0.0.1 --port 4173", url:"http://127.0.0.1:4173", reuseExistingServer:true },
    { command:"npm.cmd run server:realtime", port:8080, reuseExistingServer:true },
  ],
});
