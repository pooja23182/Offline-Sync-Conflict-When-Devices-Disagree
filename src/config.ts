import "dotenv/config"

export const config = {
    port: Number(process.env.PORT ?? 3001),
    dataFile: process.env.DATA_FILE ?? "./data/store.json",
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3001",
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900000),
    rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 200),
}
