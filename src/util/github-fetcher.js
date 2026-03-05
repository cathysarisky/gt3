// @ts-check
const {env} = require('node:process');

const GITHUB_API = 'https://api.github.com';

function getHeaders() {
	/** @type {Record<string, string>} */
	const headers = {Accept: 'application/vnd.github.v3+json', 'User-Agent': 'gt3'};
	if (env.GITHUB_TOKEN) {
		headers.Authorization = `token ${env.GITHUB_TOKEN}`;
	}

	return headers;
}

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function githubGet(url) {
	const response = await fetch(url, {headers: getHeaders()});
	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
	}

	return response.json();
}

/**
 * Fetch the contents of a single file from GitHub.
 * @param {string} repo - e.g. "TryGhost/Casper"
 * @param {string} ref - e.g. "main"
 * @param {string} filePath - path within the repo
 * @returns {Promise<string>}
 */
async function fetchFileContent(repo, ref, filePath) {
	const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}?ref=${ref}`;
	const data = await githubGet(url);
	if (data.encoding !== 'base64') {
		throw new Error(`Unexpected encoding "${data.encoding}" for ${repo}/${filePath}`);
	}

	return Buffer.from(data.content, 'base64').toString('utf8');
}

/**
 * List directory entries from the GitHub Contents API (non-recursive, one level).
 * @param {string} repo
 * @param {string} ref
 * @param {string} dirPath
 * @returns {Promise<Array<{name: string, path: string, type: string}>>}
 */
async function listDirectory(repo, ref, dirPath) {
	const url = `${GITHUB_API}/repos/${repo}/contents/${dirPath}?ref=${ref}`;
	const data = await githubGet(url);
	if (!Array.isArray(data)) {
		throw new Error(`Expected directory listing for ${repo}/${dirPath}, got a single file`);
	}

	return data;
}

/**
 * Recursively collect all .hbs file paths under a directory in a GitHub repo.
 * @param {string} repo
 * @param {string} ref
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
async function listHbsFilesRecursive(repo, ref, dirPath) {
	const entries = await listDirectory(repo, ref, dirPath);
	/** @type {string[]} */
	const results = [];
	/** @type {Promise<string[]>[]} */
	const subdirPromises = [];

	for (const entry of entries) {
		if (entry.type === 'file' && entry.name.endsWith('.hbs')) {
			results.push(entry.path);
		} else if (entry.type === 'dir') {
			subdirPromises.push(listHbsFilesRecursive(repo, ref, entry.path));
		}
	}

	const subdirResults = await Promise.all(subdirPromises);
	for (const files of subdirResults) {
		results.push(...files);
	}

	return results;
}

/**
 * Fetch all .hbs files from a GitHub repo (or a subpath within it).
 *
 * @param {object} options
 * @param {string} options.repo - e.g. "TryGhost/Casper"
 * @param {string} options.ref - e.g. "main"
 * @param {string} [options.path] - optional subpath within the repo
 * @param {string[]} [options.files] - optional allowlist of specific filenames
 * @returns {Promise<Array<{path: string, contents: string}>>}
 */
async function fetchHbsFiles({repo, ref, path: subpath, files: allowlist}) {
	const basePath = subpath || '';

	if (allowlist && allowlist.length > 0) {
		const promises = allowlist
			.filter((f) => f.endsWith('.hbs'))
			.map(async (fileName) => {
				const filePath = basePath ? `${basePath}/${fileName}` : fileName;
				const contents = await fetchFileContent(repo, ref, filePath);
				return {path: fileName, contents};
			});
		return Promise.all(promises);
	}

	const hbsPaths = await listHbsFilesRecursive(repo, ref, basePath);

	const promises = hbsPaths.map(async (filePath) => {
		const contents = await fetchFileContent(repo, ref, filePath);
		const relativePath = basePath ? filePath.slice(basePath.length + 1) : filePath;
		return {path: relativePath, contents};
	});

	return Promise.all(promises);
}

module.exports.fetchHbsFiles = fetchHbsFiles;
