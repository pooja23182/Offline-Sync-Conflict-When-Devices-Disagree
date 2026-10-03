import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { config } from "./config"
import type { DocumentData, StoredDocument, Store, SyncResult } from "./types"

const absolutePath = path.resolve(config.dataFile)
fs.mkdirSync(path.dirname(absolutePath), { recursive: true })

function loadStore(): Store {
    if (!fs.existsSync(absolutePath)) return { documents: {} }
    try {
        return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as Store
    } catch {
        throw new Error(`Cannot parse data file: ${absolutePath}`)
    }
}

let store = loadStore()

// All mutations are serialized in-process. This prevents two overlapping HTTP
// requests from reading the same version and both writing version N+1.
let mutationQueue = Promise.resolve()

export async function withMutation<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = mutationQueue
    let release!: () => void
    mutationQueue = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
        return await fn()
    } finally {
        release()
    }
}

function persist() {
    const temp = `${absolutePath}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf8")
    fs.renameSync(temp, absolutePath)
}

export function getDocument(id: string) {
    return store.documents[id]
}

export function createDocument(data: DocumentData): StoredDocument {
    const now = new Date().toISOString()
    const doc: StoredDocument = {
        id: crypto.randomUUID(),
        version: 0,
        data: structuredClone(data),
        history: [],
        operations: {},
        createdAt: now,
        updatedAt: now,
    }
    store.documents[doc.id] = doc
    persist()
    return doc
}

export function saveDocument(doc: StoredDocument) {
    store.documents[doc.id] = doc
    persist()
}

export function cloneResult(result: SyncResult): SyncResult {
    return structuredClone(result)
}
