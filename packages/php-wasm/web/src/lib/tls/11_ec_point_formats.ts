/**
 * TLS ec_point_formats extension
 * https://www.rfc-editor.org/rfc/rfc4492#section-5.1.2
 */

import { ArrayBufferReader, ArrayBufferWriter } from '../tls';
import { ExtensionTypes } from './extensions-types';
import { flipObject } from './utils';

export const ECPointFormats = {
	uncompressed: 0,
	ansiX962_compressed_prime: 1,
	ansiX962_compressed_char2: 2,
} as const;
export type ECPointFormat = keyof typeof ECPointFormats;

export const ECPointFormatNames = flipObject(ECPointFormats);

export type ParsedECPointFormats = (keyof typeof ECPointFormats)[];

export class ECPointFormatsExtension {
	/**
    +--------------------------------------------------+
    | Extension Type (ec_point_formats)         [2B]   |
    | 0x00 0x0B                                        |
    +--------------------------------------------------+
    | Extension Length                          [2B]   |
    +--------------------------------------------------+
    | EC Point Formats Length                   [1B]   |
    +--------------------------------------------------+
    | EC Point Format 1                         [1B]   |
    +--------------------------------------------------+
    | EC Point Format 2                         [1B]   |
    +--------------------------------------------------+
    | ...                                              |
    +--------------------------------------------------+
    | EC Point Format n                         [1B]   |
    +--------------------------------------------------+
     */
	static decode(data: Uint8Array): ParsedECPointFormats {
		const reader = new ArrayBufferReader(data.buffer);
		// Read the EC Point Formats Length
		const length = reader.readUint8();
		const formats = [];
		for (let i = 0; i < length; i++) {
			const format = reader.readUint8();
			if (format in ECPointFormatNames) {
				formats.push(ECPointFormatNames[format]);
			}
		}
		return formats;
	}

	static encode(format: ECPointFormat): Uint8Array {
		const writer = new ArrayBufferWriter(4);
		writer.writeUint16(ExtensionTypes.ec_point_formats);
		writer.writeUint8(1); // EC Point Formats Length
		writer.writeUint8(ECPointFormats[format]);
		return writer.uint8Array;
	}
}