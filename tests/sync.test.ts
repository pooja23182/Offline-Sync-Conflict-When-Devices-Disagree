import { beforeEach, describe, expect, it } from "vitest"
import request from "supertest"

process.env.DATA_FILE = "./data/test-store.json"
process.env.CORS_ORIGIN = "*"

const { default: app } = await import("../src/app")
const { dbResetForTests } = await import("../tests/test-store")

describe("Offline sync conflict detection", () => {
    beforeEach(() => dbResetForTests())

    it("accepts changes from a device on the current version", async () => {
        const created = await request(app).post("/api/documents").send({
            data: { title: "Original", color: "blue" },
        })
        const id = created.body.id

        const res = await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "laptop-op-001",
            deviceId: "laptop",
            baseVersion: 0,
            changes: [{ field: "title", value: "Updated" }],
        })

        expect(res.status).toBe(201)
        expect(res.body.result).toBe("ACCEPTED")
        expect(res.body.version).toBe(1)
        expect(res.body.data.title).toBe("Updated")
    })

    it("merges stale changes when fields do not overlap", async () => {
        const created = await request(app).post("/api/documents").send({
            data: { title: "Original", color: "blue" },
        })
        const id = created.body.id

        await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "phone-op-001",
            deviceId: "phone",
            baseVersion: 0,
            changes: [{ field: "title", value: "Phone title" }],
        })

        const res = await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "laptop-op-001",
            deviceId: "laptop",
            baseVersion: 0,
            changes: [{ field: "color", value: "green" }],
        })

        expect(res.status).toBe(200)
        expect(res.body.result).toBe("MERGED")
        expect(res.body.data.title).toBe("Phone title")
        expect(res.body.data.color).toBe("green")
    })

    it("rejects stale overlapping changes without overwriting newer data", async () => {
        const created = await request(app).post("/api/documents").send({
            data: { title: "Original" },
        })
        const id = created.body.id

        await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "phone-op-001",
            deviceId: "phone",
            baseVersion: 0,
            changes: [{ field: "title", value: "Phone title" }],
        })

        const res = await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "laptop-op-001",
            deviceId: "laptop",
            baseVersion: 0,
            changes: [{ field: "title", value: "Laptop title" }],
        })

        expect(res.status).toBe(409)
        expect(res.body.result).toBe("CONFLICT")
        expect(res.body.conflicts).toEqual(["title"])

        const current = await request(app).get(`/api/documents/${id}`)
        expect(current.body.data.title).toBe("Phone title")
        expect(current.body.version).toBe(1)
    })

    it("is idempotent when the same operation is submitted twice", async () => {
        const created = await request(app).post("/api/documents").send({ data: { count: 0 } })
        const id = created.body.id
        const payload = {
            operationId: "phone-op-repeat",
            deviceId: "phone",
            baseVersion: 0,
            changes: [{ field: "count", value: 1 }],
        }

        const first = await request(app).post(`/api/documents/${id}/sync`).send(payload)
        const second = await request(app).post(`/api/documents/${id}/sync`).send(payload)

        expect(first.body.version).toBe(1)
        expect(second.body.version).toBe(1)
        expect(second.body.result).toBe("ACCEPTED")

        const current = await request(app).get(`/api/documents/${id}`)
        expect(current.body.version).toBe(1)
    })

    it("rejects a future base version", async () => {
        const created = await request(app).post("/api/documents").send({ data: { count: 0 } })
        const id = created.body.id

        const res = await request(app).post(`/api/documents/${id}/sync`).send({
            operationId: "future-op-001",
            deviceId: "phone",
            baseVersion: 99,
            changes: [{ field: "count", value: 2 }],
        })

        expect(res.status).toBe(409)
        expect(res.body.result).toBe("CONFLICT")
    })
})
