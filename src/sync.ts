import type { DocumentData, StoredDocument, SyncOperation, SyncResult } from "./types"
import { cloneResult, saveDocument, withMutation } from "./store"

function valuesEqual(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b)
}

function changesByField(changes: StoredDocument["history"][number]["changes"]) {
    const map = new Map<string, unknown>()
    for (const change of changes) map.set(change.field, change.value)
    return map
}

export async function synchronize(doc: StoredDocument, operation: SyncOperation): Promise<SyncResult> {
    return withMutation(() => {
        // Idempotency: replaying the exact same operation returns the original result
        // instead of creating another version.
        const prior = doc.operations[operation.operationId]
        if (prior) return cloneResult(prior)

        if (operation.baseVersion > doc.version) {
            return {
                result: "CONFLICT",
                documentId: doc.id,
                version: doc.version,
                data: structuredClone(doc.data),
                conflicts: [],
                message: `Base version ${operation.baseVersion} is newer than server version ${doc.version}.`,
            }
        }

        // If client is current, every requested change can be accepted.
        if (operation.baseVersion === doc.version) {
            const next = structuredClone(doc.data)
            for (const change of operation.changes) next[change.field] = change.value

            const version = doc.version + 1
            const now = new Date().toISOString()
            const result: SyncResult = {
                result: "ACCEPTED",
                documentId: doc.id,
                version,
                data: next,
                message: "Changes accepted against the current server version.",
            }

            doc.data = next
            doc.version = version
            doc.updatedAt = now
            doc.history.push({
                version,
                deviceId: operation.deviceId,
                operationId: operation.operationId,
                changes: structuredClone(operation.changes),
                timestamp: now,
            })
            doc.operations[operation.operationId] = cloneResult(result)
            saveDocument(doc)
            return result
        }

        // Stale client: find fields changed on the server after the client's base version.
        const serverChangedFields = new Set<string>()
        for (const entry of doc.history) {
            if (entry.version > operation.baseVersion) {
                for (const change of entry.changes) serverChangedFields.add(change.field)
            }
        }

        const requestedFields = new Set(operation.changes.map(c => c.field))
        const conflicts = [...requestedFields].filter(field => serverChangedFields.has(field))

        if (conflicts.length > 0) {
            return {
                result: "CONFLICT",
                documentId: doc.id,
                version: doc.version,
                data: structuredClone(doc.data),
                conflicts,
                message: "Some fields changed on the server after this device's base version. No changes were applied.",
            }
        }

        // Stale but non-overlapping fields can safely coexist.
        const merged = structuredClone(doc.data)
        for (const change of operation.changes) merged[change.field] = change.value

        const version = doc.version + 1
        const now = new Date().toISOString()
        const result: SyncResult = {
            result: "MERGED",
            documentId: doc.id,
            version,
            data: merged,
            message: "The device was behind, but its changes affected fields untouched by newer server changes, so they were merged.",
        }

        doc.data = merged
        doc.version = version
        doc.updatedAt = now
        doc.history.push({
            version,
            deviceId: operation.deviceId,
            operationId: operation.operationId,
            changes: structuredClone(operation.changes),
            timestamp: now,
        })
        doc.operations[operation.operationId] = cloneResult(result)
        saveDocument(doc)
        return result
    })
}
