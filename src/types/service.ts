export type SortDirection = "asc" | "desc";

export type PaginationParams = {
  page?: number;
  pageSize?: number;
};

export type SortParams = {
  column?: string;
  direction?: SortDirection;
};

export type QueryParams<TFilters = Record<string, unknown>> = PaginationParams &
  SortParams & {
    search?: string;
    filters?: TFilters;
  };

export type ServiceListResult<T> = {
  data: T[];
  count: number;
};

export type ServiceResult<T> = {
  data: T;
};
