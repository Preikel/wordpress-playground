import { WebPHP, WebPHPEndpoint, exposeAPI } from '@php-wasm/web';
import { EmscriptenDownloadMonitor } from '@php-wasm/progress';
import { setURLScope } from '@php-wasm/scopes';
import { DOCROOT, wordPressSiteUrl } from './config';
import {
	getWordPressModuleDetails,
	LatestSupportedWordPressVersion,
	SupportedWordPressVersions,
	SupportedWordPressVersionsList,
} from '@wp-playground/wordpress';
import {
	SupportedPHPExtension,
	SupportedPHPVersion,
	SupportedPHPVersionsList,
	rotatePHPRuntime,
} from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import {
	FilesystemOperation,
	journalFSEvents,
	replayFSJournal,
} from '@php-wasm/fs-journal';
import {
	SyncProgressCallback,
	bindOpfs,
	playgroundAvailableInOpfs,
} from './opfs/bind-opfs';
import {
	defineSiteUrl,
	backfillSqliteMuPlugin,
	linkSnapshot,
	setSnapshot,
} from '@wp-playground/blueprints';

import { joinPaths } from '@php-wasm/util';

// post message to parent
self.postMessage('worker-script-started');

type StartupOptions = {
	wpVersion?: string;
	phpVersion?: string;
	sapiName?: string;
	storage?: string;
	phpExtension?: string[];
};
const startupOptions: StartupOptions = {};
if (typeof self?.location?.href !== 'undefined') {
	const params = new URL(self.location.href).searchParams;
	startupOptions.wpVersion = params.get('wpVersion') || undefined;
	startupOptions.phpVersion = params.get('phpVersion') || undefined;
	startupOptions.storage = params.get('storage') || undefined;
	startupOptions.sapiName = params.get('sapiName') || undefined;
	startupOptions.phpExtension = params.getAll('php-extension');
}

const requestedWPVersion = startupOptions.wpVersion || '';
const wpVersion: string = SupportedWordPressVersionsList.includes(
	requestedWPVersion
)
	? requestedWPVersion
	: LatestSupportedWordPressVersion;

const requestedPhpVersion = startupOptions.phpVersion || '';
const phpVersion: SupportedPHPVersion = SupportedPHPVersionsList.includes(
	requestedPhpVersion
)
	? (requestedPhpVersion as SupportedPHPVersion)
	: '8.0';

const phpExtensions = (startupOptions.phpExtension ||
	[]) as SupportedPHPExtension[];

let virtualOpfsRoot: FileSystemDirectoryHandle | undefined;
let virtualOpfsDir: FileSystemDirectoryHandle | undefined;
let lastOpfsDir: FileSystemDirectoryHandle | undefined;
let wordPressAvailableInOPFS = false;
if (
	startupOptions.storage === 'browser' &&
	// @ts-ignore
	typeof navigator?.storage?.getDirectory !== 'undefined'
) {
	virtualOpfsRoot = await navigator.storage.getDirectory();
	virtualOpfsDir = await virtualOpfsRoot.getDirectoryHandle('wordpress', {
		create: true,
	});
	lastOpfsDir = virtualOpfsDir;
	wordPressAvailableInOPFS = await playgroundAvailableInOpfs(virtualOpfsDir!);
}

const scope = Math.random().toFixed(16);
const scopedSiteUrl = setURLScope(wordPressSiteUrl, scope).toString();
const monitor = new EmscriptenDownloadMonitor();

// Start downloading WordPress if needed
let wordPressRequest = null;
if (!wordPressAvailableInOPFS) {
	if (requestedWPVersion.startsWith('http')) {
		// We don't know the size upfront, but we can still monitor the download.
		// monitorFetch will read the content-length response header when available.
		wordPressRequest = monitor.monitorFetch(fetch(requestedWPVersion));
	} else {
		const wpDetails = getWordPressModuleDetails(wpVersion);
		monitor.expectAssets({
			[wpDetails.url]: wpDetails.size,
		});
		wordPressRequest = monitor.monitorFetch(fetch(wpDetails.url));
	}
}

const php = new WebPHP(undefined, {
	documentRoot: DOCROOT,
	absoluteUrl: scopedSiteUrl,
});

