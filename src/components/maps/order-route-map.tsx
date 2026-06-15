"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type {
  LatLngBoundsExpression,
  LatLngExpression,
} from "leaflet";
import "leaflet/dist/leaflet.css";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false },
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((m) => m.TileLayer),
  { ssr: false },
);
const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false },
);
const Polyline = dynamic(
  () => import("react-leaflet").then((m) => m.Polyline),
  { ssr: false },
);

export type OrderRouteMapProps = {
  branch: { lat: number; lng: number; label?: string } | null;
  delivery: { lat: number; lng: number; label?: string } | null;
  distanceKm?: number | null;
  height?: number;
};

export function OrderRouteMap({
  branch,
  delivery,
  distanceKm,
  height = 280,
}: OrderRouteMapProps) {
  const [icons, setIcons] = useState<{
    branch: unknown;
    delivery: unknown;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled) return;
      const make = (color: string) =>
        L.divIcon({
          className: "",
          html: `<div style="background:${color};border:2px solid white;border-radius:50%;width:18px;height:18px;box-shadow:0 0 0 1px rgba(0,0,0,0.2);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
      setIcons({ branch: make("#2563eb"), delivery: make("#dc2626") });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!branch && !delivery) {
    return (
      <div className="rounded border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        لا توجد إحداثيات للطلب — لم يتم تحديد العنوان أو الفرع على الخريطة.
      </div>
    );
  }

  const points: LatLngExpression[] = [];
  if (branch) points.push([branch.lat, branch.lng]);
  if (delivery) points.push([delivery.lat, delivery.lng]);
  const bounds: LatLngBoundsExpression | null =
    points.length === 2 ? (points as LatLngBoundsExpression) : null;
  const center: LatLngExpression = points[0];

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded border" style={{ height }}>
        {icons && (
          <MapContainer
            center={center}
            zoom={14}
            bounds={bounds ?? undefined}
            boundsOptions={{ padding: [30, 30] }}
            style={{ height: "100%", width: "100%" }}
            scrollWheelZoom={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {branch && (
              <Marker
                position={[branch.lat, branch.lng]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon={icons.branch as any}
              />
            )}
            {delivery && (
              <Marker
                position={[delivery.lat, delivery.lng]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon={icons.delivery as any}
              />
            )}
            {points.length === 2 && (
              <Polyline
                positions={points}
                pathOptions={{ color: "#0f766e", weight: 3, dashArray: "6 6" }}
              />
            )}
          </MapContainer>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> الفرع
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-600" /> العميل
          </span>
        </div>
        {distanceKm != null && (
          <span>المسافة: {distanceKm.toFixed(2)} كم</span>
        )}
      </div>
    </div>
  );
}
