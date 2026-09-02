import { unzipSync } from "fflate";

export const MAX_COMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024; // 30 MB
export const MAX_FILES_EXTRACTED = 50;

const ALLOWED_EXTENSIONS = [
  ".lcov",
  ".info",
  ".xml",
  ".sarif",
  ".json",
] as const;

export interface ExtractSafeZipOptions {
  readonly maxCompressedBytes?: number | undefined;
  readonly maxFilesExtracted?: number | undefined;
  readonly maxUncompressedBytes?: number | undefined;
}

export interface ExtractedFile {
  readonly content: string;
  readonly path: string;
  readonly sizeBytes: number;
}

function isAllowedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  // Prevent directory traversal or strange paths
  if (lower.includes("../") || lower.includes("..\\")) return false;
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Safely extracts allowed CI artifact files from a ZIP buffer with strict size limits
 * and protections against Zip Bombs.
 */
export function extractSafeZipArtifact(
  zipBuffer: ArrayBuffer | Uint8Array,
  options?: ExtractSafeZipOptions,
): readonly ExtractedFile[] {
  const maxCompressedBytes =
    options?.maxCompressedBytes ?? MAX_COMPRESSED_BYTES;
  const maxUncompressedBytes =
    options?.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES;
  const maxFilesExtracted = options?.maxFilesExtracted ?? MAX_FILES_EXTRACTED;

  const bytes =
    zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer);

  if (bytes.byteLength > maxCompressedBytes) {
    throw new Error(
      `Artifact compressed size (${bytes.byteLength} bytes) exceeds safety limit of ${maxCompressedBytes} bytes.`,
    );
  }

  if (bytes.byteLength === 0) {
    return [];
  }

  let fileCount = 0;
  const unzipped = unzipSync(bytes, {
    filter(file) {
      if (!isAllowedFile(file.name)) return false;
      fileCount++;
      return fileCount <= maxFilesExtracted;
    },
  });

  let totalUncompressedBytes = 0;
  const results: ExtractedFile[] = [];
  const decoder = new TextDecoder("utf-8");

  for (const [fileName, fileData] of Object.entries(unzipped)) {
    totalUncompressedBytes += fileData.byteLength;
    if (totalUncompressedBytes > maxUncompressedBytes) {
      throw new Error(
        `Artifact uncompressed size exceeded maximum threshold of ${maxUncompressedBytes} bytes (Zip Bomb protection).`,
      );
    }

    results.push({
      content: decoder.decode(fileData),
      path: fileName,
      sizeBytes: fileData.byteLength,
    });
  }

  return results;
}
