export type UploadFileLike = {
  size: number;
  type: string;
};

export function validateLogoFile(
  file: UploadFileLike | null,
  options: {
    maxBytes: number;
    allowedMimeTypes: string[];
    tooLargeMessage: string;
    invalidFormatMessage: string;
  }
) {
  if (!file) {
    return { ok: false as const, status: 400, body: { error: "Missing file", code: "BAD_REQUEST" } };
  }
  if (file.size <= 0) {
    return { ok: false as const, status: 400, body: { error: "Empty file", code: "BAD_REQUEST" } };
  }
  if (file.size > options.maxBytes) {
    return { ok: false as const, status: 400, body: { error: options.tooLargeMessage, code: "BAD_REQUEST" } };
  }
  if (!options.allowedMimeTypes.includes(file.type)) {
    return { ok: false as const, status: 400, body: { error: options.invalidFormatMessage, code: "BAD_REQUEST" } };
  }
  return { ok: true as const };
}
