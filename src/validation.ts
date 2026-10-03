import { z } from "zod"

const jsonValue: z.ZodTypeAny = z.lazy(() =>
    z.union([
        z.string(),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(jsonValue),
        z.record(jsonValue),
    ])
)

export const createDocumentSchema = z.object({
    data: z.record(jsonValue).default({}),
})

export const syncSchema = z.object({
    operationId: z.string().trim().min(8).max(200),
    deviceId: z.string().trim().min(2).max(100),
    baseVersion: z.number().int().min(0),
    changes: z.array(
        z.object({
            field: z.string().trim().min(1).max(100),
            value: jsonValue,
        })
    ).min(1).max(100),
})
