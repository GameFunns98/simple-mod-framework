const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smf-manifest-cache-test-"))
const modsDirectory = path.join(testDirectory, "Mods")
const manifestDirectory = path.join(modsDirectory, "folder-a")
const manifestPath = path.join(manifestDirectory, "manifest.json")
fs.mkdirSync(manifestDirectory, { recursive: true })
fs.writeFileSync(manifestPath, '{ id: "mod-a", name: "Original", authors: ["Author"] }')

const originalReadFileSync = fs.readFileSync
let manifestReads = 0
fs.readFileSync = (...args) => {
	if (path.resolve(String(args[0])) === path.resolve(manifestPath)) {
		manifestReads += 1
	}
	return originalReadFileSync(...args)
}

const manifestCache = require("../compiled/manifest-cache")

try {
	manifestCache.refreshManifestIndex(modsDirectory)
	assert.strictEqual(manifestCache.getManifestModFolder("mod-a"), "folder-a")
	assert.strictEqual(manifestReads, 1)

	const first = manifestCache.readManifest(manifestPath)
	first.name = "Mutated consumer copy"
	const second = manifestCache.readManifest(manifestPath)
	assert.strictEqual(second.name, "Original")
	assert.strictEqual(manifestReads, 1)

	fs.writeFileSync(manifestPath, '{ id: "mod-a", name: "Updated manifest", authors: ["Author"] }')
	const future = new Date(Date.now() + 10000)
	fs.utimesSync(manifestPath, future, future)
	manifestCache.refreshManifestIndex(modsDirectory)
	assert.strictEqual(manifestCache.readManifest(manifestPath).name, "Updated manifest")
	assert.strictEqual(manifestReads, 2)

	fs.rmSync(manifestPath)
	manifestCache.refreshManifestIndex(modsDirectory)
	assert.strictEqual(manifestCache.getManifestModFolder("mod-a"), undefined)
	console.log("Manifest cache test passed")
} finally {
	fs.readFileSync = originalReadFileSync
	fs.rmSync(testDirectory, { recursive: true, force: true })
}
