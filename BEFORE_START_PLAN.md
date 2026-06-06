# Kafr Al Dawar Restaurants - Admin/Test Dashboard

## Before Start Plan And Target Requirements

## 1. Project Purpose

Build an internal web dashboard to test, manage, and debug the full backend for the Kafr Al Dawar Restaurants platform before starting Flutter mobile app integration.

This dashboard is not the final production admin panel. It is a developer/admin testing environment used to validate data, relationships, business logic, realtime behavior, and user workflows.

## 2. Main Target

The dashboard must allow complete backend testing for:

- Users
- Restaurants
- Branches
- Categories
- Menu categories
- Menu items
- Orders
- Order tracking
- Offers
- Promo codes
- Reviews
- Favorites
- Cart
- Delivery fees
- Working hours
- Analytics
- Realtime updates
- Supabase queries
- Seed/test data generation
- Image uploads
- Role-based access

## 2.1 Language And Locale Requirement

The whole dashboard must use Arabic language for the user interface.

Required locale:

- Arabic - Egypt
- `ar-EG`
- RTL layout direction

Rules:

- All visible dashboard text must be Arabic, preferably simple Egyptian Arabic for internal admin usage.
- Navigation labels, page titles, buttons, empty states, loading states, errors, confirmations, table labels, form labels, filters, and toast messages must be Arabic.
- HTML must use `lang="ar-EG"` and `dir="rtl"`.
- Dates, times, currency, and numbers should be formatted for Egypt when displayed to admins.
- English can remain only for code names, database table names, environment variables, package names, and technical identifiers.
- Do not mix English UI labels with Arabic UI labels unless there is a technical reason.

## 3. Required Tech Stack

- Next.js 15+
- TypeScript
- App Router
- Tailwind CSS
- Shadcn UI
- Supabase JS Client
- TanStack Table
- React Hook Form
- Zod
- React Query
- Zustand
- Recharts
- Sonner Toast
- Lucide Icons

## 4. Required Folder Structure

```txt
src/
  app/
  components/
  modules/
  services/
  hooks/
  types/
  lib/
  providers/
  store/
```

## 5. Required Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Optional later variables may include service role keys for secure seed/admin operations, but service role keys must never be exposed to the browser.

## 6. Required Supabase Preparation

Before dashboard development starts, confirm these tables exist in Supabase:

- `users`
- `restaurants`
- `restaurant_branches`
- `categories`
- `menu_categories`
- `menu_items`
- `orders`
- `order_tracking`
- `promo_codes`
- `offers`
- `restaurant_reviews`
- `user_favorite_restaurants`
- `cart_items`
- `delivery_fees`
- `restaurant_working_hours`

Also confirm:

- Table relationships are defined with foreign keys where needed.
- Row Level Security rules are known.
- Storage buckets exist for restaurant logos, cover images, menu images, and category images.
- Realtime is enabled for orders, tracking, reviews, cart, offers, and notifications if used.

## 7. Required Service Layer

Create a service layer under `src/services`.

Required service folders:

```txt
services/
  users/
  restaurants/
  categories/
  branches/
  menu/
  orders/
  offers/
  promoCodes/
  reviews/
  favorites/
  cart/
  analytics/
```

Each service should support:

- `getAll()`
- `getById()`
- `create()`
- `update()`
- `delete()`
- `search()`
- `filters()`

Example:

```txt
src/services/restaurants/restaurant.service.ts
```

## 8. Required Dashboard Navigation

Sidebar pages:

- Dashboard
- Users
- Restaurants
- Branches
- Categories
- Menu Categories
- Menu Items
- Orders
- Order Tracking
- Offers
- Promo Codes
- Reviews
- Favorites
- Cart
- Delivery Fees
- Working Hours
- Analytics
- Query Lab
- Seed Data
- Settings

## 9. Core Pages To Build

### Dashboard Home

Required cards:

- Total Users
- Total Restaurants
- Total Orders
- Total Menu Items
- Total Promo Codes
- Total Reviews
- Total Revenue
- Pending Orders
- Completed Orders
- Cancelled Orders
- Active Offers
- Active Restaurants

Required charts:

- Orders per day
- Revenue per day
- Users growth
- Restaurant growth
- Popular restaurants
- Popular menu items

### Users

Required features:

- List users
- Search users
- Filter by role
- View profile
- Edit profile
- Delete user
- Change role
- View addresses
- View favorites
- View orders
- View reviews
- Create test user
- Block user
- Activate user

### Restaurants

Required features:

- List restaurants
- Search restaurants
- Create restaurant
- Edit restaurant
- Delete restaurant
- Toggle active status
- View owner
- View branches
- View offers
- View reviews
- View orders
- View promo codes

### Branches

Required features:

- Create branch
- Update branch
- Delete branch
- Toggle open status
- Toggle busy status
- Toggle online ordering

### Categories

Required features:

- Create category
- Update category
- Delete category
- Sort ordering
- Upload image

### Menu Categories

Required features:

- Create menu category
- Update menu category
- Delete menu category
- Drag ordering

### Menu Items

Required features:

- Create item
- Update item
- Delete item
- Toggle availability
- Duplicate item
- Connect item to category and branch
- Upload item image

### Orders

Required features:

- View all orders
- Search orders
- Filter by status
- Filter by payment status
- Filter by restaurant
- Filter by date
- Update order status
- Assign order
- Cancel order
- Refund order
- View order details
- View order items
- View customer
- View restaurant
- View address
- View tracking timeline

Supported statuses:

- `pending`
- `accepted`
- `preparing`
- `ready`
- `out_for_delivery`
- `delivered`
- `cancelled`

### Order Tracking

Required features:

