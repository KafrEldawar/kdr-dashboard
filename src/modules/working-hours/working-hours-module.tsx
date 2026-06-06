"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ErrorState } from "@/components/shared/error-state";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { toAppError } from "@/lib/errors";
import { adminService, type WorkingHourInput, type WorkingHourRow } from "@/services/admin";
import { requireSupabase } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n";
import type { Branch } from "@/types/database";

const DAYS = [
  { value: 0, ar: "الأحد",    en: "Sunday" },
  { value: 1, ar: "الاثنين",  en: "Monday" },
  { value: 2, ar: "الثلاثاء", en: "Tuesday" },
  { value: 3, ar: "الأربعاء", en: "Wednesday" },
  { value: 4, ar: "الخميس",  en: "Thursday" },
  { value: 5, ar: "الجمعة",  en: "Friday" },
  { value: 6, ar: "السبت",   en: "Saturday" },
];

function defaultHours(): WorkingHourInput[] {
  return DAYS.map((d) => ({
    day_of_week: d.value,
    open_time: "09:00",
    close_time: "23:00",
    is_closed: d.value === 5,
  }));
}

async function fetchBranches(): Promise<Branch[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("branches")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Branch[];
}

export function WorkingHoursModule() {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [hours, setHours] = useState<WorkingHourInput[]>(defaultHours());

  const branchesQuery = useQuery({
    queryKey: ["branches-all"],
    queryFn: fetchBranches,
  });

  const hoursQuery = useQuery({
    queryKey: ["working-hours", selectedBranchId],
    queryFn: () => adminService.getWorkingHours(selectedBranchId),
    enabled: Boolean(selectedBranchId),
    onSuccess: (data: WorkingHourRow[]) => {
      if (data.length > 0) {
        const merged = defaultHours().map((dh) => {
          const saved = data.find((d) => d.day_of_week === dh.day_of_week);
          return saved
            ? { day_of_week: saved.day_of_week, open_time: saved.open_time, close_time: saved.close_time, is_closed: saved.is_closed }
            : dh;
        });
        setHours(merged);
      } else {
        setHours(defaultHours());
      }
    },
  } as Parameters<typeof useQuery>[0]);

  const saveMutation = useMutation({
    mutationFn: () => adminService.manageWorkingHours(selectedBranchId, hours),
    onSuccess: () => {
      toast.success("تم حفظ مواعيد العمل");
      void queryClient.invalidateQueries({ queryKey: ["working-hours", selectedBranchId] });
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const branches = branchesQuery.data ?? [];

  function updateHour(day: number, field: keyof WorkingHourInput, value: string | boolean) {
    setHours((prev) =>
      prev.map((h) => (h.day_of_week === day ? { ...h, [field]: value } : h))
    );
  }

  return (
    <>
      <PageHeader
        title="مواعيد العمل"
        description="حدد جدول عمل كل فرع طوال أيام الأسبوع."
      />

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end">
        <div className="w-full md:w-72">
          <p className="text-sm font-medium mb-1.5">اختر الفرع</p>
          {branchesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">جاري التحميل…</p>
          ) : (
            <Select
              value={selectedBranchId}
              onValueChange={(v) => { setSelectedBranchId(v); setHours(defaultHours()); }}
            >
              <SelectTrigger>
                <SelectValue placeholder="اختر فرعاً…" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {locale === "ar" ? (b.name_ar ?? b.address_ar) : (b.name_en ?? b.address_en)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {selectedBranchId && (
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "جاري الحفظ…" : "حفظ المواعيد"}
          </Button>
        )}
      </div>

      {!selectedBranchId ? (
        <Card>
          <CardContent className="flex items-center justify-center gap-3 py-12 text-muted-foreground">
            <Clock className="h-8 w-8" />
            <p>اختر فرعاً لعرض وتعديل مواعيد عمله</p>
          </CardContent>
        </Card>
      ) : hoursQuery.isLoading ? (
        <LoadingState />
      ) : hoursQuery.isError ? (
        <ErrorState
          description={toAppError(hoursQuery.error).message}
          onRetry={() => hoursQuery.refetch()}
        />
      ) : (
        <div className="space-y-3">
          {DAYS.map((day) => {
            const h = hours.find((x) => x.day_of_week === day.value) ?? {
              day_of_week: day.value, open_time: "09:00", close_time: "23:00", is_closed: false,
            };
            return (
              <Card key={day.value} className={h.is_closed ? "opacity-60" : ""}>
                <CardContent className="flex flex-wrap items-center gap-4 py-3">
                  <div className="w-24 font-medium text-sm">
                    {locale === "ar" ? day.ar : day.en}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`closed-${day.value}`}
                      checked={h.is_closed}
                      onChange={(e) => updateHour(day.value, "is_closed", e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <label htmlFor={`closed-${day.value}`} className="text-sm text-muted-foreground">
                      مغلق
                    </label>
                  </div>
                  {!h.is_closed && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">من</span>
                        <Input
                          type="time"
                          value={h.open_time ?? "09:00"}
                          onChange={(e) => updateHour(day.value, "open_time", e.target.value)}
                          className="w-32 h-8 text-sm"
                          dir="ltr"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">إلى</span>
                        <Input
                          type="time"
                          value={h.close_time ?? "23:00"}
                          onChange={(e) => updateHour(day.value, "close_time", e.target.value)}
                          className="w-32 h-8 text-sm"
                          dir="ltr"
                        />
                      </div>
                    </>
                  )}
                  {h.is_closed && (
                    <Badge variant="secondary">مغلق هذا اليوم</Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
