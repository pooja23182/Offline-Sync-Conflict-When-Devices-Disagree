export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type DocumentData = Record<string, JsonValue>

export type Change = {
    field: string
    value: JsonValue
}

export type HistoryEntry = {
    version: number
    deviceId: string
    operationId: string
    changes: Change[]
    timestamp: string
}

export type SyncOperation = {
    operationId: string
    deviceId: string
    baseVersion: number
    changes: Change[]
}

export type SyncResult = {
    result: "ACCEPTED" | "MERGED" | "CONFLICT"
    documentId: string
    version: number
    data: DocumentData
    conflicts?: string[]
    message: string
}

export type StoredDocument = {
    id: string
    version: number
    data: DocumentData
    history: HistoryEntry[]
    operations: Record<string, SyncResult>
    createdAt: string
    updatedAt: string
}

export type Store = {
    documents: Record<string, StoredDocument>
}
