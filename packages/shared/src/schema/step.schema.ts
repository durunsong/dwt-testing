import { z } from "zod";
import { SESSION_NAMES } from "../constants/session";
import { STEP_TYPES } from "../constants/step-types";

const dbParamSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const dbExpectedSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const apiExpectedValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const apiScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const apiJsonSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  apiScalarSchema,
  z.array(apiJsonSchema),
  z.record(z.string(), apiJsonSchema)
]));
const waitForApiSchema = z.object({
  url: z.string().min(1),
  method: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().optional(),
  expected_status: z.number().int().positive().optional(),
  business_code_path: z.string().min(1).optional(),
  success_codes: z.array(apiExpectedValueSchema).optional(),
  failure_codes: z.array(apiExpectedValueSchema).optional(),
  success: z.object({
    body_path: z.string().min(1).optional(),
    equals: apiExpectedValueSchema.optional(),
    includes: z.string().min(1).optional()
  }).optional()
});

const extractSchema = z.object({
  type: z.string().optional(),
  pattern: z.string().min(1).optional(),
  group: z.number().int().nonnegative().optional()
}).optional();

export const scenarioStepSchema = z.object({
  step_id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(STEP_TYPES),
  phase: z.enum(["beforeActions", "mainSteps", "assertions", "afterActions", "steps"]).optional(),
  session: z.enum(SESSION_NAMES).optional(),
  target: z.string().optional(),
  url: z.string().optional(),
  method: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), apiScalarSchema).optional(),
  body: apiJsonSchema.optional(),
  value: z.string().optional(),
  expected: z.union([z.string(), dbExpectedSchema]).optional(),
  expected_status: z.number().int().positive().optional(),
  body_path: z.string().min(1).optional(),
  business_code_path: z.string().min(1).optional(),
  success_codes: z.array(apiExpectedValueSchema).optional(),
  failure_codes: z.array(apiExpectedValueSchema).optional(),
  variable: z.string().optional(),
  save_as: z.string().optional(),
  sql: z.string().optional(),
  params: z.array(dbParamSchema).optional(),
  row_index: z.number().int().nonnegative().optional(),
  timeout_ms: z.number().int().positive().optional(),
  wait_for_network: z.boolean().optional(),
  wait_for_api: waitForApiSchema.optional(),
  continue_on_failure: z.boolean().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  filter_target: z.string().optional(),
  file: z.string().optional(),
  extract: extractSchema
});
