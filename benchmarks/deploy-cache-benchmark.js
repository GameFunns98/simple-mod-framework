const assert = require("assert")
const fs = require("fs-extra")
const os = require("os")
const path = require("path")
const md5File = require("md5-file")
const { performance } = require("perf_hooks")
const { readDeployCache } = require("../compiled/deploy-cache")

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smf-cache-bench-"))
try {
	const gamePath = path.join(directory, "synthetic-game.bin")
	const cachePath = path.join(directory, "cache")
	fs.ensureDirSync(cachePath)
	fs.writeFileSync(gamePath, Buffer.alloc(16 * 1024 * 1024, 65))
	const files = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`mod/file-${i}`, { hash: `${i}`, dependencies: ["abc"], affected: ["def"] }]))
	const mapPath = path.join(cachePath, "map.json")
	fs.writeJSONSync(mapPath, { frameworkVersion: "2.33.42", game: md5File.sync(gamePath), files })
	const legacy = () => {
		md5File.sync(gamePath) // platform detection
		assert.strictEqual(fs.readJSONSync(mapPath).frameworkVersion, "2.33.42")
		assert.strictEqual(fs.readJSONSync(mapPath).game, md5File.sync(gamePath))
		return { files: fs.readJSONSync(mapPath).files, game: md5File.sync(gamePath) }
	}
	const optimized = () => {
		const game = md5File.sync(gamePath)
		return { files: readDeployCache(cachePath, "2.33.42", game), game }
	}
	const samples = { legacy: [], optimized: [] }
	for (let i = 0; i < 5; i += 1) {
		const order =
			i % 2
				? [
						["optimized", optimized],
						["legacy", legacy]
				  ]
				: [
						["legacy", legacy],
						["optimized", optimized]
				  ]
		for (const [name, run] of order) {
			const start = performance.now()
			const result = run()
			samples[name].push(performance.now() - start)
			assert.deepStrictEqual(result.files, files)
			assert.strictEqual(result.game, md5File.sync(gamePath))
		}
	}
	const median = (values) => [...values].sort((a, b) => a - b)[2]
	const mapBytes = fs.statSync(mapPath).size
	console.log(
		JSON.stringify(
			{
				node: process.version,
				samples: 5,
				fileEntries: 10000,
				gameBytes: fs.statSync(gamePath).size,
				mapBytes,
				legacyMedianMs: median(samples.legacy),
				optimizedMedianMs: median(samples.optimized),
				speedup: median(samples.legacy) / median(samples.optimized),
				legacyBytesRead: 3 * (fs.statSync(gamePath).size + mapBytes),
				optimizedBytesRead: fs.statSync(gamePath).size + mapBytes,
				note: "Synthetic cache bookkeeping only; excludes deployment, copying and telemetry. Alternating run order."
			},
			null,
			2
		)
	)
} finally {
	fs.removeSync(directory)
}
