import { startServer } from "./index.js";

startServer(Number(process.env.PORT ?? 8080)).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("failed to start collabtext server:", err);
  process.exit(1);
});