const recreateRuntime = async () =>
	await WebPHP.loadRuntime(phpVersion, {
		downloadMonitor: monitor,
		// We don't yet support loading specific PHP extensions one-by-one.
		// Let's just indicate whether we want to load all of them.
		loadAllExtensions: phpExtensions?.length > 0,
	});

// Rotate the PHP runtime periodically to avoid memory leak-related crashes.
// @see https://github.com/WordPress/wordpress-playground/pull/990 for more context
rotatePHPRuntime({
	php,
	recreateRuntime,
	// 400 is an arbitrary number that should trigger a rotation
	// way before the memory gets too fragmented. If the memory
	// issue returns, let's explore:
	// * Lowering this number
	// * Adding a memory usage monitor and rotate based on that
	maxRequests: 400,
});

/** @inheritDoc PHPClient */
export class PlaygroundWorkerEndpoint extends WebPHPEndpoint {
	/**
	 * A string representing the scope of the Playground instance.
	 */
	scope: string;

	/**
	 * A string representing the version of WordPress being used.
	 */
	wordPressVersion: string;

	/**
	 * A string representing the version of PHP being used.
	 */
	phpVersion: string;

	constructor(
		php: WebPHP,
		monitor: EmscriptenDownloadMonitor,
		scope: string,
		wordPressVersion: string,
		phpVersion: string
	) {
		super(php, monitor);
		this.scope = scope;
		this.wordPressVersion = wordPressVersion;
		this.phpVersion = phpVersion;
	}

	/**
	 * @returns WordPress module details, including the static assets directory and default theme.
	 */
	async getWordPressModuleDetails() {
		return {
			majorVersion: this.wordPressVersion,
			staticAssetsDirectory: `wp-${this.wordPressVersion.replace(
				'_',
				'.'
			)}`,
		};
	}

	async getSupportedWordPressVersions() {
		return {
			all: SupportedWordPressVersions,
			latest: LatestSupportedWordPressVersion,
		};
	}

	async resetVirtualOpfs() {
		if (!virtualOpfsRoot) {
			throw new Error('No virtual OPFS available.');
		}
		await virtualOpfsRoot.removeEntry(virtualOpfsDir!.name, {
			recursive: true,
		});
	}

	async reloadFilesFromOpfs() {
		await this.bindOpfs(lastOpfsDir!);
	}

	async bindOpfs(
		opfs: FileSystemDirectoryHandle,
		onProgress?: SyncProgressCallback
	) {
		lastOpfsDir = opfs;
		await bindOpfs({
			php,
			opfs,
			onProgress,
		});
	}

	async journalFSEvents(
		root: string,
		callback: (op: FilesystemOperation) => void
	) {
		return journalFSEvents(php, root, callback);
	}

	async replayFSJournal(events: FilesystemOperation[]) {
		return replayFSJournal(php, events);
	}
}

const [setApiReady, setAPIError] = exposeAPI(
	new PlaygroundWorkerEndpoint(php, monitor, scope, wpVersion, phpVersion)
);

try {
	php.initializeRuntime(await recreateRuntime());

	if (startupOptions.sapiName) {
		await php.setSapiName(startupOptions.sapiName);
	}
	const docroot = php.documentRoot;

	// If WordPress isn't already installed, download and extract it from
	// the zip file.
	if (!wordPressAvailableInOPFS) {
		const snapshot = new File(
			[await (await wordPressRequest!).blob()],
			'wp.zip'
		);
		await setSnapshot(php, snapshot);
	}

	await backfillSqliteMuPlugin(php, docroot);
	await linkSnapshot(php);

	if (virtualOpfsDir) {
		await bindOpfs({
			php,
			opfs: virtualOpfsDir!,
			wordPressAvailableInOPFS,
		});
	}

	// Create phpinfo.php
	php.writeFile(joinPaths(docroot, 'phpinfo.php'), '<?php phpinfo(); ');

	// Always setup the current site URL.
	await defineSiteUrl(php, {
		siteUrl: scopedSiteUrl,
	});

	// Spawning new processes on the web is not supported,
	// let's always fail.
	php.setSpawnHandler(
		createSpawnHandler(function (_, processApi) {
			processApi.exit(1);
		})
	);

	setApiReady();
} catch (e) {
	setAPIError(e as Error);
	throw e;
}
