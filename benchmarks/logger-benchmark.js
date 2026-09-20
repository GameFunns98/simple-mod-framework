const crypto = require("crypto")
const fs = require("fs")
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

const entries = readNumberArgument("--entries", 2000)
const samples = readNumberArgument("--samples", 5)
const payloadBytes = readNumberArgument("--payload-bytes", 128)
const payload = "x".repeat(payloadBytes)
const lines = Array.from({ length: entries }, (_, index) => `\nINFO\tBenchmark\t${index}\t${payload}`)
const expected = lines.join("")
const expectedHash = crypto.createHash("sha256").update(expected).digest("hex")

const strategies = {
	legacyRewrite(filePath) {
		let deployLog = ""
		let bytesWritten = 0

		for (const line of lines) {
			deployLog += line
			fs.writeFileSync(filePath, deployLog)
			bytesWritten += Buffer.byteLength(deployLog)
		}

		return bytesWritten
	},
	sequentialWrite(filePath) {
		let bytesWritten = 0
		const file = fs.openSync(filePath, "w")

		try {
			for (const line of lines) {
				fs.writeSync(file, line)
				bytesWritten += Buffer.byteLength(line)
			}
		} finally {
			fs.closeSync(file)
		}

		return bytesWritten
	}
}

const benchmarkDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smf-logger-benchmark-"))

try {
	const results = {}

	for (const [name, run] of Object.entries(strategies)) {
		const durationsMs = []
		let bytesWritten = 0

		for (let sample = 0; sample < samples; sample += 1) {
			const filePath = path.join(benchmarkDirectory, `${name}-${sample}.log`)
			const started = performance.now()
			bytesWritten = run(filePath)
			durationsMs.push(performance.now() - started)

			const actual = fs.readFileSync(filePath)
			const actualHash = crypto.createHash("sha256").update(actual).digest("hex")
			if (actualHash !== expectedHash) {
				throw new Error(`${name} produced different log contents`)
			}
		}

		durationsMs.sort((left, right) => left - right)
		results[name] = {
			medianMs: Number(durationsMs[Math.floor(durationsMs.length / 2)].toFixed(3)),
			minMs: Number(durationsMs[0].toFixed(3)),
			maxMs: Number(durationsMs[durationsMs.length - 1].toFixed(3)),
			bytesWritten
		}
	}

	console.log(
		JSON.stringify(
			{
				node: process.version,
				platform: `${process.platform}-${process.arch}`,
				entries,
				samples,
				payloadBytes,
				finalLogBytes: Buffer.byteLength(expected),
				contentSha256: expectedHash,
				results,
				speedup: Number((results.legacyRewrite.medianMs / results.sequentialWrite.medianMs).toFixed(2)),
				writeReduction: Number((results.legacyRewrite.bytesWritten / results.sequentialWrite.bytesWritten).toFixed(2))
			},
			null,
			2
		)
	)
} finally {
	fs.rmSync(benchmarkDirectory, { recursive: true, force: true })
}
