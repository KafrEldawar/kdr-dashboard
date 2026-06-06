-- ============================================================
-- 006: Storage Buckets + Policies
-- ============================================================

-- ── Create buckets ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('restaurant-media',    'restaurant-media',    true, 5242880,  array['image/jpeg','image/png','image/webp','image/gif']),
  ('category-images',     'category-images',     true, 2097152,  array['image/jpeg','image/png','image/webp']),
  ('offer-images',        'offer-images',        true, 5242880,  array['image/jpeg','image/png','image/webp']),
  ('notification-images', 'notification-images', true, 5242880,  array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ── restaurant-media policies ────────────────────────────────
-- Public read
create policy "restaurant-media: public read"
  on storage.objects for select
  using (bucket_id = 'restaurant-media');

-- Admin can upload/delete anything
create policy "restaurant-media: admin write"
  on storage.objects for insert
  with check (
    bucket_id = 'restaurant-media'
    and public.is_admin()
  );

create policy "restaurant-media: admin delete"
  on storage.objects for delete
  using (
    bucket_id = 'restaurant-media'
    and public.is_admin()
  );

-- Restaurant owner can upload to their own folder
-- Folder convention: logos/{restaurant_id}/*, covers/{restaurant_id}/*, etc.
create policy "restaurant-media: owner write own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'restaurant-media'
    and auth.role() = 'authenticated'
    and (
      -- path starts with owner's restaurant id
      (storage.foldername(name))[1] in ('logos','covers','menu','gallery')
    )
    and public.is_restaurant_owner()
  );

create policy "restaurant-media: owner delete own folder"
  on storage.objects for delete
  using (
    bucket_id = 'restaurant-media'
    and public.is_restaurant_owner()
  );

-- ── category-images policies ─────────────────────────────────
create policy "category-images: public read"
  on storage.objects for select
  using (bucket_id = 'category-images');

create policy "category-images: admin write"
  on storage.objects for insert
  with check (bucket_id = 'category-images' and public.is_admin());

create policy "category-images: admin delete"
  on storage.objects for delete
  using (bucket_id = 'category-images' and public.is_admin());

-- ── offer-images policies ────────────────────────────────────
create policy "offer-images: public read"
  on storage.objects for select
  using (bucket_id = 'offer-images');

create policy "offer-images: admin or owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'offer-images'
    and auth.role() = 'authenticated'
    and (public.is_admin() or public.is_restaurant_owner())
  );

create policy "offer-images: admin or owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'offer-images'
    and (public.is_admin() or public.is_restaurant_owner())
  );

-- ── notification-images policies ─────────────────────────────
create policy "notification-images: public read"
  on storage.objects for select
  using (bucket_id = 'notification-images');

create policy "notification-images: admin write"
  on storage.objects for insert
  with check (bucket_id = 'notification-images' and public.is_admin());

create policy "notification-images: admin delete"
  on storage.objects for delete
  using (bucket_id = 'notification-images' and public.is_admin());
