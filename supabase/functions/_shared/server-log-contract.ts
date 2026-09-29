export const MAXIMUM_SERVER_LOG_BYTES = 100 * 1_048_576;

export function serverLogDownloadHeaders(headers: Headers) {
    const disposition = headers.get("content-disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
    const filename = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/iu.exec(disposition)?.[1];
    const length = headers.get("content-length");
    if (headers.get("content-type") !== "application/octet-stream"
        || !/^attachment;/iu.test(disposition) || !filename || filename.length > 255
        || !/^[^/\\\p{Cc}]+\.log$/iu.test(filename)
        || length === null || !/^\d+$/u.test(length) || Number(length) > MAXIMUM_SERVER_LOG_BYTES) {
        throw new Error("Invalid log download");
    }
    return { filename, byteSize: Number(length) };
}
