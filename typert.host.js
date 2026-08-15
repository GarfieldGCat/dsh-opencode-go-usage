// Generated-by-hand Typert host manifest for the opencodeUsage Remote.
// Uses a real zod v4 schema because the typert-loader and typert-registry
// expect strict codecs to be backed by zod v4 (the schema carries `_zod`).
// The local `link:` install resolves zod from this package's own node_modules.
import { z } from "zod";

const windowSchema = z.object({
  status: z.string().nullable(),
  percent: z.number().nullable(),
  resetsAt: z.string().nullable(),
});

const resultSchema = z.object({
  configured: z.boolean(),
  reason: z.string().nullable(),
  error: z.string().nullable(),
  usage: z.object({
    rolling: windowSchema.nullable(),
    weekly: windowSchema.nullable(),
    monthly: windowSchema.nullable(),
  }).nullable(),
});

export const TYPERT = {
  package: "dsh-opencode-go-usage",
  face: "host",
  schemas: [],
  invocations: [
    {
      id: "dsh-opencode-go-usage#opencodeUsage/usage",
      service: "opencodeUsage",
      namespace: "opencodeUsage",
      method: "usage",
      invocation: { kind: "direct" },
      parameters: [],
      result: {
        mode: "strict",
        typeSymbol: "dsh-opencode-go-usage#OpencodeUsageResult",
        schema: resultSchema,
      },
    },
  ],
  model: { services: [], events: [], objects: [] },
};
