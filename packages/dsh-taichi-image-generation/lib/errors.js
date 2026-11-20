export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export class ImageError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function safeError(error) {
  if (error instanceof ImageError) return error
  if (error?.name === 'TimeoutError') return new ImageError('TIMEOUT', 'The image provider timed out.', 504)
  if (error?.name === 'AbortError') return new ImageError('CANCELLED', 'Image operation cancelled.', 499)
  return new ImageError('UNAVAILABLE', 'The image service is unavailable.', 502)
}
