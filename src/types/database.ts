export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at: string
          id: string
          ip_address: unknown
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          created_at?: string
          id?: string
          ip_address?: unknown
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_phones: {
        Row: {
          branch_id: string
          id: string
          phone: string
        }
        Insert: {
          branch_id: string
          id?: string
          phone: string
        }
        Update: {
          branch_id?: string
          id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_phones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_working_hours: {
        Row: {
          branch_id: string
          close_time: string | null
          created_at: string
          day_of_week: number
          id: string
          is_closed: boolean
          open_time: string | null
          updated_at: string
        }
        Insert: {
          branch_id: string
          close_time?: string | null
          created_at?: string
          day_of_week: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          updated_at?: string
        }
        Update: {
          branch_id?: string
          close_time?: string | null
          created_at?: string
          day_of_week?: number
          id?: string
          is_closed?: boolean
          open_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_working_hours_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address_ar: string
          address_en: string
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          location_url: string | null
          name_ar: string | null
          name_en: string | null
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          address_ar: string
          address_en: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          location_url?: string | null
          name_ar?: string | null
          name_en?: string | null
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          address_ar?: string
          address_en?: string
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          location_url?: string | null
          name_ar?: string | null
          name_en?: string | null
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          menu_item_id: string
          quantity: number
          special_instructions: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          menu_item_id: string
          quantity?: number
          special_instructions?: string | null
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          menu_item_id?: string
          quantity?: number
          special_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          is_active: boolean
          name_ar: string
          name_en: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar: string
          name_en: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          is_active?: boolean
          name_ar?: string
          name_en?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          last_used_at: string
          platform: Database["public"]["Enums"]["device_platform"]
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string
          platform: Database["public"]["Enums"]["device_platform"]
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          last_used_at?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_change_requests: {
        Row: {
          action: string
          admin_note: string | null
          created_at: string | null
          id: string
          menu_item_id: string | null
          owner_note: string | null
          proposed_data: Json
          requested_by: string
          restaurant_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          action: string
          admin_note?: string | null
          created_at?: string | null
          id?: string
          menu_item_id?: string | null
          owner_note?: string | null
          proposed_data?: Json
          requested_by: string
          restaurant_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          action?: string
          admin_note?: string | null
          created_at?: string | null
          id?: string
          menu_item_id?: string | null
          owner_note?: string | null
          proposed_data?: Json
          requested_by?: string
          restaurant_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_change_requests_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_change_requests_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_option_choices: {
        Row: {
          created_at: string
          id: string
          is_available: boolean
          name_ar: string
          name_en: string | null
          option_id: string
          price_extra: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_available?: boolean
          name_ar: string
          name_en?: string | null
          option_id: string
          price_extra?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_available?: boolean
          name_ar?: string
          name_en?: string | null
          option_id?: string
          price_extra?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_option_choices_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "menu_item_options"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_options: {
        Row: {
          allow_multiple: boolean
          created_at: string
          id: string
          is_required: boolean
          menu_item_id: string
          name_ar: string
          name_en: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          allow_multiple?: boolean
          created_at?: string
          id?: string
          is_required?: boolean
          menu_item_id: string
          name_ar: string
          name_en?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allow_multiple?: boolean
          created_at?: string
          id?: string
          is_required?: boolean
          menu_item_id?: string
          name_ar?: string
          name_en?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_options_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          id: string
          image_url: string | null
          is_available: boolean
          name_ar: string
          name_en: string
          price: number
          restaurant_category_id: string | null
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name_ar: string
          name_en: string
          price: number
          restaurant_category_id?: string | null
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          id?: string
          image_url?: string | null
          is_available?: boolean
          name_ar?: string
          name_en?: string
          price?: number
          restaurant_category_id?: string | null
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_category_id_fkey"
            columns: ["restaurant_category_id"]
            isOneToOne: false
            referencedRelation: "restaurant_menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_campaigns: {
        Row: {
          body_ar: string
          body_en: string | null
          created_at: string
          error_log: string | null
          extra_data: Json
          failed_count: number
          id: string
          image_url: string | null
          sent_at: string | null
          sent_by: string | null
          sent_count: number
          status: string
          target_count: number
          target_filter: Json
          target_type: Database["public"]["Enums"]["notification_target"]
          title_ar: string
          title_en: string | null
        }
        Insert: {
          body_ar: string
          body_en?: string | null
          created_at?: string
          error_log?: string | null
          extra_data?: Json
          failed_count?: number
          id?: string
          image_url?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_count?: number
          status?: string
          target_count?: number
          target_filter?: Json
          target_type: Database["public"]["Enums"]["notification_target"]
          title_ar: string
          title_en?: string | null
        }
        Update: {
          body_ar?: string
          body_en?: string | null
          created_at?: string
          error_log?: string | null
          extra_data?: Json
          failed_count?: number
          id?: string
          image_url?: string | null
          sent_at?: string | null
          sent_by?: string | null
          sent_count?: number
          status?: string
          target_count?: number
          target_filter?: Json
          target_type?: Database["public"]["Enums"]["notification_target"]
          title_ar?: string
          title_en?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_campaigns_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          created_at: string
          description_ar: string | null
          description_en: string | null
          discount_percentage: number
          end_date: string | null
          id: string
          image_url: string | null
          is_active: boolean
          restaurant_id: string
          start_date: string | null
          title_ar: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          discount_percentage: number
          end_date?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          restaurant_id: string
          start_date?: string | null
          title_ar: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          discount_percentage?: number
          end_date?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          restaurant_id?: string
          start_date?: string | null
          title_ar?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          item_name_ar: string
          item_name_en: string
          menu_item_id: string | null
          order_id: string
          price: number
          quantity: number
          special_instructions: string | null
        }
        Insert: {
          id?: string
          item_name_ar: string
          item_name_en: string
          menu_item_id?: string | null
          order_id: string
          price: number
          quantity?: number
          special_instructions?: string | null
        }
        Update: {
          id?: string
          item_name_ar?: string
          item_name_en?: string
          menu_item_id?: string | null
          order_id?: string
          price?: number
          quantity?: number
          special_instructions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          notes: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          branch_id: string | null
          branch_lat: number | null
          branch_lng: number | null
          claimed_at: string | null
          commission_amount: number
          commission_percentage: number
          contact_phone: string
          created_at: string
          delivered_at: string | null
          delivery_address: string | null
          delivery_address_id: string | null
          delivery_distance_km: number | null
          delivery_fee: number
          delivery_lat: number | null
          delivery_lng: number | null
          discount: number
          driver_id: string | null
          estimated_preparation_minutes: number | null
          id: string
          notes: string | null
          order_type: Database["public"]["Enums"]["order_type"]
          picked_up_at: string | null
          rated_at: string | null
          rejection_reason: string | null
          restaurant_id: string
          restaurant_rating: number | null
          restaurant_revenue: number
          restaurant_review: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total_amount: number
          updated_at: string
          user_id: string
          voucher_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          branch_id?: string | null
          branch_lat?: number | null
          branch_lng?: number | null
          claimed_at?: string | null
          commission_amount?: number
          commission_percentage?: number
          contact_phone: string
          created_at?: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_address_id?: string | null
          delivery_distance_km?: number | null
          delivery_fee?: number
          delivery_lat?: number | null
          delivery_lng?: number | null
          discount?: number
          driver_id?: string | null
          estimated_preparation_minutes?: number | null
          id?: string
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          picked_up_at?: string | null
          rated_at?: string | null
          rejection_reason?: string | null
          restaurant_id: string
          restaurant_rating?: number | null
          restaurant_revenue?: number
          restaurant_review?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total_amount?: number
          updated_at?: string
          user_id: string
          voucher_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          branch_id?: string | null
          branch_lat?: number | null
          branch_lng?: number | null
          claimed_at?: string | null
          commission_amount?: number
          commission_percentage?: number
          contact_phone?: string
          created_at?: string
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_address_id?: string | null
          delivery_distance_km?: number | null
          delivery_fee?: number
          delivery_lat?: number | null
          delivery_lng?: number | null
          discount?: number
          driver_id?: string | null
          estimated_preparation_minutes?: number | null
          id?: string
          notes?: string | null
          order_type?: Database["public"]["Enums"]["order_type"]
          picked_up_at?: string | null
          rated_at?: string | null
          rejection_reason?: string | null
          restaurant_id?: string
          restaurant_rating?: number | null
          restaurant_revenue?: number
          restaurant_review?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total_amount?: number
          updated_at?: string
          user_id?: string
          voucher_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_address_id_fkey"
            columns: ["delivery_address_id"]
            isOneToOne: false
            referencedRelation: "user_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "vouchers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_active: boolean
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      restaurant_categories: {
        Row: {
          category_id: string
          restaurant_id: string
        }
        Insert: {
          category_id: string
          restaurant_id: string
        }
        Update: {
          category_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_gallery: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_gallery_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_menu_categories: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          name_ar: string
          name_en: string
          restaurant_id: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          name_ar: string
          name_en?: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          name_ar?: string
          name_en?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_owners: {
        Row: {
          created_at: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_owners_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_owners_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          accepts_online_orders: boolean
          commission_percentage: number
          cover_url: string | null
          created_at: string
          description_ar: string | null
          description_en: string | null
          estimated_delivery_time: number
          id: string
          is_accepting_orders: boolean
          is_active: boolean
          logo_url: string | null
          name_ar: string
          name_en: string
          updated_at: string
        }
        Insert: {
          accepts_online_orders?: boolean
          commission_percentage?: number
          cover_url?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimated_delivery_time?: number
          id?: string
          is_accepting_orders?: boolean
          is_active?: boolean
          logo_url?: string | null
          name_ar: string
          name_en: string
          updated_at?: string
        }
        Update: {
          accepts_online_orders?: boolean
          commission_percentage?: number
          cover_url?: string | null
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          estimated_delivery_time?: number
          id?: string
          is_accepting_orders?: boolean
          is_active?: boolean
          logo_url?: string | null
          name_ar?: string
          name_en?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_addresses: {
        Row: {
          address_ar: string
          address_en: string | null
          address_type: string
          created_at: string
          custom_label: string | null
          id: string
          is_default: boolean
          label: string
          lat: number | null
          lng: number | null
          location_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address_ar: string
          address_en?: string | null
          address_type?: string
          created_at?: string
          custom_label?: string | null
          id?: string
          is_default?: boolean
          label?: string
          lat?: number | null
          lng?: number | null
          location_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address_ar?: string
          address_en?: string | null
          address_type?: string
          created_at?: string
          custom_label?: string | null
          id?: string
          is_default?: boolean
          label?: string
          lat?: number | null
          lng?: number | null
          location_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_favorite_restaurants: {
        Row: {
          created_at: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_favorite_restaurants_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_favorite_restaurants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_notifications: {
        Row: {
          body: string
          campaign_id: string | null
          created_at: string
          extra_data: Json
          id: string
          image_url: string | null
          is_read: boolean
          title: string
          user_id: string
        }
        Insert: {
          body: string
          campaign_id?: string | null
          created_at?: string
          extra_data?: Json
          id?: string
          image_url?: string | null
          is_read?: boolean
          title: string
          user_id: string
        }
        Update: {
          body?: string
          campaign_id?: string | null
          created_at?: string
          extra_data?: Json
          id?: string
          image_url?: string | null
          is_read?: boolean
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_notifications_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "notification_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vouchers: {
        Row: {
          code: string
          created_at: string
          discount_type: Database["public"]["Enums"]["discount_type_enum"]
          discount_value: number
          id: string
          is_active: boolean
          min_order_amount: number
          restaurant_id: string
          updated_at: string
          usage_limit: number | null
          used_count: number
          valid_from: string
          valid_to: string
        }
        Insert: {
          code: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["discount_type_enum"]
          discount_value: number
          id?: string
          is_active?: boolean
          min_order_amount?: number
          restaurant_id: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_from?: string
          valid_to: string
        }
        Update: {
          code?: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["discount_type_enum"]
          discount_value?: number
          id?: string
          is_active?: boolean
          min_order_amount?: number
          restaurant_id?: string
          updated_at?: string
          usage_limit?: number | null
          used_count?: number
          valid_from?: string
          valid_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "vouchers_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _build_cart_response: {
        Args: { p_cart_id: string; p_user_id: string }
        Returns: Json
      }
      compute_delivery_fee: {
        Args: { p_address_id: string; p_branch_id: string }
        Returns: {
          currency: string
          distance_km: number
          fee: number
          in_range: boolean
          needs_pin: boolean
        }[]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      driver_order_json: { Args: { p_order_id: string }; Returns: Json }
      get_delivery_config: { Args: never; Returns: Json }
      get_my_restaurant_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
      haversine_km: {
        Args: { p_lat1: number; p_lat2: number; p_lng1: number; p_lng2: number }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_driver: { Args: never; Returns: boolean }
      is_restaurant_owner: { Args: never; Returns: boolean }
      notify_order_event: {
        Args: { p_event: string; p_order_id: string }
        Returns: undefined
      }
      owner_order_json: { Args: { p_order_id: string }; Returns: Json }
      rpc_add_to_cart: {
        Args: {
          p_menu_item_id: string
          p_quantity?: number
          p_special_instructions?: string
        }
        Returns: Json
      }
      rpc_admin_create_restaurant: {
        Args: {
          p_accepts_online?: boolean
          p_category_ids?: string[]
          p_commission_percentage?: number
          p_cover_url?: string
          p_description_ar?: string
          p_description_en?: string
          p_logo_url?: string
          p_name_ar: string
          p_name_en: string
        }
        Returns: Json
      }
      rpc_admin_get_campaign: { Args: { p_campaign_id: string }; Returns: Json }
      rpc_admin_get_financial_report: {
        Args: {
          p_from?: string
          p_group_by?: string
          p_restaurant_id?: string
          p_to?: string
        }
        Returns: Json
      }
      rpc_admin_get_menu_item_requests: {
        Args: { p_page?: number; p_page_size?: number; p_status?: string }
        Returns: Json
      }
      rpc_admin_get_order_history: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_admin_get_ratings: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_rating?: number
          p_restaurant_id?: string
        }
        Returns: Json
      }
      rpc_admin_get_stats: { Args: never; Returns: Json }
      rpc_admin_get_unclaimed_orders: { Args: never; Returns: Json }
      rpc_admin_get_working_hours: {
        Args: { p_branch_id: string }
        Returns: Json
      }
      rpc_admin_link_owner_to_restaurant: {
        Args: { p_restaurant_id: string; p_user_id: string }
        Returns: Json
      }
      rpc_admin_list_addresses: {
        Args: { p_page?: number; p_page_size?: number; p_user_id?: string }
        Returns: Json
      }
      rpc_admin_list_audit_logs: {
        Args: {
          p_action?: string
          p_page?: number
          p_page_size?: number
          p_table_name?: string
          p_user_id?: string
        }
        Returns: Json
      }
      rpc_admin_list_campaigns: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_sent_by?: string
          p_target_type?: string
        }
        Returns: Json
      }
      rpc_admin_list_favorites: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_restaurant_id?: string
          p_user_id?: string
        }
        Returns: Json
      }
      rpc_admin_list_orders: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_restaurant_id?: string
          p_status?: string
          p_user_id?: string
        }
        Returns: Json
      }
      rpc_admin_list_users: {
        Args: {
          p_page?: number
          p_page_size?: number
          p_role?: string
          p_search?: string
        }
        Returns: Json
      }
      rpc_admin_manage_category: {
        Args: {
          p_action: string
          p_id?: string
          p_image_url?: string
          p_is_active?: boolean
          p_name_ar?: string
          p_name_en?: string
          p_sort_order?: number
        }
        Returns: Json
      }
      rpc_admin_manage_menu_option: {
        Args: {
          p_action: string
          p_allow_multiple?: boolean
          p_id?: string
          p_is_available?: boolean
          p_is_required?: boolean
          p_menu_item_id?: string
          p_name_ar?: string
          p_name_en?: string
          p_option_id?: string
          p_price_extra?: number
          p_sort_order?: number
        }
        Returns: Json
      }
      rpc_admin_manage_working_hours: {
        Args: { p_branch_id: string; p_hours: Json }
        Returns: Json
      }
      rpc_admin_review_menu_item_request: {
        Args: { p_admin_note?: string; p_request_id: string; p_status: string }
        Returns: Json
      }
      rpc_admin_send_notification: {
        Args: {
          p_body_ar: string
          p_body_en?: string
          p_data?: Json
          p_image_url?: string
          p_target_filter?: Json
          p_target_type?: string
          p_title_ar: string
          p_title_en?: string
        }
        Returns: Json
      }
      rpc_admin_update_user: {
        Args: {
          p_full_name?: string
          p_is_active?: boolean
          p_phone?: string
          p_role?: string
          p_user_id: string
        }
        Returns: Json
      }
      rpc_checkout: {
        Args: {
          p_branch_id?: string
          p_contact_phone?: string
          p_delivery_address?: string
          p_delivery_address_id?: string
          p_notes?: string
          p_order_type?: string
          p_voucher_code?: string
        }
        Returns: Json
      }
      rpc_clear_cart: { Args: never; Returns: Json }
      rpc_customer_cancel_order: { Args: { p_order_id: string }; Returns: Json }
      rpc_delete_my_address: { Args: { p_id: string }; Returns: Json }
      rpc_driver_claim_order: { Args: { p_order_id: string }; Returns: Json }
      rpc_driver_get_active_orders: { Args: never; Returns: Json }
      rpc_driver_get_available_orders: {
        Args: { p_page?: number; p_page_size?: number }
        Returns: Json
      }
      rpc_driver_get_order_detail: {
        Args: { p_order_id: string }
        Returns: Json
      }
      rpc_driver_get_stats: { Args: never; Returns: Json }
      rpc_driver_update_order_status: {
        Args: { p_new_status: string; p_order_id: string }
        Returns: Json
      }
      rpc_get_branches: { Args: { p_restaurant_id: string }; Returns: Json }
      rpc_get_categories: { Args: never; Returns: Json }
      rpc_get_menu_items: {
        Args: {
          p_category_id?: string
          p_max_price?: number
          p_min_price?: number
          p_page?: number
          p_page_size?: number
          p_restaurant_id?: string
          p_search?: string
        }
        Returns: Json
      }
      rpc_get_my_cart: { Args: never; Returns: Json }
      rpc_get_my_notifications: {
        Args: { p_page?: number; p_page_size?: number; p_unread_only?: boolean }
        Returns: Json
      }
      rpc_get_my_orders: {
        Args: { p_page?: number; p_page_size?: number; p_status?: string }
        Returns: Json
      }
      rpc_get_my_profile: { Args: never; Returns: Json }
      rpc_get_offers: {
        Args: { p_active_only?: boolean; p_restaurant_id?: string }
        Returns: Json
      }
      rpc_get_order_detail: { Args: { p_order_id: string }; Returns: Json }
      rpc_get_restaurant_detail: {
        Args: { p_restaurant_id: string }
        Returns: Json
      }
      rpc_get_restaurants: {
        Args: {
          p_accepts_online?: boolean
          p_category_id?: string
          p_is_accepting?: boolean
          p_page?: number
          p_page_size?: number
          p_search?: string
        }
        Returns: Json
      }
      rpc_get_vouchers: { Args: { p_restaurant_id: string }; Returns: Json }
      rpc_list_my_addresses: { Args: never; Returns: Json }
      rpc_mark_notifications_read: {
        Args: { p_notification_ids?: string[] }
        Returns: Json
      }
      rpc_owner_accept_order: {
        Args: { p_order_id: string; p_prep_minutes: number }
        Returns: Json
      }
      rpc_owner_delete_menu_item: { Args: { p_item_id: string }; Returns: Json }
      rpc_owner_get_dashboard: { Args: never; Returns: Json }
      rpc_owner_get_menu_categories: { Args: never; Returns: Json }
      rpc_owner_get_menu_items: { Args: never; Returns: Json }
      rpc_owner_get_orders: {
        Args: { p_page?: number; p_page_size?: number; p_status?: string }
        Returns: Json
      }
      rpc_owner_manage_branch: {
        Args: {
          p_action: string
          p_address_ar?: string
          p_address_en?: string
          p_id?: string
          p_location_url?: string
          p_name_ar?: string
          p_name_en?: string
          p_phones?: string[]
        }
        Returns: Json
      }
      rpc_owner_manage_gallery: {
        Args: {
          p_action: string
          p_description?: string
          p_id?: string
          p_image_url?: string
          p_sort_order?: number
        }
        Returns: Json
      }
      rpc_owner_manage_menu_category: {
        Args: {
          p_action: string
          p_id?: string
          p_is_active?: boolean
          p_name_ar?: string
          p_name_en?: string
          p_sort_order?: number
        }
        Returns: Json
      }
      rpc_owner_manage_menu_item: {
        Args: {
          p_action: string
          p_category_id?: string
          p_description_ar?: string
          p_description_en?: string
          p_id?: string
          p_image_url?: string
          p_is_available?: boolean
          p_name_ar?: string
          p_name_en?: string
          p_price?: number
          p_sort_order?: number
        }
        Returns: Json
      }
      rpc_owner_manage_offer: {
        Args: {
          p_action: string
          p_description_ar?: string
          p_description_en?: string
          p_discount_percentage?: number
          p_end_date?: string
          p_id?: string
          p_image_url?: string
          p_is_active?: boolean
          p_start_date?: string
          p_title_ar?: string
          p_title_en?: string
        }
        Returns: Json
      }
      rpc_owner_manage_voucher: {
        Args: {
          p_action: string
          p_code?: string
          p_discount_type?: string
          p_discount_value?: number
          p_id?: string
          p_is_active?: boolean
          p_min_order_amount?: number
          p_usage_limit?: number
          p_valid_from?: string
          p_valid_to?: string
        }
        Returns: Json
      }
      rpc_owner_reject_order: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      rpc_owner_submit_menu_item_request: {
        Args: {
          p_action: string
          p_menu_item_id?: string
          p_owner_note?: string
          p_proposed_data?: Json
        }
        Returns: Json
      }
      rpc_owner_toggle_item_availability: {
        Args: { p_is_available: boolean; p_item_id: string }
        Returns: Json
      }
      rpc_owner_update_order_status: {
        Args: { p_new_status: string; p_order_id: string }
        Returns: Json
      }
      rpc_owner_update_restaurant: {
        Args: {
          p_accepts_online_orders?: boolean
          p_cover_url?: string
          p_description_ar?: string
          p_description_en?: string
          p_estimated_delivery?: number
          p_is_accepting_orders?: boolean
          p_logo_url?: string
          p_name_ar?: string
          p_name_en?: string
        }
        Returns: Json
      }
      rpc_owner_update_restaurant_settings: {
        Args: {
          p_estimated_delivery_time?: number
          p_is_accepting_orders?: boolean
        }
        Returns: Json
      }
      rpc_owner_upsert_menu_item: { Args: { p_item: Json }; Returns: Json }
      rpc_rate_order: {
        Args: { p_order_id: string; p_rating: number; p_review?: string }
        Returns: Json
      }
      rpc_register_device_token: {
        Args: { p_platform: string; p_token: string }
        Returns: Json
      }
      rpc_remove_cart_item: { Args: { p_cart_item_id: string }; Returns: Json }
      rpc_set_default_address: { Args: { p_id: string }; Returns: Json }
      rpc_unregister_device_token: { Args: { p_token: string }; Returns: Json }
      rpc_update_cart_item: {
        Args: {
          p_cart_item_id: string
          p_quantity: number
          p_special_instructions?: string
        }
        Returns: Json
      }
      rpc_update_order_status: {
        Args: { p_order_id: string; p_status: string }
        Returns: Json
      }
      rpc_update_profile: {
        Args: {
          p_avatar_url?: string
          p_full_name?: string
          p_gender?: string
          p_phone?: string
        }
        Returns: Json
      }
      rpc_upsert_my_address: {
        Args: {
          p_address_ar?: string
          p_address_en?: string
          p_address_type?: string
          p_custom_label?: string
          p_id?: string
          p_is_default?: boolean
          p_label?: string
          p_lat?: number
          p_lng?: number
        }
        Returns: Json
      }
      rpc_validate_voucher: {
        Args: { p_code: string; p_restaurant_id: string; p_subtotal: number }
        Returns: Json
      }
    }
    Enums: {
      audit_action: "create" | "update" | "delete"
      device_platform: "android" | "ios" | "web"
      discount_type_enum: "fixed" | "percentage"
      gender_type: "male" | "female"
      notification_target:
        | "all_customers"
        | "all_restaurants"
        | "platform_android"
        | "platform_ios"
        | "custom"
      order_status:
        | "pending"
        | "preparing"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
        | "rejected"
        | "ready_for_pickup"
        | "picked_up_by_customer"
      order_type: "delivery" | "pickup"
      user_role: "customer" | "restaurant" | "admin" | "driver"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_action: ["create", "update", "delete"],
      device_platform: ["android", "ios", "web"],
      discount_type_enum: ["fixed", "percentage"],
      gender_type: ["male", "female"],
      notification_target: [
        "all_customers",
        "all_restaurants",
        "platform_android",
        "platform_ios",
        "custom",
      ],
      order_status: [
        "pending",
        "preparing",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "rejected",
        "ready_for_pickup",
        "picked_up_by_customer",
      ],
      order_type: ["delivery", "pickup"],
      user_role: ["customer", "restaurant", "admin", "driver"],
    },
  },
} as const

// ──────────────────────────────────────────────────────────────
// Convenience aliases derived from the generated Database type.
// Add new aliases here as the codebase needs them.
// ──────────────────────────────────────────────────────────────

type PublicTables = Database["public"]["Tables"];
type PublicEnums = Database["public"]["Enums"];

export type TableName = keyof PublicTables;
export type TableRow<T extends TableName> = PublicTables[T]["Row"];
export type TableInsert<T extends TableName> = PublicTables[T]["Insert"];
export type TableUpdate<T extends TableName> = PublicTables[T]["Update"];

export type GenericRow = Record<string, unknown>;

// Enums
export type UserRole = PublicEnums["user_role"];
export type GenderType = PublicEnums["gender_type"];
export type OrderStatus = PublicEnums["order_status"];
export type OrderType = PublicEnums["order_type"];
export type DiscountTypeEnum = PublicEnums["discount_type_enum"];
export type NotificationTarget = PublicEnums["notification_target"];
export type DevicePlatform = PublicEnums["device_platform"];
export type AuditAction = PublicEnums["audit_action"];

// Rows / Insert / Update aliases for the tables the app touches by name.
export type Profile = TableRow<"profiles">;
export type ProfileInsert = TableInsert<"profiles">;
export type ProfileUpdate = TableUpdate<"profiles">;

export type Category = TableRow<"categories">;
export type CategoryInsert = TableInsert<"categories">;
export type CategoryUpdate = TableUpdate<"categories">;

export type Restaurant = TableRow<"restaurants">;
export type RestaurantInsert = TableInsert<"restaurants">;
export type RestaurantUpdate = TableUpdate<"restaurants">;

export type RestaurantOwner = TableRow<"restaurant_owners">;

export type Branch = TableRow<"branches">;
export type BranchInsert = TableInsert<"branches">;
export type BranchUpdate = TableUpdate<"branches">;

export type BranchPhone = TableRow<"branch_phones">;
export type BranchPhoneInsert = TableInsert<"branch_phones">;

export type MenuItem = TableRow<"menu_items">;
export type MenuItemInsert = TableInsert<"menu_items">;
export type MenuItemUpdate = TableUpdate<"menu_items">;

export type RestaurantGallery = TableRow<"restaurant_gallery">;
export type RestaurantGalleryInsert = TableInsert<"restaurant_gallery">;
export type RestaurantGalleryUpdate = TableUpdate<"restaurant_gallery">;

export type Offer = TableRow<"offers">;
export type OfferInsert = TableInsert<"offers">;
export type OfferUpdate = TableUpdate<"offers">;

export type Voucher = TableRow<"vouchers">;
export type VoucherInsert = TableInsert<"vouchers">;
export type VoucherUpdate = TableUpdate<"vouchers">;

export type Order = TableRow<"orders">;
export type OrderInsert = TableInsert<"orders">;
export type OrderUpdate = TableUpdate<"orders">;

export type CartItem = TableRow<"cart_items">;

export type UserAddress = TableRow<"user_addresses">;
export type UserAddressInsert = TableInsert<"user_addresses">;
export type UserAddressUpdate = TableUpdate<"user_addresses">;

export type UserFavorite = TableRow<"user_favorite_restaurants">;
export type OrderStatusHistory = TableRow<"order_status_history">;
export type BranchWorkingHours = TableRow<"branch_working_hours">;
export type BranchWorkingHoursInsert = TableInsert<"branch_working_hours">;
export type MenuItemOption = TableRow<"menu_item_options">;
export type MenuItemOptionChoice = TableRow<"menu_item_option_choices">;
