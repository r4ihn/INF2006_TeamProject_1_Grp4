import { loadEnv } from "../env.js";
import { loadAuthConfig } from "./config.js";
import { mintLocalToken } from "./localTokens.js";
import type { Role } from "./verifier.js";

// Usage: npm run token -- <staff|manager> [--sub alice] [--ttl 3600]
function main(): Promise<string> {
  loadEnv();
  const [role, ...rest] = process.argv.slice(2);
  if (role !== "staff" && role !== "manager") {
    throw new Error(
      "Usage: npm run token -- <staff|manager> [--sub NAME] [--ttl SECONDS]"
    );
  }
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const config = loadAuthConfig();
  if (config.mode !== "local") {
    throw new Error(
      "Tokens can only be minted with AUTH_MODE=local; in the cloud, sign in through Cognito"
    );
  }
  const sub = flag("--sub");
  const ttl = flag("--ttl");
  return mintLocalToken(config, {
    role: role as Role,
    ...(sub ? { sub } : {}),
    ...(ttl ? { ttlSeconds: Number(ttl) } : {}),
  });
}

Promise.resolve()
  .then(main)
  .then((token) => console.log(token))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
