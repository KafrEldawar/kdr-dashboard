"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Eye, Pause, Play, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DataTable } from "@/components/shared/data-table";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Modal } from "@/components/shared/modal";
import { ImageUploader } from "@/components/shared/image-uploader";
import { formatDate } from "@/lib/format";
import { toAppError } from "@/lib/errors";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLocale } from "@/lib/i18n";
import {
  campaignsService,
  type CampaignStatus,
  type WhatsappCampaign,
} from "@/services/campaigns";
import {
  parsePhonesInput,
  statusBadgeVariant,
  statusLabel,
  targetTypeLabel,
} from "./campaign-utils";

const ROLE_OPTIONS = [
  { value: "customer", label: "عميل" },
  { value: "restaurant", label: "صاحب مطعم" },
  { value: "driver", label: "مندوب" },
  { value: "admin", label: "أدمن" },
];

const schema = z
  .object({
    title: z.string().min(2, "العنوان مطلوب"),
    body_template: z.string().min(2, "نص الرسالة مطلوب"),
    image_url: z.string().optional(),
    target_type: z.enum(["all_customers", "role_filter", "custom_list"]),
    roles: z.array(z.string()).optional(),
    custom_phones_raw: z.string().optional(),
    daily_cap: z.coerce.number().int().min(1).max(1000),
    schedule_start_at: z.string().min(1, "اختر وقت البدء"),
  })
  .superRefine((data, ctx) => {
    if (data.target_type === "role_filter" && (!data.roles || data.roles.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["roles"],
        message: "اختر دوراً واحداً على الأقل",
      });
    }
    if (data.target_type === "custom_list") {
      const parsed = parsePhonesInput(data.custom_phones_raw ?? "");
      if (parsed.phones.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["custom_phones_raw"],
          message: "أضف رقماً واحداً على الأقل بصيغة صحيحة",
        });
      }
    }
  });

type CampaignForm = z.infer<typeof schema>;

