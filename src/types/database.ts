export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: unknown[];
};

// ── Enums ─────────────────────────────────────────────────────
export type UserRole = "customer" | "restaurant" | "admin";
export type GenderType = "male" | "female";
export type OrderStatus = "pending" | "preparing" | "out_for_delivery" | "delivered" | "cancelled";
export type DiscountTypeEnum = "fixed" | "percentage";
export type NotificationTarget = "all_customers" | "all_restaurants" | "platform_android" | "platform_ios" | "custom";
export type DevicePlatform = "android" | "ios" | "web";
export type AuditAction = "create" | "update" | "delete";

// ── Row types ──────────────────────────────────────────────────

export type Profile = {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  gender: GenderType | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  role?: UserRole;
  full_name?: string | null;
  phone?: string | null;
  gender?: GenderType | null;
  avatar_url?: string | null;
  is_active?: boolean;
};

export type ProfileUpdate = Partial<Omit<ProfileInsert, "id">>;

export type Category = {
  id: string;
  name_ar: string;
  name_en: string;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CategoryInsert = {
  name_ar: string;
  name_en: string;
  image_url?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export type CategoryUpdate = Partial<CategoryInsert>;

export type Restaurant = {
  id: string;
  name_ar: string;
  name_en: string;
  logo_url: string | null;
  cover_url: string | null;
  description_ar: string | null;
  description_en: string | null;
  accepts_online_orders: boolean;
  is_accepting_orders: boolean;
  estimated_delivery_time: number;
  delivery_fee: number;
  min_order_amount: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RestaurantInsert = {
  name_ar: string;
  name_en: string;
  logo_url?: string | null;
  cover_url?: string | null;
  description_ar?: string | null;
  description_en?: string | null;
  accepts_online_orders?: boolean;
  is_accepting_orders?: boolean;
  estimated_delivery_time?: number;
  delivery_fee?: number;
  min_order_amount?: number;
  is_active?: boolean;
};

export type RestaurantUpdate = Partial<RestaurantInsert>;

export type RestaurantOwner = {
  id: string;
  user_id: string;
  restaurant_id: string;
  created_at: string;
};

export type Branch = {
  id: string;
  restaurant_id: string;
  name_ar: string | null;
  name_en: string | null;
  address_ar: string;
  address_en: string;
  location_url: string | null;
  created_at: string;
  updated_at: string;
};

export type BranchInsert = {
  restaurant_id: string;
  name_ar?: string | null;
  name_en?: string | null;
  address_ar: string;
  address_en: string;
  location_url?: string | null;
};

export type BranchUpdate = Partial<Omit<BranchInsert, "restaurant_id">>;

export type MenuItem = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name_ar: string;
  name_en: string;
  price: number;
  description_ar: string | null;
  description_en: string | null;
  image_url: string | null;
  is_available: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MenuItemInsert = {
  restaurant_id: string;
  category_id?: string | null;
  name_ar: string;
  name_en: string;
  price: number;
  description_ar?: string | null;
  description_en?: string | null;
  image_url?: string | null;
  is_available?: boolean;
  sort_order?: number;
};

export type MenuItemUpdate = Partial<Omit<MenuItemInsert, "restaurant_id">>;

export type RestaurantGallery = {
  id: string;
  restaurant_id: string;
  image_url: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type RestaurantGalleryInsert = {
  restaurant_id: string;
  image_url: string;
  description?: string | null;
  sort_order?: number;
};

export type RestaurantGalleryUpdate = Partial<Omit<RestaurantGalleryInsert, "restaurant_id">>;

export type Offer = {
  id: string;
  restaurant_id: string;
  title_ar: string;
  title_en: string | null;
  description_ar: string | null;
  description_en: string | null;
  image_url: string | null;
  discount_percentage: number;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
};

export type OfferInsert = {
  restaurant_id: string;
  title_ar: string;
  title_en?: string | null;
  description_ar?: string | null;
  description_en?: string | null;
  image_url?: string | null;
  discount_percentage: number;
  is_active?: boolean;
  start_date?: string | null;
  end_date?: string | null;
};

export type OfferUpdate = Partial<Omit<OfferInsert, "restaurant_id">>;

export type Voucher = {
  id: string;
  restaurant_id: string;
  code: string;
  discount_type: DiscountTypeEnum;
  discount_value: number;
  min_order_amount: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  usage_limit: number | null;
  used_count: number;
  created_at: string;
  updated_at: string;
};

export type VoucherInsert = {
  restaurant_id: string;
  code: string;
  discount_type: DiscountTypeEnum;
  discount_value: number;
  min_order_amount?: number;
  valid_from?: string;
  valid_to: string;
  is_active?: boolean;
  usage_limit?: number | null;
};

export type VoucherUpdate = Partial<Omit<VoucherInsert, "restaurant_id">>;

export type Order = {
  id: string;
  user_id: string;
  restaurant_id: string;
  status: OrderStatus;
  delivery_address: string;
  contact_phone: string;
  subtotal: number;
  delivery_fee: number;
  discount: number;
  total_amount: number;
  voucher_id: string | null;
  notes: string | null;
  restaurant_rating: number | null;
  restaurant_review: string | null;
  rated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderInsert = {
  user_id: string;
  restaurant_id: string;
  status?: OrderStatus;
  delivery_address: string;
  contact_phone: string;
  subtotal?: number;
  delivery_fee?: number;
  discount?: number;
  total_amount?: number;
  voucher_id?: string | null;
  notes?: string | null;
};

export type OrderUpdate = Partial<Omit<OrderInsert, "user_id" | "restaurant_id">>;

export type CartItem = {
  id: string;
  cart_id: string;
  menu_item_id: string;
  quantity: number;
  special_instructions: string | null;
  created_at: string;
};

// ── New tables (migration 017) ─────────────────────────────────

export type UserAddress = {
  id: string;
  user_id: string;
  label: string;
  address_ar: string;
  address_en: string | null;
  location_url: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type UserAddressInsert = {
  user_id: string;
  label?: string;
  address_ar: string;
  address_en?: string | null;
  location_url?: string | null;
  is_default?: boolean;
};

export type UserAddressUpdate = Partial<Omit<UserAddressInsert, "user_id">>;

export type UserFavorite = {
  user_id: string;
  restaurant_id: string;
  created_at: string;
};

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  status: OrderStatus;
  notes: string | null;
  changed_by: string | null;
  created_at: string;
};

export type BranchWorkingHours = {
  id: string;
  branch_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  created_at: string;
  updated_at: string;
};

export type BranchWorkingHoursInsert = {
  branch_id: string;
  day_of_week: number;
  open_time?: string | null;
  close_time?: string | null;
  is_closed?: boolean;
};

export type MenuItemOption = {
  id: string;
  menu_item_id: string;
  name_ar: string;
  name_en: string | null;
  is_required: boolean;
  allow_multiple: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MenuItemOptionChoice = {
  id: string;
  option_id: string;
  name_ar: string;
  name_en: string | null;
  price_extra: number;
  is_available: boolean;
  sort_order: number;
  created_at: string;
};

export type GenericRow = Record<string, unknown>;

export type Database = {
  public: {
    Tables: {
      profiles: TableDefinition<Profile, ProfileInsert, ProfileUpdate>;
      categories: TableDefinition<Category, CategoryInsert, CategoryUpdate>;
      restaurants: TableDefinition<Restaurant, RestaurantInsert, RestaurantUpdate>;
      restaurant_owners: TableDefinition<RestaurantOwner, Partial<RestaurantOwner>, Partial<RestaurantOwner>>;
      restaurant_categories: TableDefinition<GenericRow, GenericRow, GenericRow>;
      branches: TableDefinition<Branch, BranchInsert, BranchUpdate>;
      branch_phones: TableDefinition<GenericRow, GenericRow, GenericRow>;
      menu_items: TableDefinition<MenuItem, MenuItemInsert, MenuItemUpdate>;
      restaurant_gallery: TableDefinition<RestaurantGallery, RestaurantGalleryInsert, RestaurantGalleryUpdate>;
      offers: TableDefinition<Offer, OfferInsert, OfferUpdate>;
      vouchers: TableDefinition<Voucher, VoucherInsert, VoucherUpdate>;
      carts: TableDefinition<GenericRow, GenericRow, GenericRow>;
      cart_items: TableDefinition<CartItem, Partial<CartItem>, Partial<CartItem>>;
      orders: TableDefinition<Order, OrderInsert, OrderUpdate>;
      order_items: TableDefinition<GenericRow, GenericRow, GenericRow>;
      device_tokens: TableDefinition<GenericRow, GenericRow, GenericRow>;
      notification_campaigns: TableDefinition<GenericRow, GenericRow, GenericRow>;
      user_notifications: TableDefinition<GenericRow, GenericRow, GenericRow>;
      audit_logs: TableDefinition<GenericRow, GenericRow, GenericRow>;
      // migration 017
      user_addresses: TableDefinition<UserAddress, UserAddressInsert, UserAddressUpdate>;
      user_favorite_restaurants: TableDefinition<UserFavorite, Omit<UserFavorite, "created_at">, Partial<UserFavorite>>;
      order_status_history: TableDefinition<OrderStatusHistory, Omit<OrderStatusHistory, "id" | "created_at">, Partial<OrderStatusHistory>>;
      branch_working_hours: TableDefinition<BranchWorkingHours, BranchWorkingHoursInsert, Partial<BranchWorkingHoursInsert>>;
      menu_item_options: TableDefinition<MenuItemOption, Omit<MenuItemOption, "id" | "created_at" | "updated_at">, Partial<MenuItemOption>>;
      menu_item_option_choices: TableDefinition<MenuItemOptionChoice, Omit<MenuItemOptionChoice, "id" | "created_at">, Partial<MenuItemOptionChoice>>;
    };
    Views: Record<string, unknown>;
    Functions: Record<string, unknown>;
    Enums: {
      user_role: UserRole;
      order_status: OrderStatus;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type TableName = keyof Database["public"]["Tables"];
export type TableRow<TTable extends TableName> = Database["public"]["Tables"][TTable]["Row"];
export type TableInsert<TTable extends TableName> = Database["public"]["Tables"][TTable]["Insert"];
export type TableUpdate<TTable extends TableName> = Database["public"]["Tables"][TTable]["Update"];
