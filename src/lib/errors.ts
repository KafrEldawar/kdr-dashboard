export type AppError = {
  message: string;
  code?: string;
  details?: unknown;
};

export function toAppError(error: unknown): AppError {
  if (error instanceof Error) {
    return {
      message: error.message,
    };
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return {
      message: String((error as { message: unknown }).message),
      details: error,
    };
  }

  return {
    message: "حصل خطأ غير متوقع.",
    details: error,
  };
}
