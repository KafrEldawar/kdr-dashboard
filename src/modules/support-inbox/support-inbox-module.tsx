"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Inbox, MessageSquare, Phone, UserX } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { requireSupabase } from "@/lib/supabase/client";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocale } from "@/lib/i18n";

type ContactMessage = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  subject: string;
  message: string;
  source: string;
  status: "new" | "read" | "resolved" | "archived";
  created_at: string;
};

type DeletionRequest = {
  id: string;
  request_id: string;
  name: string;
  phone: string;
  email: string | null;
  auth_method: string;
  reason: string | null;
  status: "pending" | "approved" | "completed" | "rejected";
  source: string;
  created_at: string;
};

type Tab = "messages" | "deletions";

// Loose type for tables that are not yet in the generated Database type.
type SupabaseExtra = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const MESSAGE_STATUS_LABEL: Record<ContactMessage["status"], string> = {
  new: "جديد",
  read: "تم القراءة",
  resolved: "تم الحل",
  archived: "أرشيف",
};

const DELETION_STATUS_LABEL: Record<DeletionRequest["status"], string> = {
  pending: "قيد المراجعة",
  approved: "تمت الموافقة",
  completed: "تم الحذف",
  rejected: "مرفوض",
};

function StatusBadge({ label, tone }: { label: string; tone: "info" | "warning" | "success" | "muted" | "danger" }) {
  const toneClass: Record<typeof tone, string> = {
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    muted: "bg-muted text-muted-foreground",
    danger: "bg-red-500/10 text-red-600 dark:text-red-400",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClass[tone]}`}>
      {label}
    </span>
  );
}

function messageStatusTone(status: ContactMessage["status"]) {
  if (status === "new") return "info" as const;
  if (status === "read") return "warning" as const;
  if (status === "resolved") return "success" as const;
  return "muted" as const;
}

function deletionStatusTone(status: DeletionRequest["status"]) {
  if (status === "pending") return "warning" as const;
  if (status === "approved") return "info" as const;
  if (status === "completed") return "success" as const;
  return "danger" as const;
}

export function SupportInboxModule() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("messages");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const debouncedSearch = useDebouncedValue(search);

  const messagesQuery = useQuery({
    queryKey: ["support-inbox", "messages"],
    queryFn: async () => {
      const sb = requireSupabase() as unknown as SupabaseExtra;
      const { data, error } = await sb
        .from("contact_messages")
        .select("id,name,phone,email,subject,message,source,status,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ContactMessage[];
    },
    enabled: tab === "messages",
  });

  const deletionsQuery = useQuery({
    queryKey: ["support-inbox", "deletions"],
    queryFn: async () => {
      const sb = requireSupabase() as unknown as SupabaseExtra;
      const { data, error } = await sb
        .from("account_deletion_requests")
        .select("id,request_id,name,phone,email,auth_method,reason,status,source,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as DeletionRequest[];
    },
    enabled: tab === "deletions",
  });

  const messageStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ContactMessage["status"] }) => {
      const sb = requireSupabase() as unknown as SupabaseExtra;
      const { error } = await sb
        .from("contact_messages")
        .update({ status, handled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-inbox", "messages"] }),
  });

  const deletionStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: DeletionRequest["status"] }) => {
      const sb = requireSupabase() as unknown as SupabaseExtra;
      const { error } = await sb
        .from("account_deletion_requests")
        .update({ status, handled_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["support-inbox", "deletions"] }),
  });

  const messageColumns = useMemo<ColumnDef<ContactMessage>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.original.created_at, locale)}
          </span>
        ),
      },
      {
        accessorKey: "name",
        header: "الاسم",
        cell: ({ row }) => (
          <div className="font-medium text-foreground">{row.original.name}</div>
        ),
      },
      {
        accessorKey: "phone",
        header: "التواصل",
        cell: ({ row }) => (
          <div className="flex flex-col gap-0.5 text-sm">
            <a
              href={`https://wa.me/${row.original.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-foreground hover:underline"
            >
              <Phone className="h-3 w-3" /> {row.original.phone}
            </a>
            {row.original.email ? (
              <span className="text-xs text-muted-foreground">{row.original.email}</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "subject",
        header: "الموضوع",
        cell: ({ row }) => (
          <span className="block max-w-[180px] truncate text-sm">{row.original.subject}</span>
        ),
      },
      {
        accessorKey: "message",
        header: "الرسالة",
        cell: ({ row }) => (
          <span className="block max-w-[320px] whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {row.original.message}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => (
          <StatusBadge
            label={MESSAGE_STATUS_LABEL[row.original.status]}
            tone={messageStatusTone(row.original.status)}
          />
        ),
      },
      {
        id: "actions",
        header: "إجراء",
        cell: ({ row }) => (
          <Select
            value={row.original.status}
            onValueChange={(value) =>
              messageStatusMutation.mutate({
                id: row.original.id,
                status: value as ContactMessage["status"],
              })
            }
          >
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MESSAGE_STATUS_LABEL) as ContactMessage["status"][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {MESSAGE_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ],
    [locale, messageStatusMutation]
  );

  const deletionColumns = useMemo<ColumnDef<DeletionRequest>[]>(
    () => [
      {
        accessorKey: "created_at",
        header: "التاريخ",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.original.created_at, locale)}
          </span>
        ),
      },
      {
        accessorKey: "request_id",
        header: "رقم الطلب",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.request_id}</span>
        ),
      },
      {
        accessorKey: "name",
        header: "المستخدم",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-foreground">{row.original.name}</span>
            {row.original.email ? (
              <span className="text-xs text-muted-foreground">{row.original.email}</span>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: "phone",
        header: "الهاتف",
        cell: ({ row }) => (
          <a
            href={`https://wa.me/${row.original.phone.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-foreground hover:underline"
          >
            <Phone className="h-3 w-3" /> {row.original.phone}
          </a>
        ),
      },
      {
        accessorKey: "auth_method",
        header: "طريقة التسجيل",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.auth_method}</span>
        ),
      },
      {
        accessorKey: "reason",
        header: "السبب",
        cell: ({ row }) => (
          <span className="block max-w-[260px] whitespace-pre-wrap break-words text-sm text-muted-foreground">
            {row.original.reason?.trim() || "—"}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => (
          <StatusBadge
            label={DELETION_STATUS_LABEL[row.original.status]}
            tone={deletionStatusTone(row.original.status)}
          />
        ),
      },
      {
        id: "actions",
        header: "إجراء",
        cell: ({ row }) => (
          <Select
            value={row.original.status}
            onValueChange={(value) =>
              deletionStatusMutation.mutate({
                id: row.original.id,
                status: value as DeletionRequest["status"],
              })
            }
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DELETION_STATUS_LABEL) as DeletionRequest["status"][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {DELETION_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ],
    [locale, deletionStatusMutation]
  );

  const messages = messagesQuery.data ?? [];
  const deletions = deletionsQuery.data ?? [];

  const filteredMessages = useMemo(() => {
    return messages.filter((m) => {
      if (statusFilter !== "all" && m.status !== statusFilter) return false;
      if (!debouncedSearch) return true;
      const q = debouncedSearch.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.phone.includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.message.toLowerCase().includes(q)
      );
    });
  }, [messages, statusFilter, debouncedSearch]);

  const filteredDeletions = useMemo(() => {
    return deletions.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (!debouncedSearch) return true;
      const q = debouncedSearch.toLowerCase();
      return (
        d.name.toLowerCase().includes(q) ||
        d.phone.includes(q) ||
        d.request_id.toLowerCase().includes(q) ||
        (d.reason?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [deletions, statusFilter, debouncedSearch]);

  const newMessagesCount = messages.filter((m) => m.status === "new").length;
  const pendingDeletionsCount = deletions.filter((d) => d.status === "pending").length;

  const statusOptions =
    tab === "messages"
      ? (Object.entries(MESSAGE_STATUS_LABEL) as [string, string][])
      : (Object.entries(DELETION_STATUS_LABEL) as [string, string][]);

  return (
    <>
      <PageHeader
        icon={Inbox}
        title="صندوق الدعم"
        description="الرسايل وطلبات حذف الحساب الجاية من الويب سايت."
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-sm font-medium text-muted-foreground">إجمالي الرسايل</p>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums">{messages.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-sm font-medium text-muted-foreground">رسايل جديدة</p>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-blue-600 dark:text-blue-400">
            {newMessagesCount}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 card-elevated">
          <p className="text-sm font-medium text-muted-foreground">طلبات حذف قيد المراجعة</p>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
            {pendingDeletionsCount}
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <Button
            variant={tab === "messages" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setTab("messages");
              setStatusFilter("all");
            }}
          >
            <MessageSquare className="me-1.5 h-4 w-4" />
            رسايل ({messages.length})
          </Button>
          <Button
            variant={tab === "deletions" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setTab("deletions");
              setStatusFilter("all");
            }}
          >
            <UserX className="me-1.5 h-4 w-4" />
            طلبات حذف ({deletions.length})
          </Button>
        </div>
        <div className="md:flex-1">
          <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالاسم، الهاتف، أو النص…" />
        </div>
        <div className="w-full md:w-44">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="كل الحالات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              {statusOptions.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {tab === "messages" ? (
        <>
          {messagesQuery.isLoading ? <LoadingState /> : null}
          {messagesQuery.isError ? (
            <ErrorState
              description={toAppError(messagesQuery.error).message}
              onRetry={() => messagesQuery.refetch()}
            />
          ) : null}
          {messagesQuery.data ? (
            <DataTable columns={messageColumns} data={filteredMessages} emptyTitle="لا يوجد رسايل" />
          ) : null}
        </>
      ) : (
        <>
          {deletionsQuery.isLoading ? <LoadingState /> : null}
          {deletionsQuery.isError ? (
            <ErrorState
              description={toAppError(deletionsQuery.error).message}
              onRetry={() => deletionsQuery.refetch()}
            />
          ) : null}
          {deletionsQuery.data ? (
            <DataTable
              columns={deletionColumns}
              data={filteredDeletions}
              emptyTitle="لا يوجد طلبات حذف"
            />
          ) : null}
        </>
      )}
    </>
  );
}
