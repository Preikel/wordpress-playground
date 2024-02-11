import { PHPResponse } from '@php-wasm/universal';
import { StepHandler } from '.';
import { phpVar, splitShellCommand } from '@php-wasm/util';

/**
 * @inheritDoc wpCLI
 * @hasRunnableExample
 * @example
 *
 * <code>
 * {
 * 		"step": "wpCLI",
 * 		"command": "wp post create --post_title='Test post' --post_excerpt='Some content'"
 * }
 * </code>
 */
export interface WPCLIStep {
	/** The step identifier. */
	step: 'wp-cli';
	/** The WP CLI command to run. */
	command: string | string[];
	/** wp-cli.phar path */
	wpCliPath?: string;
}

/**
 * Runs PHP code.
 */
export const wpCLI: StepHandler<WPCLIStep, Promise<PHPResponse>> = async (
	playground,
	{ command, wpCliPath = '/tmp/wp-cli.phar' }
) => {
	if (!(await playground.fileExists(wpCliPath))) {
		throw new Error(`wp-cli.phar not found at ${wpCliPath}`);
	}

	let args: string[];
	if (typeof command === 'string') {
		command = command.trim();
		args = splitShellCommand(command);
	} else {
		args = command;
	}

	const cmd = args.shift();
	if (cmd !== 'wp') {
		throw new Error(`The first argument must be "wp".`);
	}

	await playground.writeFile('/tmp/stdout', '');
	await playground.writeFile('/tmp/stderr', '');
	await playground.writeFile(
		'/wordpress/run-cli.php',
		`<?php
		// Set up the environment to emulate a shell script
		// call.

		// Set SHELL_PIPE to 0 to ensure WP-CLI formats
		// the output as ASCII tables.
		// @see https://github.com/wp-cli/wp-cli/issues/1102
		putenv( 'SHELL_PIPE=0' );

		// Set the argv global.
		$GLOBALS['argv'] = array_merge([
		  "/tmp/wp-cli.phar",
		  "--path=/wordpress"
		], ${phpVar(args)});

		// Provide stdin, stdout, stderr streams outside of
		// the CLI SAPI.
		define('STDIN', fopen('php://stdin', 'rb'));
		define('STDOUT', fopen('php://stdout', 'wb'));
		define('STDERR', fopen('/tmp/stderr', 'wb'));

		require( ${phpVar(wpCliPath)} );
		`
	);

	const result = await playground.run({
		scriptPath: '/wordpress/run-cli.php',
	});

	if (result.errors) {
		throw new Error(result.errors);
	}

	return result;
};