"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingState } from "@/components/shared/loading-state";
import {
  DEFAULT_DELIVERY_CONFIG,
  settingsService,
  type DeliveryFeeConfig,
} from "@/services/settings";
import { toAppError } from "@/lib/errors";

const schema = z.object({
  base: z.coerce.number().min(0),
  per_km: z.coerce.number().min(0),
  free_km: z.coerce.number().min(0).max(50),
  min: z.coerce.number().min(0),
  max: z.coerce.number().min(0),
  route_factor: z.coerce.number().min(0.5).max(5),
  max_distance_km: z.coerce.number().min(1).max(200),
  currency: z.string().min(2).max(8),
});

type FormValues = z.infer<typeof schema>;

export function DeliveryConfigForm() {
  const qc = useQueryClient();
  const [previewKm, setPreviewKm] = useState(5);

  const configQuery = useQuery({
    queryKey: ["delivery-config"],
    queryFn: () => settingsService.getDeliveryConfig(),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: DEFAULT_DELIVERY_CONFIG,
  });

  useEffect(() => {
    if (configQuery.data) form.reset(configQuery.data);
  }, [configQuery.data, form]);

  const updateMutation = useMutation({
    mutationFn: (v: FormValues) =>
      settingsService.updateDeliveryConfig(v as DeliveryFeeConfig),
    onSuccess: () => {
      toast.success("تم حفظ إعدادات التوصيل");
      qc.invalidateQueries({ queryKey: ["delivery-config"] });
    },
    onError: (err) => toast.error(toAppError(err).message),
  });

  const watched = form.watch();
  const liveConfig: DeliveryFeeConfig = useMemo(
    () => ({
      ...DEFAULT_DELIVERY_CONFIG,
      ...watched,
    }),
    [watched],
  );
  const previewFee = settingsService.previewFee(liveConfig, previewKm);
  const outOfRange = previewKm * liveConfig.route_factor > liveConfig.max_distance_km;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4" /> إعدادات رسوم التوصيل
        </CardTitle>
      </CardHeader>
      <CardContent>
        {configQuery.isLoading ? (
          <LoadingState />
        ) : (
          <form
            className="grid gap-4 md:grid-cols-2"
            onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))}
          >
            <Field label="الرسوم الأساسية (جنيه)" name="base" form={form} />
            <Field label="سعر الكيلومتر (جنيه)" name="per_km" form={form} />
            <Field
              label="كيلومترات مشمولة في السعر الأساسي"
              name="free_km"
              form={form}
              step="0.5"
            />
            <Field label="الحد الأدنى (جنيه)" name="min" form={form} />
            <Field label="الحد الأقصى (جنيه)" name="max" form={form} />
            <Field
              label="معامل الطريق (×) — يقرّب المسافة الفعلية"
              name="route_factor"
              form={form}
              step="0.1"
            />
            <Field label="أقصى مسافة للتوصيل (كم)" name="max_distance_km" form={form} />
            <div className="space-y-2">
              <Label>العملة</Label>
              <Input {...form.register("currency")} dir="ltr" />
            </div>

            <div className="md:col-span-2 mt-2 rounded border border-dashed p-3">
              <div className="flex items-center gap-3">
                <Label htmlFor="preview-km" className="shrink-0">
                  معاينة عند مسافة (كم):
                </Label>
                <Input
                  id="preview-km"
                  type="number"
                  step="0.5"
                  className="w-24"
                  value={previewKm}
                  onChange={(e) => setPreviewKm(Number(e.target.value || 0))}
                />
                <p className="text-sm">
                  الرسوم المتوقعة:{" "}
                  {outOfRange ? (
                    <span className="font-semibold text-destructive">
                      خارج النطاق
                    </span>
                  ) : (
                    <span className="font-semibold">
                      {previewFee.toFixed(2)} {liveConfig.currency}
                    </span>
                  )}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                المعادلة: clamp(min, max, base + per_km × max(0, distance ×
                route_factor − free_km))
                <br />
                يعني أول <b>free_km</b> كيلو داخلة في السعر الأساسي، واللي بعدها
                بس هو اللي بيتحسب.
              </p>
            </div>

            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "جاري الحفظ…" : "حفظ الإعدادات"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  name,
  form,
  step = "0.01",
}: {
  label: string;
  name: keyof FormValues;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: ReturnType<typeof useForm<any>>;
  step?: string;
}) {
  const error = form.formState.errors[name];
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        step={step}
        dir="ltr"
        {...form.register(name as string)}
      />
      {error && (
        <p className="text-xs text-destructive">
          {String((error as { message?: string }).message ?? "قيمة غير صحيحة")}
        </p>
      )}
    </div>
  );
}
