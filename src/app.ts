import express from "express"
import cors from "cors"
import helmet from "helmet"
import rateLimit from "express-rate-limit"
import swaggerUi from "swagger-ui-express"
import { config } from "./config"
import { createDocument, getDocument } from "./store"
import { createDocumentSchema, syncSchema } from "./validation"
import { synchronize } from "./sync"
import type { StoredDocument } from "./types"

const app = express()
app.disable("x-powered-by")
app.use(helmet())
app.use(cors({
    origin: config.corsOrigin === "*" ? true : config.corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
}))
app.use(express.json({ limit: "64kb" }))

app.use("/api/", rateLimit({
    windowMs: config.rateLimitWindowMs,
    limit: config.rateLimitMax,
    standardHeaders: "draft-7",
    legacyHeaders: false,
}))

app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "offline-sync-api" })
})

app.post("/api/documents", (req, res) => {
    const parsed = createDocumentSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({
            error: "ValidationError",
            message: "data must be a JSON object.",
            details: parsed.error.flatten(),
        })
    }

    const doc = createDocument(parsed.data.data)
    return res.status(201).json(publicDocument(doc))
})

app.get("/api/documents/:id", (req, res) => {
    const doc = getDocument(req.params.id)
    if (!doc) return res.status(404).json({ error: "NotFound", message: "Document not found." })
    return res.json(publicDocument(doc))
})

app.get("/api/documents/:id/history", (req, res) => {
    const doc = getDocument(req.params.id)
    if (!doc) return res.status(404).json({ error: "NotFound", message: "Document not found." })

    return res.json({
        documentId: doc.id,
        currentVersion: doc.version,
        history: doc.history.map(entry => ({
            version: entry.version,
            deviceId: entry.deviceId,
            operationId: entry.operationId,
            changes: entry.changes,
            timestamp: entry.timestamp,
        })),
    })
})

app.post("/api/documents/:id/sync", async (req, res) => {
    const doc = getDocument(req.params.id)
    if (!doc) return res.status(404).json({ error: "NotFound", message: "Document not found." })

    const parsed = syncSchema.safeParse(req.body)
    if (!parsed.success) {
        return res.status(400).json({
            error: "ValidationError",
            message: "Invalid synchronization request.",
            details: parsed.error.flatten().fieldErrors,
        })
    }

    const result = await synchronize(doc, parsed.data)

    if (result.result === "CONFLICT") {
        return res.status(409).json(result)
    }

    return res.status(result.result === "MERGED" ? 200 : 201).json(result)
})

function publicDocument(doc: StoredDocument) {
    return {
        id: doc.id,
        version: doc.version,
        data: doc.data,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    }
}

const openApi = {
    openapi: "3.0.3",
    info: {
        title: "Offline Sync Conflict API",
        version: "1.0.0",
        description: "Versioned synchronization API with field-level conflict detection, safe merging and idempotency.",
    },
    servers: [{ url: "http://localhost:3001" }],
    paths: {
        "/health": { get: { summary: "Health check", responses: { "200": { description: "OK" } } } },
        "/api/documents": {
            post: {
                summary: "Create a document",
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                required: ["data"],
                                properties: { data: { type: "object", additionalProperties: true } },
                            },
                        },
                    },
                },
                responses: { "201": { description: "Created" }, "400": { description: "Validation error" } },
            },
        },
        "/api/documents/{id}": {
            get: {
                summary: "Get current document state",
                parameters: [{ $ref: "#/components/parameters/documentId" }],
                responses: { "200": { description: "Current state" }, "404": { description: "Not found" } },
            },
        },
        "/api/documents/{id}/history": {
            get: {
                summary: "View version history",
                parameters: [{ $ref: "#/components/parameters/documentId" }],
                responses: { "200": { description: "History" }, "404": { description: "Not found" } },
            },
        },
        "/api/documents/{id}/sync": {
            post: {
                summary: "Synchronize device changes",
                parameters: [{ $ref: "#/components/parameters/documentId" }],
                requestBody: {
                    required: true,
                    content: {
                        "application/json": {
                            schema: { $ref: "#/components/schemas/SyncRequest" },
                        },
                    },
                },
                responses: {
                    "201": { description: "Accepted against current version" },
                    "200": { description: "Merged non-conflicting stale changes" },
                    "400": { description: "Invalid request" },
                    "404": { description: "Document not found" },
                    "409": { description: "Conflict" },
                },
            },
        },
    },
    components: {
        parameters: {
            documentId: { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        },
        schemas: {
            Change: {
                type: "object",
                required: ["field", "value"],
                properties: {
                    field: { type: "string", example: "title" },
                    value: { description: "Any JSON value" },
                },
            },
            SyncRequest: {
                type: "object",
                required: ["operationId", "deviceId", "baseVersion", "changes"],
                properties: {
                    operationId: { type: "string", example: "phone-001-op-001" },
                    deviceId: { type: "string", example: "phone-001" },
                    baseVersion: { type: "integer", example: 0 },
                    changes: { type: "array", items: { $ref: "#/components/schemas/Change" } },
                },
            },
        },
    },
}

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApi))

app.use((_req, res) => {
    res.status(404).json({ error: "NotFound", message: "Endpoint not found." })
})

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof SyntaxError) return res.status(400).json({ error: "BadRequest", message: "Malformed JSON." })
    console.error("Unhandled application error")
    return res.status(500).json({ error: "InternalServerError", message: "Unexpected server error." })
})

export default app