function defaultStart(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

const defaultValues: CampaignForm = {
  title: "",
  body_template: "",
  image_url: "",
  target_type: "all_customers",
  roles: [],
  custom_phones_raw: "",
  daily_cap: 200,
  schedule_start_at: defaultStart(),
};

export function CampaignsModule() {
  const queryClient = useQueryClient();
  const locale = useLocale();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [toDelete, setToDelete] = useState<WhatsappCampaign | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const listQuery = useQuery({
    queryKey: ["whatsapp-campaigns", debouncedSearch, statusFilter],
    queryFn: () =>
      campaignsService.list({
        search: debouncedSearch || undefined,
        status:
          statusFilter === "all"
            ? undefined
            : (statusFilter as CampaignStatus),
        pageSize: 50,
      }),
  });

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });

  const createForm = useForm<CampaignForm>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const createMutation = useMutation({
    mutationFn: async (params: { values: CampaignForm; sendNow: boolean }) => {
      const { values, sendNow } = params;
      const scheduleIso = sendNow
        ? new Date().toISOString()
        : new Date(values.schedule_start_at).toISOString();
      const created = await campaignsService.create({
        title: values.title,
        bodyTemplate: values.body_template,
        imageUrl: values.image_url || undefined,
        targetType: values.target_type,
        targetFilter:
          values.target_type === "role_filter" ? { roles: values.roles ?? [] } : {},
        dailyCap: values.daily_cap,
        scheduleStartAt: scheduleIso,
      });

      let customPhones: string[] | undefined;
      let customNames: string[] | undefined;
      if (values.target_type === "custom_list") {
        const parsed = parsePhonesInput(values.custom_phones_raw ?? "");
        customPhones = parsed.phones;
        customNames = parsed.names;
      }

      const attached = await campaignsService.attachRecipients({
        campaignId: created.campaign_id,
        customPhones,
        customNames,
      });

      if (sendNow) {
        await campaignsService.dispatchNow(created.campaign_id);
      }
      return { ...attached, sendNow };
    },
    onSuccess: (res) => {
      toast.success(
        res.sendNow
          ? `بدأ الإرسال الآن (${res.total} مستلم)`
          : `تم جدولة الحملة (${res.total} مستلم)`
      );
      createForm.reset({ ...defaultValues, schedule_start_at: defaultStart() });
      setAddOpen(false);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const pauseMutation = useMutation({
    mutationFn: (c: WhatsappCampaign) => campaignsService.pause(c.id),
    onSuccess: () => { toast.success("تم إيقاف الحملة"); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const resumeMutation = useMutation({
    mutationFn: (c: WhatsappCampaign) => campaignsService.resume(c.id),
    onSuccess: () => { toast.success("تم استئناف الحملة"); refresh(); },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: (c: WhatsappCampaign) => campaignsService.delete(c.id),
    onSuccess: () => {
      toast.success("تم حذف الحملة");
      setToDelete(null);
      refresh();
    },
    onError: (error) => toast.error(toAppError(error).message),
  });

  const columns = useMemo<ColumnDef<WhatsappCampaign>[]>(
    () => [
      {
        accessorKey: "title",
        header: "العنوان",
        cell: ({ row }) => (
          <Link
            href={`/campaigns/${row.original.id}`}
            className="font-semibold text-foreground hover:text-primary"
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "target_type",
        header: "الجمهور",
        cell: ({ row }) => targetTypeLabel[row.original.target_type],
      },
      {
        accessorKey: "daily_cap",
        header: "يومياً",
        cell: ({ row }) => row.original.daily_cap,
      },
      {
        accessorKey: "status",
        header: "الحالة",
        cell: ({ row }) => (
          <Badge variant={statusBadgeVariant[row.original.status]}>
            {statusLabel[row.original.status]}
          </Badge>
        ),
      },
      {
        id: "progress",
        header: "التقدم",
        cell: ({ row }) => {
          const c = row.original;
          const pct = c.total_recipients > 0
            ? Math.round(((c.sent_count + c.failed_count) / c.total_recipients) * 100)
            : 0;
          return (
            <div className="min-w-[140px]">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {c.sent_count + c.failed_count}/{c.total_recipients}
                {c.failed_count > 0 ? ` · ${c.failed_count} فشل` : ""}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "schedule_start_at",
        header: "البدء",
        cell: ({ row }) => formatDate(row.original.schedule_start_at, locale),
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => {
          const c = row.original;
          const canPause = c.status === "running" || c.status === "scheduled";
          const canResume = c.status === "paused";
          return (
            <div className="flex flex-wrap gap-2">
              <Link href={`/campaigns/${c.id}`}>
                <Button size="sm" variant="outline">
                  <Eye className="h-4 w-4" />
                  عرض
                </Button>
              </Link>
              {canPause ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => pauseMutation.mutate(c)}
                  disabled={pauseMutation.isPending}
                >
                  <Pause className="h-4 w-4" />
                  إيقاف
                </Button>
              ) : null}
              {canResume ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => resumeMutation.mutate(c)}
                  disabled={resumeMutation.isPending}
                >
                  <Play className="h-4 w-4" />
                  استئناف
                </Button>
              ) : null}
              <Button size="sm" variant="destructive" onClick={() => setToDelete(c)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        },
      },
    ],
    [locale, pauseMutation, resumeMutation]
  );

  const targetType = createForm.watch("target_type");
  const roles = createForm.watch("roles") ?? [];

  return (
    <>
      <PageHeader
        icon={Send}
        title="حملات واتساب"
        description="إنشاء وجدولة حملات تسويق عبر واتساب مع حد يومي للإرسال وتوزيع تلقائي على عدة أيام."
        action={
          <Button onClick={() => {
            createForm.reset({ ...defaultValues, schedule_start_at: defaultStart() });
            setAddOpen(true);
          }}>
            <Plus className="h-4 w-4" />
            حملة جديدة
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="ابحث بالعنوان…" />
        <div className="w-full md:w-48">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="draft">{statusLabel.draft}</SelectItem>
              <SelectItem value="scheduled">{statusLabel.scheduled}</SelectItem>
              <SelectItem value="running">{statusLabel.running}</SelectItem>
              <SelectItem value="paused">{statusLabel.paused}</SelectItem>
              <SelectItem value="completed">{statusLabel.completed}</SelectItem>
              <SelectItem value="failed">{statusLabel.failed}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {listQuery.isLoading ? <LoadingState /> : null}
      {listQuery.isError ? (
        <ErrorState
          description={toAppError(listQuery.error).message}
          onRetry={() => listQuery.refetch()}
        />
      ) : null}
      {listQuery.data ? (
        <DataTable
          columns={columns}
          data={listQuery.data.data}
          emptyTitle="لا توجد حملات لسه"
        />
      ) : null}

      {/* Create modal */}
      <Modal
        open={addOpen}
        onOpenChange={setAddOpen}
        title="حملة واتساب جديدة"
        description="أنشئ رسالة تسويقية، اختر الجمهور المستهدف، وحدد cap يومي للإرسال."
        size="lg"
      >
        <form
          className="space-y-5"
          onSubmit={createForm.handleSubmit((v) =>
            createMutation.mutate({ values: v, sendNow: false })
          )}
        >
          <Field label="عنوان داخلي" error={createForm.formState.errors.title?.message}>
            <Input
              {...createForm.register("title")}
              placeholder="عرض رمضان 2026"
            />
          </Field>

          <Field
            label="نص الرسالة"
            error={createForm.formState.errors.body_template?.message}
            hint="استخدم {{name}} لإدراج اسم المستلم تلقائياً (إن وجد)."
          >
            <Textarea
              {...createForm.register("body_template")}
              rows={4}
              placeholder="أهلاً {{name}}! استمتع بخصم 20% على كل الطلبات اليوم…"
            />
          </Field>

          <Field label="صورة (اختياري)">
            <ImageUploader
              label="صورة الحملة"
              type="offer"
              value={createForm.watch("image_url") ?? ""}
              onChange={(url) => createForm.setValue("image_url", url)}
              variant="cover"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع الجمهور">
              <Select
                value={targetType}
                onValueChange={(v) =>
                  createForm.setValue("target_type", v as CampaignForm["target_type"])
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_customers">{targetTypeLabel.all_customers}</SelectItem>
                  <SelectItem value="role_filter">{targetTypeLabel.role_filter}</SelectItem>
                  <SelectItem value="custom_list">{targetTypeLabel.custom_list}</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="cap يومي"
              error={createForm.formState.errors.daily_cap?.message}
              hint="عدد الرسائل التي ترسل في اليوم الواحد. يفضل بدء بأرقام صغيرة (50–200)."
            >
              <Input
                {...createForm.register("daily_cap")}
                type="number"
                min={1}
                max={1000}
                dir="ltr"
              />
            </Field>
          </div>

          {targetType === "role_filter" ? (
            <Field
              label="الأدوار"
              error={createForm.formState.errors.roles?.message as string | undefined}
            >
              <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-muted/30 p-3">
                {ROLE_OPTIONS.map((opt) => {
                  const checked = roles.includes(opt.value);
                  return (
                    <label
                      key={opt.value}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...roles, opt.value]
                            : roles.filter((r) => r !== opt.value);
                          createForm.setValue("roles", next, { shouldValidate: true });
                        }}
                      />
                      {opt.label}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}

          {targetType === "custom_list" ? (
            <Field
              label="قائمة الأرقام"
              error={createForm.formState.errors.custom_phones_raw?.message}
              hint="رقم في كل سطر. مدعوم: +201234567890 أو 01234567890. اختياري: أضف ,الاسم بعد الرقم."
            >
              <Textarea
                {...createForm.register("custom_phones_raw")}
                rows={6}
                dir="ltr"
                placeholder={"+201234567890,محمد\n01112223344,أحمد"}
              />
            </Field>
          ) : null}

          <Field
            label="وقت بدء الإرسال"
            error={createForm.formState.errors.schedule_start_at?.message}
          >
            <Input
              {...createForm.register("schedule_start_at")}
              type="datetime-local"
              dir="ltr"
            />
          </Field>

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={createMutation.isPending}
              onClick={createForm.handleSubmit((v) =>
                createMutation.mutate({ values: v, sendNow: true })
              )}
            >
              {createMutation.isPending ? "جاري…" : "إرسال الآن"}
            </Button>
            <Button disabled={createMutation.isPending}>
              {createMutation.isPending ? "جاري الإنشاء…" : "إنشاء وجدولة"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="حذف الحملة"
        description="هتحذف الحملة وكل المستلمين المرتبطين بها. لا يمكن التراجع."
        confirmLabel="حذف"
        onOpenChange={(open) => !open && setToDelete(null)}
        onConfirm={() => toDelete && deleteMutation.mutate(toDelete)}
      />
    </>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
