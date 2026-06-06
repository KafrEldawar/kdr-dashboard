# ملاحظات Supabase Schema

## المشروع

- الاسم: `kafr_al_dawar_resturants`
- الحالة: `ACTIVE_HEALTHY`
- الرابط: `https://nykgyduuxhwhnkcwrfld.supabase.co`

## الجداول المؤكدة

- `users`
- `user_addresses`
- `restaurants`
- `restaurant_branches`
- `categories`
- `menu_categories`
- `menu_items`
- `orders`
- `order_items`
- `order_tracking`
- `promo_codes`
- `promo_code_usages`
- `offers`
- `restaurant_reviews`
- `user_favorite_restaurants`
- `cart_items`
- `delivery_fees`
- `restaurant_working_hours`

## Views موجودة

- `restaurants_view`
- `restaurants_full_view`
- `menu_full_view`
- `orders_full_view`
- `order_tracking_view`
- `user_order_history_view`

## RPC Functions مهمة

- `admin_total_users`
- `admin_total_restaurants`
- `admin_total_orders`
- `admin_total_revenue`
- `admin_orders_per_day`
- `create_order`
- `update_order_status`
- `cancel_order`
- `validate_promo_code`
- `get_restaurant_details`
- `get_restaurant_full_page`
- `get_user_orders`
- `get_user_favorites`

## Storage Buckets

- `restaurant-logos`
- `restaurant-covers`
- `restaurant-gallery`
- `menu-items`
- `categories`
- `offers`

ملاحظة: كل الـ buckets الحالية private.

## Realtime

الجداول الموجودة في publication `supabase_realtime` حاليا:

- `orders`
- `order_tracking`

الجداول المطلوبة لاحقا حسب الخطة ولم يتم تفعيلها بعد:

- `restaurant_reviews`
- `cart_items`
- `offers`
- `notifications` لو تمت إضافتها

## ملاحظات مهمة على المستخدمين

- جدول `public.users.id` مربوط بـ `auth.users.id`.
- مفيش trigger تلقائي ينشئ profile في `public.users` عند إنشاء Auth user.
- إنشاء مستخدم تجريبي من الداشبورد يتم كالتالي:
  1. إنشاء Auth user باستخدام `supabase.auth.signUp`.
  2. إنشاء profile في `public.users` بنفس `auth.users.id`.

## RLS مؤقتة للاختبار

تمت إضافة policies مؤقتة على `public.users` باسم:

- `dashboard test users select`
- `dashboard test users insert`
- `dashboard test users update`
- `dashboard test users delete`

الغرض منها تشغيل Phase 5 في الداشبورد الداخلي قبل تنفيذ تسجيل الدخول والصلاحيات في Phase 14.

لازم Phase 14 يستبدل السياسات المؤقتة بسياسات أدمن محمية.
