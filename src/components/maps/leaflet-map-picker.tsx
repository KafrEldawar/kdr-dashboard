"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { LatLngExpression, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Link2, MapPin, Search } from "lucide-react";
import { parseGoogleMapsUrl, isShortGoogleMapsLink } from "@/lib/google-maps-url";
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

// Kafr El-Dawar center as default
const DEFAULT_CENTER: LatLngExpression = [31.131, 30.1281];

export type LeafletMapPickerProps = {
  value?: { lat: number | null; lng: number | null };
  onChange: (lat: number, lng: number) => void;
  height?: number;
};

export function LeafletMapPicker({
  value,
  onChange,
  height = 320,
}: LeafletMapPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [iconReady, setIconReady] = useState(false);
  const [defaultIcon, setDefaultIcon] = useState<unknown>(null);

  useEffect(() => {
    // leaflet's default marker icons use relative URLs that 404 in Next.
    // Patch them with CDN URLs once on the client.
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled) return;
      const icon = L.icon({
        iconUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
      });
      setDefaultIcon(icon);
      setIconReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasPin =
    value?.lat != null && value?.lng != null;
  const center: LatLngExpression = hasPin
    ? [value!.lat as number, value!.lng as number]
    : DEFAULT_CENTER;

  async function search() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`,
        { headers: { "Accept-Language": "ar" } },
      );
      const data = (await res.json()) as { lat: string; lon: string }[];
      if (data.length > 0) {
        const lat = Number(data[0].lat);
        const lng = Number(data[0].lon);
        onChange(lat, lng);
        mapRef.current?.setView([lat, lng], 16);
      }
    } finally {
      setSearching(false);
    }
  }

  function extractFromUrl(raw?: string) {
    const text = (raw ?? urlValue).trim();
    if (!text) return;
    const coords = parseGoogleMapsUrl(text);
    if (!coords) {
      setUrlError(
        isShortGoogleMapsLink(text)
          ? "الرابط مختصر — افتحه في المتصفح وانسخ الرابط الكامل ثم الصقه"
          : "تعذّر استخراج الإحداثيات — تأكد إنه رابط موقع من Google Maps",
      );
      return;
    }
    setUrlError(null);
    onChange(coords.lat, coords.lng);
    mapRef.current?.setView([coords.lat, coords.lng], 16);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange(pos.coords.latitude, pos.coords.longitude);
        mapRef.current?.setView(
          [pos.coords.latitude, pos.coords.longitude],
          16,
        );
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          placeholder="ابحث عن عنوان أو مكان"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={search} disabled={searching}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        </Button>
        <Button type="button" variant="outline" onClick={useMyLocation}>
          <MapPin className="h-4 w-4" />
        </Button>
      </div>

      {/* Paste a Google Maps link → auto-extract coordinates + move the pin */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            dir="ltr"
            placeholder="الصق رابط Google Maps لتحديد الدبوس"
            value={urlValue}
            onChange={(e) => {
              setUrlValue(e.target.value);
              if (urlError) setUrlError(null);
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              setUrlValue(text);
              setTimeout(() => extractFromUrl(text), 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                extractFromUrl();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" onClick={() => extractFromUrl()}>
          استخراج
        </Button>
      </div>
      {urlError ? <p className="text-xs text-destructive">{urlError}</p> : null}

      <div className="overflow-hidden rounded border" style={{ height }}>
        {iconReady && (
          <MapContainer
            center={center}
            zoom={hasPin ? 16 : 13}
            scrollWheelZoom
            style={{ height: "100%", width: "100%" }}
            ref={(m) => {
              if (m) mapRef.current = m as unknown as LeafletMap;
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            whenReady={((e: any) => {
              const map = (e.target ?? e) as LeafletMap;
              map.on("click", (ev) => {
                const { lat, lng } = ev.latlng;
                onChange(lat, lng);
              });
            }) as never}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {hasPin && defaultIcon != null && (
              <Marker
                position={center}
                draggable
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon={defaultIcon as any}
                ref={(m) => {
                  if (m) markerRef.current = m as unknown as LeafletMarker;
                }}
                eventHandlers={{
                  dragend: (e) => {
                    const m = e.target as LeafletMarker;
                    const ll = m.getLatLng();
                    onChange(ll.lat, ll.lng);
                  },
                }}
              />
            )}
          </MapContainer>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {hasPin
            ? `الإحداثيات: ${value!.lat!.toFixed(5)}, ${value!.lng!.toFixed(5)}`
            : "اضغط على الخريطة أو ابحث لتحديد الموقع"}
        </span>
      </div>
    </div>
  );
}
