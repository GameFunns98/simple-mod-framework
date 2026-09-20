const assert = require("assert")
const fs = require("fs")
const json5 = require("json5")
const os = require("os")
const path = require("path")
const { performance } = require("perf_hooks")

const readNumberArgument = (name, fallback) => {
	const index = process.argv.indexOf(name)
	if (index === -1) return fallback

	const value = Number(process.argv[index + 1])
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`)
	}

	return value
}

const modCount = readNumberArgument("--mods", 100)
const phases = readNumberArgument("--phases", 2)
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smf-manifest-cache-benchmark-"))
const modsDirectory = path.join(testDirectory, "Mods")
fs.mkdirSync(modsDirectory)

for (let index = 0; index < modCount; index += 1) {
	const folder = path.join(modsDirectory, `folder-${String(index).padStart(4, "0")}`)
	fs.mkdirSync(folder)
	fs.writeFileSync(
		path.join(folder, "manifest.json"),
		JSON.stringify({
			id: `mod-${String(index).padStart(4, "0")}`,
			name: `Benchmark mod ${index}`,
			authors: ["Benchmark"],
			options: Array.from({ length: 20 }, (_, option) => ({ type: "checkbox", name: `Option ${option}`, contentFolders: [`content-${option}`] }))
		})
	)
}

const ids = Array.from({ length: modCount }, (_, index) => `mod-${String(index).padStart(4, "0")}`)

const legacyResolveAll = () => {
	const resolved = []
	for (const id of ids) {
		const folder = fs.readdirSync(modsDirectory).find((candidate) => {
			const manifestPath = path.join(modsDirectory, candidate, "manifest.json")
			return fs.existsSync(manifestPath) && json5.parse(fs.readFileSync(manifestPath, "utf8")).id === id
		})
		resolved.push(folder)
	}
	return resolved
}

const manifestCache = require("../compiled/manifest-cache")

try {
	let started = performance.now()
	let legacyResult
	for (let phase = 0; phase < phases; phase += 1) {
		legacyResult = legacyResolveAll()
	}
	const legacyMs = performance.now() - started

	started = performance.now()
	let cachedResult
	for (let phase = 0; phase < phases; phase += 1) {
		manifestCache.refreshManifestIndex(modsDirectory)
		cachedResult = ids.map((id) => manifestCache.getManifestModFolder(id))
	}
	const cachedMs = performance.now() - started

	assert.deepStrictEqual(cachedResult, legacyResult)
	console.log(
		JSON.stringify(
			{
				node: process.version,
				platform: `${process.platform}-${process.arch}`,
				modCount,
				phases,
				results: {
					legacyRepeatedScan: { durationMs: Number(legacyMs.toFixed(3)) },
					cachedIndex: { durationMs: Number(cachedMs.toFixed(3)) }
				},
				speedup: Number((legacyMs / cachedMs).toFixed(2)),
				estimatedManifestParses: {
					legacyRepeatedScan: phases * ((modCount * (modCount + 1)) / 2),
					cachedIndex: modCount
				}
			},
			null,
			2
		)
	)
} finally {
	fs.rmSync(testDirectory, { recursive: true, force: true })
}