- Add tracking event
- View timeline
- Test status progression

### Promo Codes

Required features:

- Create promo code
- Update promo code
- Delete promo code
- Activate promo code
- Deactivate promo code
- Test minimum order price
- Test usage limits
- Test date range validation
- Test discount calculation

### Offers

Required features:

- Create offer
- Update offer
- Delete offer
- Activate offer
- Deactivate offer
- Preview discount effect

### Reviews

Required features:

- List reviews
- Filter by restaurant
- Filter by rating
- Delete review

### Favorite Restaurants

Required features:

- View user favorites
- Add favorite
- Remove favorite

### Cart

Required features:

- View carts
- Clear cart
- Add item
- Remove item
- Change quantity

### Delivery Fees

Required features:

- Create delivery fee
- Update delivery fee
- Delete delivery fee
- View delivery fees

### Working Hours

Required features:

- Create schedule
- Update schedule
- Delete schedule
- Weekly schedule UI

### Query Lab

Route:

```txt
/query-lab
```

Required features:

- Run custom Supabase queries
- View results
- Pagination
- Sorting
- Filtering
- Export results
- Save query presets

Example presets:

- Get all restaurant orders
- Get user statistics
- Get restaurant revenue
- Get top ordered items

### Seed Data

Route:

```txt
/seed
```

Required generators:

- 50 users
- 20 restaurants
- 50 branches
- 200 menu items
- 300 orders
- 100 reviews
- 50 offers
- 50 promo codes

Purpose:

- Prepare realistic test data before Flutter mobile app integration.

### Analytics

Required sections:

- Revenue analytics
- Orders analytics
- Restaurants analytics
- Users analytics
- Top selling items
- Most active users
- Most popular restaurants

Required charts:

- Bar chart
- Line chart
- Pie chart

## 10. Realtime Requirements

Use Supabase realtime for:

- Orders
- Order tracking
- Reviews
- Cart
- Offers
- Notifications, if available

Example:

```ts
supabase
  .channel("orders")
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "orders",
    },
    (payload) => {
      console.log(payload);
    }
  )
  .subscribe();
```

## 11. Storage Requirements

Create reusable image upload support for:

- Restaurant logos
- Restaurant cover images
- Menu item images
- Category images

Upload component requirements:

- Preview selected image
- Upload loading state
- Error handling
- Remove/replace image
- Store public URL or storage path depending on backend design

## 12. Error Handling Requirements

Implement:

- Global API error handler
- Toast notifications
- Loading states
- Empty states
- Error boundaries
- Retry mechanisms
- Form validation messages

## 13. Security Requirements

Implement:

- Protected routes
- Admin-only pages
- Role-based permissions
- Session handling
- Middleware authentication
- No service role key in frontend code

## 14. Performance Requirements

Implement:

- Pagination
- Infinite scroll where useful
- React Query caching
- Lazy loading
- Image optimization
- Debounced search
- Server-side filtering where possible

## 15. Development Phases

### Phase 1 - Project Setup

Target:

- Create Next.js project
- Install required packages
- Configure Tailwind CSS
- Configure Shadcn UI
- Configure Supabase client
- Configure providers
- Configure base layout

Done when:

- App runs locally
- Supabase connection works
- Dashboard shell is visible

### Phase 2 - Foundation

Target:

- Create folder structure
- Create types
- Create service layer pattern
- Create reusable table component
- Create reusable form components
- Create reusable page header/actions
- Create loading, empty, and error states

Done when:

- One module can be built using the shared pattern

### Phase 3 - Core CRUD Modules

Target:

- Users
- Restaurants
- Branches
- Categories
- Menu categories
- Menu items

Done when:

- All core entities can be listed, created, updated, deleted, searched, and filtered

### Phase 4 - Order Flow Modules

Target:

- Orders
- Order tracking
- Cart
- Favorites

Done when:

- Complete order lifecycle can be simulated and debugged

### Phase 5 - Business Logic Modules

Target:

- Promo codes
- Offers
- Delivery fees
- Working hours
- Reviews

Done when:

- Pricing, discount, availability, and review flows can be tested

### Phase 6 - Realtime, Query Lab, And Seed Data

Target:

- Supabase realtime listeners
- Query Lab page
- Seed Data page
- Export results
- Save query presets

Done when:

- Realtime changes appear in dashboard
- Test data can be generated
- Custom queries can be tested

### Phase 7 - Analytics And Final Testing

Target:

- Dashboard metrics
- Revenue analytics
- Order analytics
- User analytics
- Restaurant analytics
- Popular items and restaurants

Done when:

- Dashboard gives a clear test overview of backend state

## 16. Final Acceptance Criteria

The dashboard is complete when:

- All listed modules are accessible from the sidebar
- All main database entities can be viewed
- Core entities support CRUD actions
- Orders can be tested through their full lifecycle
- Promo code and offer logic can be tested
- Realtime updates work for selected tables
- Query Lab can run and display test queries
- Seed page can generate test data
- Analytics pages show useful charts
- Forms use validation
- Tables support search, filters, sorting, and pagination
- Protected routes prevent unauthorized access
- Errors and loading states are handled clearly
- The backend is ready for Flutter mobile integration testing

## 17. Important Notes Before Starting

- Confirm the real Supabase schema before implementing services.
- Do not assume field names beyond the current plan without checking the database.
- Keep this dashboard focused on testing and debugging, not final production polish.
- Build reusable module patterns early to avoid repeating table and form logic.
- Keep seed actions protected because they can create large amounts of data.
- Keep dangerous actions such as delete, refund, and clear cart behind confirmation dialogs.
- Prefer server-side filtering and pagination for large tables.
- Use TypeScript types generated from Supabase if possible.
