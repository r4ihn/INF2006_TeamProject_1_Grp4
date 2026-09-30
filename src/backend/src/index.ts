// Import statements
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

loadEnv();

// Constant statements
const PORT = process.env.PORT ?? 3000;
const app = createApp();

// Server entry point
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
