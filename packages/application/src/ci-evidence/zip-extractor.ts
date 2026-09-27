import { Unzip, UnzipInflate } from "fflate";
export const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024;
export const MAX_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;
export const MAX_FILES_EXTRACTED = 50;
export interface ExtractSafeZipOptions {
  readonly maxCompressedBytes?: number;
  readonly maxFilesExtracted?: number;
  readonly maxUncompressedBytes?: number;
}
export interface ExtractedFile {
  readonly content: string;
  readonly path: string;
  readonly sizeBytes: number;
}
export function extractSafeZipArtifact(
  zipBuffer: ArrayBuffer | Uint8Array,
  options: ExtractSafeZipOptions = {},
): readonly ExtractedFile[] {
  const bytes =
    zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);
  const maxBytes = options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  if (bytes.length > (options.maxCompressedBytes ?? MAX_COMPRESSED_BYTES))
    throw new Error("Artifact compressed size exceeds safety limit");
  if (!bytes.length) return [];
  // fflate's streaming decoder tolerates unrecognized input with no entries.
  // Require a complete ZIP envelope so corrupt archives reach partial-error reporting.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (
    let offset = bytes.length - 22;
    offset >= Math.max(0, bytes.length - 65557);
    offset--
  ) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (
    end < 0 ||
    view.getUint32(end + 16, true) + view.getUint32(end + 12, true) > end
  )
    throw new Error("Invalid or incomplete artifact ZIP");
  const results: ExtractedFile[] = [];
  let total = 0,
    count = 0,
    started = 0,
    finished = 0;
  const unzip = new Unzip((file) => {
    if (
      file.name.includes("..") ||
      file.name.startsWith("/") ||
      file.name.includes("\\") ||
      !/\.(?:xml|info|lcov|sarif|json)$/iu.test(file.name)
    )
      return;
    if (++count > (options.maxFilesExtracted ?? MAX_FILES_EXTRACTED))
      throw new Error("Artifact file count exceeds safety limit");
    const fileLimit = Math.min(maxBytes, 2 * 1024 * 1024);
    if (
      file.originalSize !== undefined &&
      (file.originalSize > fileLimit || total + file.originalSize > maxBytes)
    )
      throw new Error("Artifact uncompressed size exceeds safety limit");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let content = "",
      sizeBytes = 0;
    started++;
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      sizeBytes += chunk.length;
      total += chunk.length;
      if (sizeBytes > fileLimit || total > maxBytes) {
        file.terminate();
        throw new Error("Artifact uncompressed size exceeds safety limit");
      }
      content += decoder.decode(chunk, { stream: !final });
      if (final) {
        finished++;
        results.push({ path: file.name, content, sizeBytes });
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Bound each inflate allocation as well as retained output. Never inflate the whole ZIP first.
  for (let offset = 0; offset < bytes.length; offset += 1024)
    unzip.push(
      bytes.subarray(offset, offset + 1024),
      offset + 1024 >= bytes.length,
    );
  if (started !== finished) throw new Error("Incomplete artifact ZIP");
  return results;
}
