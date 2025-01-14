<?php
/**
 * This script regenerates the public suffix list from the publicsuffix.org website.
 */

$suffixes = file_get_contents('https://publicsuffix.org/list/public_suffix_list.dat');
$lines = explode("\n", $suffixes);
$tlds = array();
foreach ($lines as $line) {
	if ( empty( $line ) || $line[0] === '/' ) {
		continue;
	}
	if ( strpos( $line, '.' ) !== false ) {
		continue;
	}
	$tlds[] = $line;
}


$php_file_path = __DIR__ . '/../src/public_suffix_list.php';

$new_php_file_path = $php_file_path.'.swp';
$fp = fopen($new_php_file_path, 'w');
fwrite($fp, "<?php\n\n");
fwrite($fp, "/**");
fwrite($fp, "\n * Public suffix list for detecting URLs with known domains within text.");
fwrite($fp, "\n * This file is automatically generated by regenerate_public_suffix_list.php.");
fwrite($fp, "\n * Do not edit it directly.");
fwrite($fp, "\n * @TODO: Process wildcards and exceptions, not just raw TLDs.");
fwrite($fp, "\n */\n\n");
fwrite($fp, "return array(\n");
foreach($tlds as $tld) {
	fwrite($fp, "\t'".$tld."' => 1,\n");
}

fwrite($fp, ");\n");

if(file_exists($php_file_path)) {
	unlink($php_file_path);
}
rename($new_php_file_path, $php_file_path);
