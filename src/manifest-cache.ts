import type { Manifest } from "./types"
import fs from "fs-extra"
import json5 from "json5"
import path from "path"

type CachedManifest = {
	mtimeMs: number
	ctimeMs: number
	size: number
	manifest: Manifest
}

const manifestCache = new Map<string, CachedManifest>()
let manifestFoldersByID = new Map<string, string>()
let manifestIndexInitialised = false

const cloneManifestValue = <T>(value: T): T => {
	if (Array.isArray(value)) {
		return value.map(cloneManifestValue) as T
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, nestedValue]) => [key, cloneManifestValue(nestedValue)])) as T
	}

	return value
}

export const readManifest = (manifestPath: string): Manifest => {
	const resolvedPath = path.resolve(manifestPath)
	const stats = fs.statSync(resolvedPath)
	const cached = manifestCache.get(resolvedPath)

	if (cached && cached.mtimeMs === stats.mtimeMs && cached.ctimeMs === stats.ctimeMs && cached.size === stats.size) {
		return cloneManifestValue(cached.manifest)
	}

	const manifest: Manifest = json5.parse(fs.readFileSync(resolvedPath, "utf8"))
	manifestCache.set(resolvedPath, {
		mtimeMs: stats.mtimeMs,
		ctimeMs: stats.ctimeMs,
		size: stats.size,
		manifest
	})

	return cloneManifestValue(manifest)
}

export const refreshManifestIndex = (modsPath = path.join(process.cwd(), "Mods")) => {
	const resolvedModsPath = path.resolve(modsPath)
	const nextManifestFoldersByID = new Map<string, string>()
	const currentManifestPaths = new Set<string>()

	for (const folder of fs.readdirSync(resolvedModsPath)) {
		const manifestPath = path.join(resolvedModsPath, folder, "manifest.json")
		if (!fs.existsSync(manifestPath)) {
			continue
		}

		const resolvedManifestPath = path.resolve(manifestPath)
		currentManifestPaths.add(resolvedManifestPath)
		const manifest = readManifest(resolvedManifestPath)
		if (manifest.id && !nextManifestFoldersByID.has(manifest.id)) {
			nextManifestFoldersByID.set(manifest.id, folder)
		}
	}

	for (const cachedPath of manifestCache.keys()) {
		if (path.dirname(path.dirname(cachedPath)) === resolvedModsPath && !currentManifestPaths.has(cachedPath)) {
			manifestCache.delete(cachedPath)
		}
	}

	manifestFoldersByID = nextManifestFoldersByID
	manifestIndexInitialised = true
}

export const getManifestModFolder = (id: string): string | undefined => {
	if (!manifestIndexInitialised) {
		refreshManifestIndex()
	}

	return manifestFoldersByID.get(id)
}
