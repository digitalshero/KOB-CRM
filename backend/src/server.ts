import { app } from "./app.js";
import { config } from "./config/index.js";

const server = app.listen(config.port, () => {
  console.log(`[Backend Server] Running on http://localhost:${config.port}`);
  console.log(`[Backend Server] Environment: ${config.nodeEnv}`);
});

process.on("SIGTERM", () => {
  console.log("[Backend Server] SIGTERM received. Closing HTTP server...");
  server.close(() => {
    console.log("[Backend Server] HTTP server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[Backend Server] SIGINT received. Closing HTTP server...");
  server.close(() => {
    console.log("[Backend Server] HTTP server closed.");
    process.exit(0);
  });
});
