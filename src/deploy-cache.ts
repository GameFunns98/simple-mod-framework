import fs from "fs-extra"
import path from "path"

type FileMap = Record<string, { hash: string; dependencies: string[]; affected: string[] }>

// Read once per deployment. Do not retain this snapshot across deployments.
export function readDeployCache(cacheDirectory: string, frameworkVersion: string, gameHash: string): FileMap {
	const mapPath = path.join(cacheDirectory, "map.json")
	if (!fs.existsSync(mapPath)) {
		return {}
	}

	const cached: { frameworkVersion: string; game: string; files: FileMap } = fs.readJSONSync(mapPath)
	// Preserve the existing version comparison and whole-cache invalidation policy.
	if (cached.frameworkVersion < frameworkVersion || cached.game !== gameHash) {
		fs.emptyDirSync(cacheDirectory)
		return {}
	}

	return cached.files
}
