export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, string>) {
    super(message);
  }
}

export function notFound(resource: string): never {
  throw new ApiError(404, "NOT_FOUND", `${resource} not found`);
}
