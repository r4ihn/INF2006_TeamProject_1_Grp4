// Import statements
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";
import { jsonLogger } from "./logger.js";

loadEnv();

// Constant statements
const PORT = process.env.PORT ?? 3000;
const app = createApp({ log: jsonLogger });

// Server entry point
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
