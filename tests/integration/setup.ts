import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test" });
process.env.ZECWISE_ALLOW_PRIVATE_HOSTS = "1";
process.env.INGEST_PER_HOST_DELAY_MS = "0";
// Integration tests exercise keyword retrieval and the pipeline without paid providers.
delete process.env.VOYAGE_API_KEY;
delete process.env.TAVILY_API_KEY;
delete process.env.BRAVE_SEARCH_API_KEY;
