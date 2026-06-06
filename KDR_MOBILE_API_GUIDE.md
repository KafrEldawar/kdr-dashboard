# KDR — Mobile App API Guide
> Supabase Project: `rkhygtgmcurwemuzizep`  
> Last updated: 2026-06-05

---

## Table of Contents

1. [Project Setup](#1-project-setup)
2. [Authentication](#2-authentication)
3. [Public RPCs (No Auth)](#3-public-rpcs-no-auth-required)
   - [rpc_get_categories](#rpc_get_categories)
   - [rpc_get_restaurants](#rpc_get_restaurants)
   - [rpc_get_restaurant_detail](#rpc_get_restaurant_detail)
   - [rpc_get_menu_items](#rpc_get_menu_items)
   - [rpc_get_branches](#rpc_get_branches)
   - [rpc_get_offers](#rpc_get_offers)
   - [rpc_validate_voucher](#rpc_validate_voucher)
4. [Profile RPCs (Auth Required)](#4-profile-rpcs-auth-required)
   - [rpc_get_my_profile](#rpc_get_my_profile)
   - [rpc_update_profile](#rpc_update_profile)
5. [Cart RPCs (Auth Required)](#5-cart-rpcs-auth-required)
   - [rpc_get_my_cart](#rpc_get_my_cart)
   - [rpc_add_to_cart](#rpc_add_to_cart)
   - [rpc_update_cart_item](#rpc_update_cart_item)
   - [rpc_remove_cart_item](#rpc_remove_cart_item)
   - [rpc_clear_cart](#rpc_clear_cart)
6. [Checkout & Orders (Auth Required)](#6-checkout--orders-auth-required)
   - [rpc_checkout](#rpc_checkout)
   - [rpc_get_my_orders](#rpc_get_my_orders)
   - [rpc_get_order_detail](#rpc_get_order_detail)
   - [rpc_rate_order](#rpc_rate_order)
7. [Notifications (Auth Required)](#7-notifications-auth-required)
   - [rpc_get_my_notifications](#rpc_get_my_notifications)
   - [rpc_mark_notifications_read](#rpc_mark_notifications_read)
   - [rpc_register_device_token](#rpc_register_device_token)
   - [rpc_unregister_device_token](#rpc_unregister_device_token)
8. [Direct Table Access](#8-direct-table-access)
   - [user_addresses](#user_addresses)
   - [user_favorite_restaurants](#user_favorite_restaurants)
   - [branch_working_hours](#branch_working_hours)
   - [menu_item_options & choices](#menu_item_options--menu_item_option_choices)
   - [order_status_history](#order_status_history)
   - [restaurant_gallery](#restaurant_gallery)
9. [Realtime Subscriptions](#9-realtime-subscriptions)
10. [Image Upload Edge Function](#10-image-upload-edge-function)
11. [Storage — Public Image URLs](#11-storage--public-image-urls)
12. [Order Status Flow](#12-order-status-flow)
13. [Enums Reference](#13-enums-reference)
14. [Response Shape Reference](#14-response-shape-reference)
15. [Error Handling](#15-error-handling)

---

## 1. Project Setup

```
Supabase Project ID : rkhygtgmcurwemuzizep
API URL             : https://rkhygtgmcurwemuzizep.supabase.co
Anon Key            : Supabase Dashboard → Settings → API → anon public
```

### Flutter (supabase_flutter)

```yaml
# pubspec.yaml
dependencies:
  supabase_flutter: ^2.0.0
```

```dart
// main.dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: 'https://rkhygtgmcurwemuzizep.supabase.co',
    anonKey: 'YOUR_ANON_KEY',
  );

  runApp(MyApp());
}

// Global accessor
final supabase = Supabase.instance.client;
```

### React Native (supabase-js)

```bash
npm install @supabase/supabase-js
```

```ts
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://rkhygtgmcurwemuzizep.supabase.co',
  'YOUR_ANON_KEY'
);
```

> **All RPCs return JSONB.**  
> - On **success**: the relevant data object/array.  
> - On **error**: `{ "error": "Error message here" }`  
> Always check for the `error` key before using the result.

---

## 2. Authentication

The app uses Supabase Auth (email + password). On first signup, a row is automatically created in the `profiles` table via a database trigger.

### Sign Up

```dart
// Flutter
final response = await supabase.auth.signUp(
  email: 'user@example.com',
  password: 'Password123',
);
final user = response.user;
```

```ts
// React Native
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'Password123',
});
```

### Sign In

```dart
// Flutter
final response = await supabase.auth.signInWithPassword(
  email: 'user@example.com',
  password: 'Password123',
);
final session = response.session;
final accessToken = session?.accessToken; // use this as Bearer token
```

```ts
// React Native
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'Password123',
});
const accessToken = data.session?.access_token;
```

### Sign Out

```dart
await supabase.auth.signOut();
```

### Get Current User / Session

```dart
final user    = supabase.auth.currentUser;
final session = supabase.auth.currentSession;
final token   = session?.accessToken;
final userId  = user?.id;
```

### Auth State Changes

```dart
supabase.auth.onAuthStateChange.listen((data) {
  final event   = data.event;   // AuthChangeEvent
  final session = data.session;
  // AuthChangeEvent.signedIn / signedOut / tokenRefreshed / userUpdated
});
```

---

## 3. Public RPCs (No Auth Required)

These can be called without a logged-in user. Safe for splash/home screens.

---

### `rpc_get_categories`

Returns all active categories sorted by `sort_order`.

**Parameters:** none

```dart
final data = await supabase.rpc('rpc_get_categories');
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name_ar": "مشويات",
    "name_en": "Grills",
    "image_url": "https://...",
    "sort_order": 1,
    "restaurant_count": 12
  }
]
```

---

### `rpc_get_restaurants`

Paginated restaurant list. Includes rating, delivery info, and categories.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `p_page` | integer | `1` | Page number |
| `p_page_size` | integer | `10` | Items per page |
| `p_search` | text | `null` | Full-text search on name |
| `p_category_id` | uuid | `null` | Filter by category |
| `p_accepts_online` | boolean | `null` | Has online ordering enabled |
| `p_is_accepting` | boolean | `null` | Currently accepting orders |

```dart
// Flutter
final data = await supabase.rpc('rpc_get_restaurants', params: {
  'p_page': 1,
  'p_page_size': 10,
  'p_is_accepting': true,
  'p_category_id': categoryId, // optional
  'p_search': 'برجر',          // optional
});
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name_ar": "مطعم الأسكندرية",
      "name_en": "Alexandria Restaurant",
      "logo_url": "https://...",
      "cover_url": "https://...",
      "accepts_online_orders": true,
      "is_accepting_orders": true,
      "estimated_delivery_time": 30,
      "delivery_fee": 15.00,
      "min_order_amount": 50.00,
      "average_rating": 4.5,
      "ratings_count": 120,
      "created_at": "2025-01-01T00:00:00Z",
      "categories": [
        { "id": "uuid", "name_ar": "مشويات", "name_en": "Grills" }
      ]
    }
  ],
  "meta": {
    "total": 45,
    "page": 1,
    "page_size": 10,
    "total_pages": 5
  }
}
```

---

### `rpc_get_restaurant_detail`

Everything for a restaurant screen in one call: info, branches, gallery, menu, reviews.

**Parameters:**

| Param | Type | Required |
|---|---|---|
| `p_restaurant_id` | uuid | ✅ |

```dart
final data = await supabase.rpc('rpc_get_restaurant_detail', params: {
  'p_restaurant_id': restaurantId,
});
```

**Response:**
```json
{
  "id": "uuid",
  "name_ar": "مطعم الأسكندرية",
  "name_en": "Alexandria Restaurant",
  "logo_url": "https://...",
  "cover_url": "https://...",
  "description_ar": "أفضل مطعم مشويات في المدينة",
  "description_en": "Best grill restaurant in town",
  "accepts_online_orders": true,
  "is_accepting_orders": true,
  "estimated_delivery_time": 30,
  "delivery_fee": 15.00,
  "min_order_amount": 50.00,
  "average_rating": 4.5,
  "ratings_count": 120,
  "categories": [
    { "id": "uuid", "name_ar": "مشويات", "name_en": "Grills", "image_url": "https://..." }
  ],
  "branches": [
    {
      "id": "uuid",
      "name_ar": "الفرع الرئيسي",
      "name_en": "Main Branch",
      "address_ar": "15 شارع التحرير",
      "address_en": "15 Tahrir Street",
      "location_url": "https://maps.google.com/...",
      "phones": ["+201001234567", "+201009876543"]
    }
  ],
  "gallery": [
    { "id": "uuid", "image_url": "https://...", "description": "المدخل" }
  ],
  "menu": [
    {
      "id": "uuid",
      "name_ar": "برجر كلاسيك",
      "name_en": "Classic Burger",
      "price": 89.00,
      "description_ar": "برجر لحم طازج",
      "description_en": "Fresh beef burger",
      "image_url": "https://...",
      "is_available": true,
      "sort_order": 1,
      "category_id": "uuid",
      "category_name_ar": "برجر",
      "category_name_en": "Burger"
    }
  ],
  "reviews": [
    {
      "rating": 5,
      "review": "ممتاز!",
      "created_at": "2025-06-01T10:00:00Z",
      "user_name": "Ahmed Mohamed"
    }
  ]
}
```

> Note: `menu` is only populated when `accepts_online_orders = true`.

---

### `rpc_get_menu_items`

Search or browse menu items across all restaurants or filtered to one.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `p_restaurant_id` | uuid | `null` | Filter by restaurant |
| `p_category_id` | uuid | `null` | Filter by category |
| `p_search` | text | `null` | Full-text search |
| `p_min_price` | numeric | `null` | Minimum price |
| `p_max_price` | numeric | `null` | Maximum price |
| `p_page` | integer | `1` | |
| `p_page_size` | integer | `20` | |

```dart
final data = await supabase.rpc('rpc_get_menu_items', params: {
  'p_restaurant_id': restaurantId,
  'p_page_size': 50,
});
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "restaurant_id": "uuid",
      "category_id": "uuid",
      "name_ar": "برجر كلاسيك",
      "name_en": "Classic Burger",
      "price": 89.00,
      "description_ar": "...",
      "description_en": "...",
      "image_url": "https://...",
      "is_available": true,
      "sort_order": 1,
      "category_name_ar": "برجر",
      "category_name_en": "Burger"
    }
  ],
  "meta": { "total": 30, "page": 1, "page_size": 20, "total_pages": 2 }
}
```

---

### `rpc_get_branches`

All branches for a restaurant including phone numbers.

**Parameters:**

| Param | Type | Required |
|---|---|---|
| `p_restaurant_id` | uuid | ✅ |

```dart
final data = await supabase.rpc('rpc_get_branches', params: {
  'p_restaurant_id': restaurantId,
});
```

**Response:**
```json
[
  {
    "id": "uuid",
    "name_ar": "الفرع الرئيسي",
    "name_en": "Main Branch",
    "address_ar": "15 شارع التحرير",
    "address_en": "15 Tahrir Street",
    "location_url": "https://maps.google.com/...",
    "created_at": "2025-01-01T00:00:00Z",
    "phones": ["+201001234567"]
  }
]
```

---

### `rpc_get_offers`

Active promotional offers.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `p_restaurant_id` | uuid | `null` | Filter by restaurant; `null` = all |
| `p_active_only` | boolean | `true` | Only return non-expired, active offers |

```dart
final data = await supabase.rpc('rpc_get_offers', params: {
  'p_restaurant_id': restaurantId,
  'p_active_only': true,
});
```

**Response:**
```json
[
  {
    "id": "uuid",
    "restaurant_id": "uuid",
    "title_ar": "خصم 20%",
    "title_en": "20% Off",
    "description_ar": "على جميع الطلبات فوق 100 جنيه",
    "description_en": "On all orders above 100 EGP",
    "image_url": "https://...",
    "discount_percentage": 20,
    "is_active": true,
    "start_date": "2025-06-01",
    "end_date": "2025-06-30",
    "created_at": "2025-05-01T00:00:00Z"
  }
]
```

---

### `rpc_validate_voucher`

Check a voucher code before submitting checkout. Call this when the user taps "Apply".

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `p_code` | text | ✅ | Voucher code entered by user |
| `p_restaurant_id` | uuid | ✅ | Restaurant of the current cart |
| `p_subtotal` | numeric | ✅ | Cart subtotal (before delivery fee) |

```dart
final data = await supabase.rpc('rpc_validate_voucher', params: {
  'p_code': 'SAVE20',
  'p_restaurant_id': restaurantId,
  'p_subtotal': 150.0,
});
```

**Success Response:**
```json
{
  "valid": true,
  "voucher_id": "uuid",
  "code": "SAVE20",
  "discount": 30.0,
  "discount_type": "percentage",
  "discount_value": 20
}
```

**Error Response:**
```json
{ "valid": false, "error": "Invalid or expired voucher code" }
```

Possible errors:
- `"Invalid or expired voucher code"`
- `"Voucher usage limit reached"`
- `"Minimum order amount is 100"` (minimum not met)

---

## 4. Profile RPCs (Auth Required)

---

### `rpc_get_my_profile`

Get the current user's profile. If the user is a restaurant owner, includes restaurant info.

**Parameters:** none

```dart
final data = await supabase.rpc('rpc_get_my_profile');
```

**Response (customer):**
```json
{
  "id": "uuid",
  "role": "customer",
  "full_name": "Ahmed Mohamed",
  "phone": "+201001234567",
  "gender": "male",
  "avatar_url": "https://...",
  "is_active": true,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-06-01T00:00:00Z"
}
```

**Response (restaurant owner):** same as above plus:
```json
{
  "restaurant": {
    "id": "uuid",
    "name_ar": "مطعم الأسكندرية",
    "name_en": "Alexandria Restaurant",
    "logo_url": "https://...",
    "cover_url": "https://...",
    "is_accepting_orders": true,
    "accepts_online_orders": true,
    "estimated_delivery_time": 30,
    "delivery_fee": 15.00,
    "min_order_amount": 50.00
  }
}
```

---

### `rpc_update_profile`

Update one or more profile fields. Only provided fields are changed (others stay the same).

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `p_full_name` | text | Display name |
| `p_phone` | text | Phone number |
| `p_gender` | text | `'male'` or `'female'` |
| `p_avatar_url` | text | URL from image upload |

```dart
final data = await supabase.rpc('rpc_update_profile', params: {
  'p_full_name': 'Ahmed Kamal',
  'p_phone': '+201001234567',
  'p_gender': 'male',
});
```

Returns the full updated profile (same shape as `rpc_get_my_profile`).

---

## 5. Cart RPCs (Auth Required)

The cart is single-restaurant: adding items from a different restaurant returns an error. A cart is created automatically on first call to `rpc_get_my_cart`.

All cart RPCs return the **full cart object**:

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "total_price": 178.00,
  "items": [
    {
      "id": "cart_item_uuid",
      "menu_item_id": "uuid",
      "quantity": 2,
      "special_instructions": "بدون بصل",
      "item_total": 178.00,
      "menu_item": {
        "id": "uuid",
        "name_ar": "برجر كلاسيك",
        "name_en": "Classic Burger",
        "price": 89.00,
        "image_url": "https://...",
        "restaurant_id": "uuid",
        "restaurant_name_ar": "مطعم الأسكندرية",
        "restaurant_name_en": "Alexandria Restaurant",
        "is_available": true
      }
    }
  ]
}
```

---

### `rpc_get_my_cart`

```dart
final data = await supabase.rpc('rpc_get_my_cart');
```

---

### `rpc_add_to_cart`

If the item already exists in the cart, its quantity is **increased** by `p_quantity`.

**Parameters:**

| Param | Type | Default | Required |
|---|---|---|---|
| `p_menu_item_id` | uuid | — | ✅ |
| `p_quantity` | integer | `1` | ❌ |
| `p_special_instructions` | text | `null` | ❌ |

```dart
final data = await supabase.rpc('rpc_add_to_cart', params: {
  'p_menu_item_id': menuItemId,
  'p_quantity': 1,
  'p_special_instructions': 'بدون بصل',
});
```

**Conflict error** (different restaurant):
```json
{
  "error": "You can only order from one restaurant at a time. Clear your cart first.",
  "conflicting_restaurant_id": "uuid"
}
```

Prompt the user to clear the cart, then call `rpc_clear_cart` before adding.

---

### `rpc_update_cart_item`

Set a new absolute quantity. Passing `p_quantity < 1` removes the item.

**Parameters:**

| Param | Type | Required |
|---|---|---|
| `p_cart_item_id` | uuid | ✅ |
| `p_quantity` | integer | ✅ |
| `p_special_instructions` | text | ❌ |

```dart
final data = await supabase.rpc('rpc_update_cart_item', params: {
  'p_cart_item_id': cartItemId,
  'p_quantity': 3,
});
```

---

### `rpc_remove_cart_item`

Remove a single item from the cart.

**Parameters:**

| Param | Type | Required |
|---|---|---|
| `p_cart_item_id` | uuid | ✅ |

```dart
final data = await supabase.rpc('rpc_remove_cart_item', params: {
  'p_cart_item_id': cartItemId,
});
```

---

### `rpc_clear_cart`

Remove all items from the cart.

```dart
final data = await supabase.rpc('rpc_clear_cart');
// → { "success": true, "items": [], "total_price": 0 }
```

---

## 6. Checkout & Orders (Auth Required)

---

### `rpc_checkout`

Validates cart → validates + applies voucher → creates order → snapshots items → clears cart.  
Returns the full order detail on success.

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `p_delivery_address` | text | ✅ | Full delivery address string |
| `p_contact_phone` | text | ✅ | Phone for delivery driver |
| `p_notes` | text | ❌ | Special delivery instructions |
| `p_voucher_code` | text | ❌ | Voucher to apply at checkout |

```dart
final data = await supabase.rpc('rpc_checkout', params: {
  'p_delivery_address': '15 شارع التحرير، القاهرة',
  'p_contact_phone': '+201001234567',
  'p_notes': 'اطرق الجرس مرتين',
  'p_voucher_code': 'SAVE20', // optional
});
```

**Possible errors:**
- `"Cart is empty"`
- `"Invalid or expired voucher code"`
- `"Voucher usage limit reached"`
- `"Minimum order amount for this voucher is 100"`

Returns full order detail on success (same shape as `rpc_get_order_detail`).

---

### `rpc_get_my_orders`

Paginated order history for the logged-in user.

**Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `p_status` | text | `null` | Filter: `pending` \| `preparing` \| `out_for_delivery` \| `delivered` \| `cancelled` |
| `p_page` | integer | `1` | |
| `p_page_size` | integer | `10` | |

```dart
final data = await supabase.rpc('rpc_get_my_orders', params: {
  'p_page': 1,
  'p_page_size': 10,
  // 'p_status': 'delivered', // optional filter
});
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "status": "delivered",
      "total_amount": 193.00,
      "subtotal": 178.00,
      "delivery_fee": 15.00,
      "discount": 0.00,
      "restaurant_rating": 5,
      "rated_at": "2025-06-02T12:00:00Z",
      "created_at": "2025-06-01T18:00:00Z",
      "updated_at": "2025-06-01T20:00:00Z",
      "items_count": 2,
      "restaurant": {
        "id": "uuid",
        "name_ar": "مطعم الأسكندرية",
        "name_en": "Alexandria Restaurant",
        "logo_url": "https://..."
      }
    }
  ],
  "meta": { "total": 14, "page": 1, "page_size": 10, "total_pages": 2 }
}
```

---

### `rpc_get_order_detail`

Full detail for one order including item snapshot.

**Parameters:**

| Param | Type | Required |
|---|---|---|
| `p_order_id` | uuid | ✅ |

```dart
final data = await supabase.rpc('rpc_get_order_detail', params: {
  'p_order_id': orderId,
});
```

**Response:**
```json
{
  "id": "uuid",
  "status": "preparing",
  "delivery_address": "15 شارع التحرير، القاهرة",
  "contact_phone": "+201001234567",
  "notes": "اطرق الجرس مرتين",
  "subtotal": 178.00,
  "delivery_fee": 15.00,
  "discount": 0.00,
  "total_amount": 193.00,
  "restaurant_rating": null,
  "restaurant_review": null,
  "rated_at": null,
  "created_at": "2025-06-01T18:00:00Z",
  "updated_at": "2025-06-01T18:05:00Z",
  "restaurant": {
    "id": "uuid",
    "name_ar": "مطعم الأسكندرية",
    "name_en": "Alexandria Restaurant",
    "logo_url": "https://...",
    "estimated_delivery_time": 30
  },
  "items": [
    {
      "id": "uuid",
      "menu_item_id": "uuid",
      "item_name_ar": "برجر كلاسيك",
      "item_name_en": "Classic Burger",
      "price": 89.00,
      "quantity": 2,
      "special_instructions": "بدون بصل",
      "subtotal": 178.00
    }
  ]
}
```

---

### `rpc_rate_order`

Rate a delivered order. Can only be done **once** per order, only when status = `delivered`.

**Parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `p_order_id` | uuid | ✅ | |
| `p_rating` | integer | ✅ | 1 – 5 stars |
| `p_review` | text | ❌ | Optional text review |

```dart
final data = await supabase.rpc('rpc_rate_order', params: {
  'p_order_id': orderId,
  'p_rating': 5,
  'p_review': 'الطعام كان رائعاً والتوصيل سريع!',
});
```

Returns the updated order detail on success.

**Possible errors:**
- `"Order not found"`
- `"You can only rate a delivered order"`
- `"You have already rated this order"`
- `"Rating must be between 1 and 5"`

---

## 7. Notifications (Auth Required)

---

### `rpc_get_my_notifications`

**Parameters:**

| Param | Type | Default |
|---|---|---|
| `p_page` | integer | `1` |
| `p_page_size` | integer | `20` |
| `p_unread_only` | boolean | `false` |

```dart
final data = await supabase.rpc('rpc_get_my_notifications', params: {
  'p_page': 1,
  'p_unread_only': false,
});
```

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "طلبك في الطريق 🛵",
      "body": "سيصل طلبك خلال 15 دقيقة",
      "image_url": null,
      "data": { "order_id": "uuid", "type": "order_update" },
      "is_read": false,
      "created_at": "2025-06-01T18:30:00Z"
    }
  ],
  "meta": { "total": 5, "page": 1, "page_size": 20, "total_pages": 1 },
  "unread_count": 3
}
```

---

### `rpc_mark_notifications_read`

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `p_notification_ids` | uuid[] | Specific IDs to mark. Pass `null` to mark **all** |

```dart
// Mark specific notifications
await supabase.rpc('rpc_mark_notifications_read', params: {
  'p_notification_ids': [id1, id2],
});

// Mark all as read
await supabase.rpc('rpc_mark_notifications_read', params: {
  'p_notification_ids': null,
});
// → { "success": true, "unread_count": 0 }
```

---

### `rpc_register_device_token`

Call this after every login and when FCM/APNs token refreshes.

**Parameters:**

| Param | Type | Description |
|---|---|---|
| `p_token` | text | FCM or APNs device token |
| `p_platform` | text | `'android'` \| `'ios'` \| `'web'` |

```dart
await supabase.rpc('rpc_register_device_token', params: {
  'p_token': fcmToken,
  'p_platform': 'android',
});
// → { "success": true, "token": "..." }
```

---

### `rpc_unregister_device_token`

Call this on logout to stop receiving push notifications.

```dart
await supabase.rpc('rpc_unregister_device_token', params: {
  'p_token': fcmToken,
});
// → { "success": true }
```

---

## 8. Direct Table Access

These use the Supabase client directly. RLS policies ensure users can only see and modify their own data.

---

### `user_addresses`

User's saved delivery addresses. A trigger automatically enforces only one `is_default = true` per user.

```dart
// List all addresses
final data = await supabase
    .from('user_addresses')
    .select('*')
    .order('is_default', ascending: false)
    .order('created_at', ascending: false);

// Add new address
await supabase.from('user_addresses').insert({
  'label': 'المنزل',        // or 'العمل', any label
  'address_ar': '15 شارع التحرير، القاهرة',
  'address_en': '15 Tahrir Street, Cairo',
  'location_url': 'https://maps.google.com/...',
  'is_default': true,        // triggers auto-clearing others
});

// Update an address
await supabase
    .from('user_addresses')
    .update({'label': 'العمل', 'is_default': false})
    .eq('id', addressId);

// Delete
await supabase
    .from('user_addresses')
    .delete()
    .eq('id', addressId);
```

**Row shape:**
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "label": "المنزل",
  "address_ar": "15 شارع التحرير",
  "address_en": "15 Tahrir Street",
  "location_url": "https://maps.google.com/...",
  "is_default": true,
  "created_at": "...",
  "updated_at": "..."
}
```

---

### `user_favorite_restaurants`

```dart
// Get my favorites
final data = await supabase
    .from('user_favorite_restaurants')
    .select('restaurant_id, created_at')
    .order('created_at', ascending: false);

// Add favorite
await supabase.from('user_favorite_restaurants').insert({
  'restaurant_id': restaurantId,
});

// Remove favorite
await supabase
    .from('user_favorite_restaurants')
    .delete()
    .eq('restaurant_id', restaurantId);

// Check if a restaurant is favorited
final isFav = await supabase
    .from('user_favorite_restaurants')
    .select('restaurant_id')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
// isFav == null → not favorited
```

---

### `branch_working_hours`

Public read (no auth needed). `day_of_week`: 0 = Sunday, 1 = Monday, … 6 = Saturday.

```dart
final data = await supabase
    .from('branch_working_hours')
    .select('*')
    .eq('branch_id', branchId)
    .order('day_of_week');
```

**Row shape:**
```json
{
  "id": "uuid",
  "branch_id": "uuid",
  "day_of_week": 0,
  "open_time": "09:00:00",
  "close_time": "23:00:00",
  "is_closed": false
}
```

---

### `menu_item_options` & `menu_item_option_choices`

Public read. Use for building "customize your order" UI (size, extras, etc.).

```dart
// Fetch options with their choices in one query
final data = await supabase
    .from('menu_item_options')
    .select('*, menu_item_option_choices(*)')
    .eq('menu_item_id', menuItemId)
    .order('sort_order');
```

**Shape:**
```json
[
  {
    "id": "uuid",
    "menu_item_id": "uuid",
    "name_ar": "الحجم",
    "name_en": "Size",
    "is_required": true,
    "allow_multiple": false,
    "sort_order": 0,
    "menu_item_option_choices": [
      {
        "id": "uuid",
        "option_id": "uuid",
        "name_ar": "صغير",
        "name_en": "Small",
        "price_extra": 0.00,
        "is_available": true,
        "sort_order": 0
      },
      {
        "id": "uuid",
        "name_ar": "كبير",
        "name_en": "Large",
        "price_extra": 10.00,
        "is_available": true,
        "sort_order": 1
      }
    ]
  }
]
```

---

### `order_status_history`

Read the full status change timeline for an order.

```dart
final data = await supabase
    .from('order_status_history')
    .select('status, notes, created_at')
    .eq('order_id', orderId)
    .order('created_at');
```

**Row shape:**
```json
{
  "status": "preparing",
  "notes": null,
  "created_at": "2025-06-01T18:05:00Z"
}
```

---

### `restaurant_gallery`

Public read. Use for a gallery screen or swiper inside the restaurant page.

```dart
final data = await supabase
    .from('restaurant_gallery')
    .select('id, image_url, description')
    .eq('restaurant_id', restaurantId)
    .order('sort_order');
```

> Note: The gallery is already included inside `rpc_get_restaurant_detail`. Only query this table separately if you need it standalone.

---

## 9. Realtime Subscriptions

Three tables have Postgres Changes enabled: **`orders`**, **`user_notifications`**, **`cart_items`**.

### Track Order Status (Live)

```dart
// Flutter
final channel = supabase
    .channel('order-tracking-$orderId')
    .onPostgresChanges(
      event: PostgresChangeEvent.update,
      schema: 'public',
      table: 'orders',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'id',
        value: orderId,
      ),
      callback: (payload) {
        final newStatus = payload.newRecord['status'] as String;
        // update order status in your state manager
      },
    )
    .subscribe();

// Always unsubscribe when leaving the screen
@override
void dispose() {
  supabase.removeChannel(channel);
  super.dispose();
}
```

### Live Notification Badge

```dart
final notifChannel = supabase
    .channel('user-notifications-${supabase.auth.currentUser!.id}')
    .onPostgresChanges(
      event: PostgresChangeEvent.insert,
      schema: 'public',
      table: 'user_notifications',
      filter: PostgresChangeFilter(
        type: PostgresChangeFilterType.eq,
        column: 'user_id',
        value: supabase.auth.currentUser!.id,
      ),
      callback: (payload) {
        final title = payload.newRecord['title'];
        final body  = payload.newRecord['body'];
        // show in-app notification banner
        // increment badge count
      },
    )
    .subscribe();
```

### Live Cart Sync (Multi-device)

```dart
final cartChannel = supabase
    .channel('cart-sync')
    .onPostgresChanges(
      event: PostgresChangeEvent.all,
      schema: 'public',
      table: 'cart_items',
      callback: (payload) {
        // re-fetch cart via rpc_get_my_cart
      },
    )
    .subscribe();
```

---

## 10. Image Upload Edge Function

Use this to upload user avatars. Restaurant images are managed by the admin dashboard.

```
URL    : https://rkhygtgmcurwemuzizep.supabase.co/functions/v1/upload-image
Method : POST
Auth   : Bearer <access_token>
Body   : multipart/form-data
```

**Form fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | ✅ | Image file (jpeg/png/webp/gif, max 5 MB) |
| `type` | string | ✅ | See type table below |
| `entity_id` | string | ❌ | Used as subfolder; pass user ID for avatars |

**Type values:**

| `type` | Bucket | Folder | Use for |
|---|---|---|---|
| `avatar` | `restaurant-media` | `avatars/` | User profile photo |
| `restaurant_logo` | `restaurant-media` | `logos/` | Admin only |
| `restaurant_cover` | `restaurant-media` | `covers/` | Admin only |
| `menu_item` | `restaurant-media` | `menu/` | Admin only |
| `gallery` | `restaurant-media` | `gallery/` | Admin only |
| `category` | `category-images` | root | Admin only |
| `offer` | `offer-images` | root | Admin only |

### Flutter Example — Upload Avatar

```dart
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'dart:convert';

Future<String?> uploadAvatar(File imageFile) async {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) return null;

  final userId = Supabase.instance.client.auth.currentUser!.id;
  final uri = Uri.parse(
    'https://rkhygtgmcurwemuzizep.supabase.co/functions/v1/upload-image'
  );

  final request = http.MultipartRequest('POST', uri)
    ..headers['Authorization'] = 'Bearer ${session.accessToken}'
    ..fields['type'] = 'avatar'
    ..fields['entity_id'] = userId
    ..files.add(await http.MultipartFile.fromPath(
      'file',
      imageFile.path,
      contentType: MediaType('image', 'jpeg'),
    ));

  final streamed = await request.send();
  final body = jsonDecode(await streamed.stream.bytesToString());

  if (body['error'] != null) throw Exception(body['error']);

  return body['url'] as String; // full public CDN URL — save this to profile
}

// Usage
final avatarUrl = await uploadAvatar(pickedFile);
if (avatarUrl != null) {
  await supabase.rpc('rpc_update_profile', params: {
    'p_avatar_url': avatarUrl,
  });
}
```

**Success Response:**
```json
{
  "success": true,
  "url": "https://rkhygtgmcurwemuzizep.supabase.co/storage/v1/object/public/restaurant-media/avatars/user-id/uuid.jpg",
  "path": "avatars/user-id/uuid.jpg",
  "bucket": "restaurant-media"
}
```

---

## 11. Storage — Public Image URLs

All buckets are public. Images can be displayed directly from the URL stored in the database. No authentication needed to read images.

**URL pattern:**
```
https://rkhygtgmcurwemuzizep.supabase.co/storage/v1/object/public/{bucket}/{path}
```

**Buckets:**

| Bucket | Contains | Max Size |
|---|---|---|
| `restaurant-media` | logos, covers, menu items, gallery, avatars | 5 MB |
| `category-images` | category photos | 2 MB |
| `offer-images` | offer banners | 5 MB |
| `notification-images` | push notification images | 5 MB |

**Allowed formats:** `image/jpeg`, `image/png`, `image/webp`, `image/gif`

---

## 12. Order Status Flow

```
[pending] ──► [preparing] ──► [out_for_delivery] ──► [delivered]
                                        │
                                        ▼
                                   [cancelled]
```

| Status | Arabic | Meaning |
|---|---|---|
| `pending` | في الانتظار | Order placed, waiting for restaurant to accept |
| `preparing` | قيد التحضير | Restaurant is preparing the order |
| `out_for_delivery` | في الطريق | Driver is on the way |
| `delivered` | تم التسليم | Order delivered successfully |
| `cancelled` | ملغي | Order was cancelled |

> Status is changed by the **restaurant owner** or **admin** only via `rpc_update_order_status`. The mobile app (customer side) only reads the status. Use [Realtime](#9-realtime-subscriptions) to get live updates.

> `order_status_history` table logs every transition automatically via a database trigger.

---

## 13. Enums Reference

| Enum | Values |
|---|---|
| `role` | `customer`, `restaurant`, `admin` |
| `order_status` | `pending`, `preparing`, `out_for_delivery`, `delivered`, `cancelled` |
| `discount_type` | `fixed`, `percentage` |
| `gender_type` | `male`, `female` |
| `device_platform` | `android`, `ios`, `web` |

---

## 14. Response Shape Reference

### Pagination meta (all paginated RPCs)

```json
{
  "meta": {
    "total": 45,
    "page": 1,
    "page_size": 10,
    "total_pages": 5
  }
}
```

### Cart object (all cart RPCs)

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "total_price": 193.00,
  "items": [ /* CartItem[] — see Cart section */ ]
}
```

### Order detail object (checkout, rate, get_detail)

See [rpc_get_order_detail](#rpc_get_order_detail) — this same shape is returned by all three functions.

---

## 15. Error Handling

Every RPC and the Edge Function returns an `error` key on failure. A safe pattern:

```dart
// Flutter helper
Future<Map<String, dynamic>> callRpc(
  String name, {
  Map<String, dynamic>? params,
}) async {
  try {
    final data = await supabase.rpc(name, params: params);
    final map = Map<String, dynamic>.from(data as Map);
    if (map.containsKey('error')) {
      throw Exception(map['error']);
    }
    return map;
  } on PostgrestException catch (e) {
    throw Exception(e.message);
  }
}

// Usage
try {
  final cart = await callRpc('rpc_add_to_cart', params: {
    'p_menu_item_id': itemId,
  });
  // use cart
} catch (e) {
  showErrorSnackbar(e.toString());
}
```

### Common HTTP / PostgREST errors

| Status | Meaning |
|---|---|
| `401` | Not authenticated — session expired, call `signIn` again |
| `403` | Forbidden — RLS blocked the request |
| `404` | Record not found |
| `409` | Conflict (e.g. duplicate unique key) |
| `500` | Server / function error — check `error` message |

### Auth session expiry

```dart
// Supabase auto-refreshes the token. Listen for errors:
supabase.auth.onAuthStateChange.listen((data) {
  if (data.event == AuthChangeEvent.signedOut) {
    // Token expired and could not be refreshed → redirect to login
    Navigator.pushReplacementNamed(context, '/login');
  }
});
```

---

*This guide covers 100% of the backend surface area available for the KDR mobile app. All RPCs and tables listed here are live in project `rkhygtgmcurwemuzizep`.*
