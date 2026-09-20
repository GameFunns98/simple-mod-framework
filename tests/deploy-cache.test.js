const assert = require("assert")
const fs = require("fs-extra")
const os = require("os")
const path = require("path")
const { readDeployCache } = require("../compiled/deploy-cache")

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smf-cache-test-"))
const mapPath = path.join(directory, "map.json")
const marker = path.join(directory, "cached-output.bin")
const files = { "mod/content": { hash: "abc", dependencies: ["123"], affected: ["456"] } }
const originalRead = fs.readJSONSync
let reads = 0
fs.readJSONSync = (...args) => {
	reads += 1
	return originalRead(...args)
}
const seed = (frameworkVersion, game) => {
	fs.writeJSONSync(mapPath, { frameworkVersion, game, files })
	fs.writeFileSync(marker, "cached bytes")
}

try {
	assert.deepStrictEqual(readDeployCache(directory, "2.33.42", "game-a"), {})
	assert.strictEqual(reads, 0)
	seed("2.33.42", "game-a")
	assert.deepStrictEqual(readDeployCache(directory, "2.33.42", "game-a"), files)
	assert.strictEqual(reads, 1, "valid map must only be read once")
	assert.strictEqual(fs.readFileSync(marker, "utf8"), "cached bytes")
	for (const [version, game] of [
		["2.33.41", "game-a"],
		["2.33.42", "game-b"]
	]) {
		seed(version, game)
		assert.deepStrictEqual(readDeployCache(directory, "2.33.42", "game-a"), {})
		assert.deepStrictEqual(fs.readdirSync(directory), [], "invalid cache must be emptied")
	}
	seed("2.33.43", "game-a")
	assert.deepStrictEqual(readDeployCache(directory, "2.33.42", "game-a"), files, "preserve existing newer-version behavior")
	fs.writeFileSync(mapPath, "invalid JSON")
	assert.throws(() => readDeployCache(directory, "2.33.42", "game-a"))
	assert.ok(fs.existsSync(marker), "parse errors must not silently delete the cache")
	console.log("Deploy cache: missing, valid, game update, framework update, newer version and corrupt map passed")
} finally {
	fs.readJSONSync = originalRead
	fs.removeSync(directory)
}
