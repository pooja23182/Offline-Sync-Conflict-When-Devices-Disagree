import fs from "node:fs"
import path from "node:path"

export function dbResetForTests() {
    const p = path.resolve("./data/test-store.json")
    if (fs.existsSync(p)) fs.unlinkSync(p)
    // The app's module-level store is intentionally simple. Tests use a fresh process/module
    // in normal CI; this helper exists to document the expected isolated data file.
}
