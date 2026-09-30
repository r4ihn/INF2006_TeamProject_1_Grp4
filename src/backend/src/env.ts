// Load .env into process.env for local runs. Real environment variables always win.
export function loadEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment.
  }
}
