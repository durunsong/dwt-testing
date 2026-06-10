import { DbExecutor } from "@ai-e2e/runner";
import { DEFAULT_TEST_ENV } from "@ai-e2e/shared";

export class DbService {
  health() {
    return new DbExecutor({
      env: process.env.TEST_ENV ?? DEFAULT_TEST_ENV,
      enabled: process.env.DB_ENABLED === "true"
    }).health();
  }
}
