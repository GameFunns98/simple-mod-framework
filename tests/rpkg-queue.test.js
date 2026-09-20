const assert = require("assert")
const childProcess = require("child_process")
const { EventEmitter } = require("events")

const originalSpawn = childProcess.spawn
const commands = []

class FakeRPKGProcess extends EventEmitter {
	constructor() {
		super()
		this.stdout = new EventEmitter()
		this.stdin = {
			write: (input, callback) => {
				const command = input.trimEnd()
				commands.push(command)
				callback?.()

				if (command === "hold") {
					return true
				}

				setImmediate(() => {
					this.stdout.emit("data", `Running command: ${command}\r\n\r\nresponse:${command}\r\nRPKG> `)
				})

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

const run = async () => {
	const rpkg = new RPKGInstance()
	const initialised = Promise.all([rpkg.waitForInitialised(), rpkg.waitForInitialised()])
	const pending = [rpkg.callFunction("first"), rpkg.callFunction("second"), rpkg.callFunction("third")]

	assert.deepStrictEqual(await initialised, ["", ""])
	const results = await Promise.all(pending)

	assert.deepStrictEqual(commands, ["first", "second", "third"])
	assert.deepStrictEqual(results, ["response:first", "response:second", "response:third"])
	assert.strictEqual(rpkg.ready, true)

	const held = rpkg.callFunction("hold")
	const queued = rpkg.callFunction("after-hold")
	const heldRejection = assert.rejects(held, /was stopped/)
	const queuedRejection = assert.rejects(queued, /was stopped/)
	rpkg.exit()
	await Promise.all([heldRejection, queuedRejection])
	await assert.rejects(rpkg.callFunction("after-exit"), /is stopping/)
	assert.deepStrictEqual(commands, ["first", "second", "third", "hold"])

	childProcess.spawn = originalSpawn
	console.log("RPKG queue test passed")
}

run().catch((error) => {
	childProcess.spawn = originalSpawn
	console.error(error)
	process.exitCode = 1
})
