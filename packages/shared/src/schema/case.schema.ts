import { z } from "zod";
import { SESSION_NAMES } from "../constants/session";
import { scenarioStepSchema } from "./step.schema";

export const scenarioSessionSchema = z.object({
  name: z.enum(SESSION_NAMES),
  login_url: z.string().min(1),
  username: z.string().optional(),
  password: z.string().optional()
}).catchall(z.string().optional());

export const scenarioCaseSchema = z.object({
  case_id: z.string().min(1),
  case_name: z.string().min(1),
  case_type: z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/).default("uncategorized"),
  description: z.string().optional(),
  mode: z.enum(["web", "api", "hybrid"]).default("web"),
  defaults: z.object({
    step_timeout_ms: z.number().int().positive().optional(),
    wait_for_network: z.boolean().optional(),
    manual_review_on_failure: z.boolean().optional()
  }).optional(),
  sessions: z.array(scenarioSessionSchema).min(1),
  variables: z.record(z.string(), z.string()).optional(),
  locations: z.object({
    file: z.string().min(1)
  }),
  upload_slots: z.array(scenarioStepSchema).optional(),
  steps: z.array(scenarioStepSchema).min(1)
});
