const assert = require("assert")
const childProcess = require("child_process")
const { EventEmitter } = require("events")
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

const commandCount = readNumberArgument("--commands", 25)
const samples = readNumberArgument("--samples", 3)
const responseDelayMs = readNumberArgument("--response-delay-ms", 5)
const pollingIntervalMs = readNumberArgument("--polling-interval-ms", 100)
const originalSpawn = childProcess.spawn

class FakeRPKGProcess extends EventEmitter {
	constructor() {
		super()
		this.stdout = new EventEmitter()
		this.stdin = {
			write: (input, callback) => {
				const command = input.trimEnd()
				callback?.()
				setTimeout(() => this.stdout.emit("data", `Running command: ${command}\r\n\r\nresponse:${command}\r\nRPKG> `), responseDelayMs)
				return true
			}
		}

		setImmediate(() => this.stdout.emit("data", "RPKG> "))
	}

	kill() {
		setImmediate(() => this.emit("close"))
		return true
	}
}

childProcess.spawn = () => new FakeRPKGProcess()
const RPKGInstance = require("../compiled/rpkg").default

const waitForPolledResponse = () =>
	new Promise((resolve) => {
		let ready = false
		setTimeout(() => {
			ready = true
		}, responseDelayMs)

		const poll = () => {
			if (ready) {
				resolve()
			} else {
				setTimeout(poll, pollingIntervalMs)
			}
		}

		poll()
	})

const median = (values) => {
	const sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.floor(sorted.length / 2)]
}

const run = async () => {
	const pollingSamples = []
	const queueSamples = []

	for (let sample = 0; sample < samples; sample += 1) {
		let started = performance.now()
		for (let command = 0; command < commandCount; command += 1) {
			await waitForPolledResponse()
		}
		pollingSamples.push(performance.now() - started)

		const rpkg = new RPKGInstance()
		await rpkg.waitForInitialised()
		started = performance.now()
		const results = await Promise.all(Array.from({ length: commandCount }, (_, command) => rpkg.callFunction(`command-${command}`)))
		queueSamples.push(performance.now() - started)

		assert.deepStrictEqual(
			results,
			Array.from({ length: commandCount }, (_, command) => `response:command-${command}`)
		)
		rpkg.exit()
	}

	const pollingMedianMs = median(pollingSamples)
	const eventQueueMedianMs = median(queueSamples)
	console.log(
		JSON.stringify(
			{
				node: process.version,
				platform: `${process.platform}-${process.arch}`,
				commandCount,
				samples,
				responseDelayMs,
				pollingIntervalMs,
				results: {
					legacyPolling: { medianMs: Number(pollingMedianMs.toFixed(3)) },
					eventQueue: { medianMs: Number(eventQueueMedianMs.toFixed(3)) }
				},
				speedup: Number((pollingMedianMs / eventQueueMedianMs).toFixed(2))
			},
			null,
			2
		)
	)
}

run()
	.catch((error) => {
		console.error(error)
		process.exitCode = 1
	})
	.finally(() => {
		childProcess.spawn = originalSpawn
	})
