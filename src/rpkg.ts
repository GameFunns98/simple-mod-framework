import child_process from "child_process"
import fs from "fs"
import json5 from "json5"
import path from "path"

require("clarify")

const config = json5.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf8"))

type PendingRPKGCommand = {
	func: string
	resolve: (result: string) => void
	reject: (error: Error) => void
}

type InitialisationWaiter = {
	resolve: (result: string) => void
	reject: (error: Error) => void
}

class RPKGInstance {
	rpkgProcess: child_process.ChildProcessWithoutNullStreams

	output: string
	previousOutput: string

	initialised: boolean
	ready: boolean

	shouldExit: boolean

	private commandQueue: PendingRPKGCommand[]
	private activeCommand?: PendingRPKGCommand
	private initialisationWaiters: InitialisationWaiter[]
	private processError?: Error

	constructor() {
		this.rpkgProcess = child_process.spawn(path.join(process.cwd(), "Third-Party", "rpkg-cli"), ["-i"])
		this.output = ""
		this.previousOutput = ""
		this.initialised = false
		this.ready = false
		this.shouldExit = false
		this.commandQueue = []
		this.initialisationWaiters = []

		this.rpkgProcess.stdout.on("data", (data) => {
			this.output += String(data)

			if (this.output.endsWith("RPKG> ")) {
				this.handlePrompt()
			}
		})

		this.rpkgProcess.on("close", () => {
			if (!this.shouldExit) {
				this.handleProcessFailure(new Error("RPKG process exited unexpectedly"))
			}
		})

		this.rpkgProcess.on("error", (error) => this.handleProcessFailure(error))
	}

	waitForInitialised(): Promise<string> {
		if (this.processError) {
			return Promise.reject(this.processError)
		}

		if (this.initialised) {
			return Promise.resolve(this.previousOutput)
		}

		return new Promise((resolve, reject) => this.initialisationWaiters.push({ resolve, reject }))
	}

	callFunction(func: string): Promise<string> {
		if (this.processError) {
			return Promise.reject(this.processError)
		}

		if (this.shouldExit) {
			return Promise.reject(new Error("RPKG process is stopping"))
		}

		return new Promise((resolve, reject) => {
			this.commandQueue.push({ func, resolve, reject })
			this.processNextCommand()
		})
	}

	async getRPKGOfHash(hash: string): Promise<string> {
		const result = [
			...(await this.callFunction(`-hash_probe "${path.resolve(process.cwd(), config.runtimePath)}" -filter "${hash}"`)).matchAll(/is in RPKG file: (chunk[0-9]*(?:patch[1-9])?)\.rpkg/g)
		]

		return result
			.map((a) => a[1])
			.sort((a, b) => {
				const aChunk = /(chunk[0-9]*)(?:patch[0-9]*)?/gi.exec(a)![1]
				const bChunk = /(chunk[0-9]*)(?:patch[0-9]*)?/gi.exec(b)![1]

				if (aChunk.localeCompare(bChunk) !== 0) {
					return aChunk.localeCompare(bChunk, undefined, {
						numeric: true,
						sensitivity: "base"
					})
				} else {
					return b.localeCompare(a, undefined, {
						numeric: true,
						sensitivity: "base"
					})
				}
			})[0]
	}

	exit() {
		this.shouldExit = true
		this.rejectPending(new Error("RPKG process was stopped"))
		this.rpkgProcess.kill()
	}

	private handlePrompt() {
		if (!this.initialised) {
			this.initialised = true
			this.ready = false
			this.output = ""
			this.previousOutput = ""

			for (const waiter of this.initialisationWaiters) {
				waiter.resolve(this.previousOutput)
			}
			this.initialisationWaiters = []
			this.processNextCommand()
			return
		}

		this.previousOutput = this.output
		this.output = ""
		this.ready = true

		const command = this.activeCommand
		this.activeCommand = undefined

		if (command) {
			command.resolve(this.previousOutput.slice(0, -8).replace(/Running command: .*\r\n\r\n/g, ""))
		}

		this.processNextCommand()
	}

	private processNextCommand() {
		if (!this.initialised || this.activeCommand || this.commandQueue.length === 0 || this.processError || this.shouldExit) {
			return
		}

		const command = this.commandQueue.shift()!
		this.activeCommand = command
		this.ready = false

		this.rpkgProcess.stdin.write(`${command.func}\n`, (error) => {
			if (error && this.activeCommand === command) {
				this.handleProcessFailure(error)
			}
		})
	}

	private handleProcessFailure(error: Error) {
		if (this.processError) {
			return
		}

		this.processError = error
		this.rejectPending(error)

		if (!this.shouldExit) {
			console.error("Fatal error!")
			console.error("RPKG process exited unexpectedly with output:")

			for (const line of this.output.split("\n")) {
				console.log(line)
			}

			setTimeout(() => process.exit(1), 2000)
		}
	}

	private rejectPending(error: Error) {
		this.activeCommand?.reject(error)
		this.activeCommand = undefined

		for (const command of this.commandQueue) {
			command.reject(error)
		}
		this.commandQueue = []

		for (const waiter of this.initialisationWaiters) {
			waiter.reject(error)
		}
		this.initialisationWaiters = []
	}
}

export default RPKGInstance
