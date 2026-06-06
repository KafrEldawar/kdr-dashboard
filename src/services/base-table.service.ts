import { requireSupabase } from "@/lib/supabase/client";
import type {
  QueryParams,
  ServiceListResult,
  ServiceResult,
} from "@/types/service";
import type { TableInsert, TableName, TableRow, TableUpdate } from "@/types/database";

type SearchConfig<TTable extends TableName> = {
  table: TTable;
  defaultSort?: keyof TableRow<TTable> & string;
  searchColumns?: (keyof TableRow<TTable> & string)[];
};

type SupabaseError = {
  message: string;
};

type QueryResponse<TData> = {
  data: TData | null;
  error: SupabaseError | null;
  count?: number | null;
};

type LooseQuery<TRow> = PromiseLike<QueryResponse<TRow[]>> & {
  range(from: number, to: number): LooseQuery<TRow>;
  order(column: string, options: { ascending: boolean }): LooseQuery<TRow>;
  or(filters: string): LooseQuery<TRow>;
  eq(column: string, value: unknown): LooseQuery<TRow>;
  single(): Promise<QueryResponse<TRow>>;
};

type LooseMutation<TRow> = {
  select(): {
    single(): Promise<QueryResponse<TRow>>;
  };
};

type LooseUpdate<TRow> = {
  eq(column: string, value: unknown): LooseMutation<TRow>;
};

type LooseDelete = {
  eq(column: string, value: unknown): Promise<QueryResponse<null>>;
};

type LooseTable<TRow, TInsert, TUpdate> = {
  select(columns: string, options?: { count?: "exact" }): LooseQuery<TRow>;
  insert(input: TInsert): LooseMutation<TRow>;
  update(input: TUpdate): LooseUpdate<TRow>;
  delete(): LooseDelete;
};

function getTable<TTable extends TableName>(table: TTable) {
  return requireSupabase().from(table) as unknown as LooseTable<
    TableRow<TTable>,
    TableInsert<TTable>,
    TableUpdate<TTable>
  >;
}

export function createTableService<TTable extends TableName>({
  table,
  defaultSort = "created_at" as keyof TableRow<TTable> & string,
  searchColumns = [],
}: SearchConfig<TTable>) {
  return {
    async getAll(params: QueryParams = {}): Promise<ServiceListResult<TableRow<TTable>>> {
      const tableClient = getTable(table);
      const page = params.page ?? 1;
      const pageSize = params.pageSize ?? 20;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let query = tableClient
        .select("*", { count: "exact" })
        .range(from, to)
        .order(params.column ?? defaultSort, {
          ascending: (params.direction ?? "desc") === "asc",
        });

      if (params.search && searchColumns.length > 0) {
        const value = params.search.replaceAll("%", "\\%");
        query = query.or(
          searchColumns.map((column) => `${column}.ilike.%${value}%`).join(",")
        );
      }

      if (params.filters) {
        Object.entries(params.filters).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            query = query.eq(key, value);
          }
        });
      }

      const { data, error, count } = await query;

      if (error) {
        throw error;
      }

      return {
        data: (data ?? []) as unknown as TableRow<TTable>[],
        count: count ?? 0,
      };
    },

    async getById(id: string): Promise<ServiceResult<TableRow<TTable>>> {
      const tableClient = getTable(table);
      const { data, error } = await tableClient
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        throw error;
      }

      return { data: data as unknown as TableRow<TTable> };
    },

    async create(input: TableInsert<TTable>): Promise<ServiceResult<TableRow<TTable>>> {
      const tableClient = getTable(table);
      const { data, error } = await tableClient
        .insert(input)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { data: data as unknown as TableRow<TTable> };
    },

    async update(
      id: string,
      input: TableUpdate<TTable>
    ): Promise<ServiceResult<TableRow<TTable>>> {
      const tableClient = getTable(table);
      const { data, error } = await tableClient
        .update(input)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      return { data: data as unknown as TableRow<TTable> };
    },

    async delete(id: string): Promise<void> {
      const tableClient = getTable(table);
      const { error } = await tableClient
        .delete()
        .eq("id", id);

      if (error) {
        throw error;
      }
    },

    async search(search: string, params: QueryParams = {}) {
      return this.getAll({ ...params, search });
    },

    async filters(filters: Record<string, unknown>, params: QueryParams = {}) {
      return this.getAll({ ...params, filters });
    },
  };
}
