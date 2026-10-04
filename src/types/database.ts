export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      email_reminder_optouts: {
        Row: {
          created_at: string;
          email_hash: string;
        };
        Insert: {
          created_at?: string;
          email_hash: string;
        };
        Update: {
          created_at?: string;
          email_hash?: string;
        };
        Relationships: [];
      };
      events: {
        Row: {
          capacity: number;
          cover_image_url: string | null;
          created_at: string;
          description: string;
          id: string;
          inteira_quota: number | null;
          meia_quota: number | null;
          name: string;
          sales_open: boolean;
          slug: string;
          starts_at: string;
          updated_at: string;
          venue: string;
        };
        Insert: {
          capacity: number;
          cover_image_url?: string | null;
          created_at?: string;
          description?: string;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name: string;
          sales_open?: boolean;
          slug: string;
          starts_at: string;
          updated_at?: string;
          venue: string;
        };
        Update: {
          capacity?: number;
          cover_image_url?: string | null;
          created_at?: string;
          description?: string;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name?: string;
          sales_open?: boolean;
          slug?: string;
          starts_at?: string;
          updated_at?: string;
          venue?: string;
        };
        Relationships: [];
      };
      event_images: {
        Row: {
          created_at: string;
          event_id: string;
          id: string;
          storage_path: string;
        };
        Insert: {
          created_at?: string;
          event_id: string;
          id?: string;
          storage_path: string;
        };
        Update: {
          created_at?: string;
          event_id?: string;
          id?: string;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_images_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      event_sessions: {
        Row: {
          archived_at: string | null;
          cancel_notice_sent_at: string | null;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancelled_by_name: string | null;
          capacity: number;
          created_at: string;
          ends_at: string | null;
          event_id: string;
          id: string;
          inteira_quota: number | null;
          meia_quota: number | null;
          name: string | null;
          sales_open: boolean;
          starts_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          cancel_notice_sent_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_by_name?: string | null;
          capacity: number;
          created_at?: string;
          ends_at?: string | null;
          event_id: string;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name?: string | null;
          sales_open?: boolean;
          starts_at: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          cancel_notice_sent_at?: string | null;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancelled_by_name?: string | null;
          capacity?: number;
          created_at?: string;
          ends_at?: string | null;
          event_id?: string;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name?: string | null;
          sales_open?: boolean;
          starts_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "event_sessions_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      session_schedule_changes: {
        Row: {
          changed_by: string | null;
          created_at: string;
          id: string;
          new_ends_at: string | null;
          new_starts_at: string;
          paid_orders: number;
          previous_ends_at: string | null;
          previous_starts_at: string;
          session_id: string;
        };
        Insert: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          new_ends_at?: string | null;
          new_starts_at: string;
          paid_orders: number;
          previous_ends_at?: string | null;
          previous_starts_at: string;
          session_id: string;
        };
        Update: {
          changed_by?: string | null;
          created_at?: string;
          id?: string;
          new_ends_at?: string | null;
          new_starts_at?: string;
          paid_orders?: number;
          previous_ends_at?: string | null;
          previous_starts_at?: string;
          session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_schedule_changes_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "event_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      session_ticket_types: {
        Row: {
          created_at: string;
          id: string;
          max_units: number | null;
          on_sale: boolean;
          price_cents: number;
          session_id: string;
          ticket_type_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          max_units?: number | null;
          on_sale?: boolean;
          price_cents: number;
          session_id: string;
          ticket_type_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          max_units?: number | null;
          on_sale?: boolean;
          price_cents?: number;
          session_id?: string;
          ticket_type_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_ticket_types_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "event_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_ticket_types_ticket_type_id_fkey";
            columns: ["ticket_type_id"];
            isOneToOne: false;
            referencedRelation: "ticket_types";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          line_total_cents: number;
          name: string;
          order_id: string;
          people_per_unit: number;
          quantity: number;
          ticket_type_id: string;
          unit_price_cents: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          line_total_cents: number;
          name: string;
          order_id: string;
          people_per_unit: number;
          quantity: number;
          ticket_type_id: string;
          unit_price_cents: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_kind"];
          line_total_cents?: number;
          name?: string;
          order_id?: string;
          people_per_unit?: number;
          quantity?: number;
          ticket_type_id?: string;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_ticket_type_id_fkey";
            columns: ["ticket_type_id"];
            isOneToOne: false;
            referencedRelation: "ticket_types";
            referencedColumns: ["id"];
          },
        ];
      };
      order_refunds: {
        Row: {
          amount_cents: number;
          completed_at: string | null;
          created_at: string;
          error_code: string | null;
          id: string;
          idempotency_key: string;
          order_id: string;
          previous_order_status: Database["public"]["Enums"]["order_status"];
          previous_ticket_statuses: Json;
          provider_refund_id: string | null;
          reason: string;
          requested_by: string | null;
          requested_by_name: string | null;
          status: Database["public"]["Enums"]["refund_status"];
        };
        Insert: {
          amount_cents: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key: string;
          order_id: string;
          previous_order_status: Database["public"]["Enums"]["order_status"];
          previous_ticket_statuses?: Json;
          provider_refund_id?: string | null;
          reason: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
        };
        Update: {
          amount_cents?: number;
          completed_at?: string | null;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          idempotency_key?: string;
          order_id?: string;
          previous_order_status?: Database["public"]["Enums"]["order_status"];
          previous_ticket_statuses?: Json;
          provider_refund_id?: string | null;
          reason?: string;
          requested_by?: string | null;
          requested_by_name?: string | null;
          status?: Database["public"]["Enums"]["refund_status"];
        };
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          buyer_email: string;
          buyer_name: string;
          buyer_phone: string | null;
          cancel_reason: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          event_id: string;
          expires_at: string | null;
          hold_extended_at: string | null;
          id: string;
          paid_at: string | null;
          payment_external_id: string | null;
          payment_provider: string | null;
          privacy_accepted_at: string | null;
          privacy_policy_version: string | null;
          provider_order_id: string | null;
          provider_payment_id: string | null;
          public_token: string;
          reminder_attempts: number;
          reminder_claimed_at: string | null;
          reminder_optout_token: string | null;
          reminder_sent_at: string | null;
          session_id: string;
          status: Database["public"]["Enums"]["order_status"];
          total_cents: number;
        };
        Insert: {
          buyer_email: string;
          buyer_name: string;
          buyer_phone?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          event_id: string;
          expires_at?: string | null;
          hold_extended_at?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_external_id?: string | null;
          payment_provider?: string | null;
          privacy_accepted_at?: string | null;
          privacy_policy_version?: string | null;
          provider_order_id?: string | null;
          provider_payment_id?: string | null;
          public_token: string;
          reminder_attempts?: number;
          reminder_claimed_at?: string | null;
          reminder_optout_token?: string | null;
          reminder_sent_at?: string | null;
          session_id?: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_cents: number;
        };
        Update: {
          buyer_email?: string;
          buyer_name?: string;
          buyer_phone?: string | null;
          cancel_reason?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          event_id?: string;
          expires_at?: string | null;
          hold_extended_at?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_external_id?: string | null;
          payment_provider?: string | null;
          privacy_accepted_at?: string | null;
          privacy_policy_version?: string | null;
          provider_order_id?: string | null;
          provider_payment_id?: string | null;
          public_token?: string;
          reminder_attempts?: number;
          reminder_claimed_at?: string | null;
          reminder_optout_token?: string | null;
          reminder_sent_at?: string | null;
          session_id?: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "orders_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_session_event_fkey";
            columns: ["session_id", "event_id"];
            isOneToOne: false;
            referencedRelation: "event_sessions";
            referencedColumns: ["id", "event_id"];
          },
        ];
      };
      rate_limit_hits: {
        Row: {
          bucket: string;
          created_at: string;
          id: number;
          key_hash: string;
        };
        Insert: {
          bucket: string;
          created_at?: string;
          key_hash: string;
        };
        Update: {
          bucket?: string;
          created_at?: string;
          key_hash?: string;
        };
        Relationships: [];
      };
      staff_profiles: {
        Row: {
          created_at: string;
          display_name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ticket_types: {
        Row: {
          active: boolean;
          archived_at: string | null;
          event_id: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          max_units: number | null;
          name: string;
          people_per_unit: number;
          preset: string | null;
          price_cents: number;
          sort_order: number;
        };
        Insert: {
          active?: boolean;
          archived_at?: string | null;
          event_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          max_units?: number | null;
          name: string;
          people_per_unit?: number;
          preset?: string | null;
          price_cents: number;
          sort_order?: number;
        };
        Update: {
          active?: boolean;
          archived_at?: string | null;
          event_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_kind"];
          max_units?: number | null;
          name?: string;
          people_per_unit?: number;
          preset?: string | null;
          price_cents?: number;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
        ];
      };
      tickets: {
        Row: {
          buyer_name: string;
          cancelled_at: string | null;
          checked_in_at: string | null;
          checked_in_by: string | null;
          code: string;
          created_at: string;
          event_id: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          order_id: string;
          order_item_id: string;
          price_cents: number;
          session_id: string;
          status: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id: string;
        };
        Insert: {
          buyer_name: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          code: string;
          created_at?: string;
          event_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          order_id: string;
          order_item_id: string;
          price_cents: number;
          session_id?: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id: string;
        };
        Update: {
          buyer_name?: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          code?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_kind"];
          order_id?: string;
          order_item_id?: string;
          price_cents?: number;
          session_id?: string;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tickets_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_event_id_fkey";
            columns: ["event_id"];
            isOneToOne: false;
            referencedRelation: "events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tickets_order_id_fkey";
            columns: ["order_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id", "session_id"];
          },
          {
            foreignKeyName: "tickets_session_event_fkey";
            columns: ["session_id", "event_id"];
            isOneToOne: false;
            referencedRelation: "event_sessions";
            referencedColumns: ["id", "event_id"];
          },
          {
            foreignKeyName: "tickets_ticket_type_id_fkey";
            columns: ["ticket_type_id"];
            isOneToOne: false;
            referencedRelation: "ticket_types";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      accept_paid_order: {
        Args: { p_order_id: string; p_staff_user_id: string };
        Returns: string;
      };
      begin_order_refund: {
        Args: { p_order_id: string; p_reason: string; p_staff_user_id: string };
        Returns: {
          already_requested: boolean;
          amount_cents: number;
          idempotency_key: string;
          provider_order_id: string | null;
          refund_id: string;
        }[];
      };
      complete_order_refund: {
        Args: { p_provider_refund_id: string | null; p_refund_id: string };
        Returns: string;
      };
      fail_order_refund: {
        Args: { p_error_code: string; p_refund_id: string };
        Returns: string;
      };
      sync_order_refunded: {
        Args: {
          p_external_id: string;
          p_provider: string;
          p_provider_order_id?: string | null;
        };
        Returns: string;
      };
      cancel_order_by_external: {
        Args: { p_external_id: string; p_provider: string };
        Returns: string;
      };
      cancel_pending_order: {
        Args: { p_order_id: string; p_reason: string };
        Returns: string;
      };
      cancel_courtesy_ticket: {
        Args: { p_event_id: string; p_staff_user_id: string; p_ticket_id: string };
        Returns: string;
      };
      check_in_ticket:
        | {
            Args: {
              p_code: string;
              p_event_id: string;
              p_session_id: string;
              p_staff_user_id: string;
            };
            Returns: {
              buyer_name: string | null;
              event_name: string | null;
              other_event_name: string | null;
              other_session_name: string | null;
              other_session_starts_at: string | null;
              outcome: string;
              session_name: string | null;
              session_starts_at: string | null;
              ticket_kind: Database["public"]["Enums"]["ticket_kind"] | null;
              type_name: string | null;
            }[];
          }
        | {
            Args: { p_code: string; p_event_id: string; p_staff_user_id: string };
            Returns: {
              buyer_name: string | null;
              other_event_name: string | null;
              outcome: string;
              ticket_kind: Database["public"]["Enums"]["ticket_kind"] | null;
              type_name: string | null;
            }[];
          };
      consume_rate_limit: {
        Args: {
          p_bucket: string;
          p_key_hash: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
      create_checkout_order: {
        Args: {
          p_buyer_email: string;
          p_buyer_name: string;
          p_buyer_phone: string | null;
          p_event_id: string;
          p_items: Json;
          p_payment_provider: string;
          p_privacy_policy_version?: string | null;
          p_public_token: string;
          p_session_id?: string | null;
        };
        Returns: {
          expires_at: string;
          order_id: string;
          total_cents: number;
        }[];
      };
      event_availability: {
        Args: { p_event_id: string };
        Returns: Json;
      };
      event_sessions_summary: {
        Args: { p_event_id: string };
        Returns: Json;
      };
      session_availability: {
        Args: { p_session_id: string };
        Returns: Json;
      };
      session_is_selling: {
        Args: { p_session_id: string };
        Returns: boolean;
      };
      save_event_with_sessions: {
        Args: {
          p_cover_image_url: string | null;
          p_description: string | null;
          p_event_id: string;
          p_name: string;
          p_sessions: Json;
          p_staff_user_id: string;
          p_ticket_types: Json;
          p_venue: string;
        };
        Returns: undefined;
      };
      set_session_sales_open: {
        Args: { p_open: boolean; p_session_id: string; p_staff_user_id: string };
        Returns: boolean;
      };
      order_pix_allowed: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      event_occupied_count: {
        Args: { p_event_id: string; p_exclude_order_id?: string | null };
        Returns: number;
      };
      event_kind_occupied_count: {
        Args: {
          p_event_id: string;
          p_exclude_order_id?: string | null;
          p_kind: Database["public"]["Enums"]["ticket_kind"];
        };
        Returns: number;
      };
      extend_order_hold_for_pix: {
        Args: { p_order_id: string; p_pix_expires_at: string };
        Returns: string | null;
      };
      issue_courtesy_ticket: {
        Args: {
          p_buyer_email: string;
          p_buyer_name: string;
          p_event_id: string;
          p_public_token: string;
          p_session_id?: string | null;
        };
        Returns: { order_id: string; ticket_id: string }[];
      };
      is_staff: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      mark_order_paid_by_external: {
        Args: {
          p_external_id: string;
          p_provider: string;
          p_provider_order_id?: string | null;
          p_provider_payment_id?: string | null;
        };
        Returns: string;
      };
      purge_rate_limit_hits: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      claim_abandoned_order_reminders: {
        Args: { p_daily_cap: number; p_limit: number; p_min_policy_version: string };
        Returns: {
          buyer_email: string;
          buyer_name: string;
          event_name: string;
          event_slug: string;
          event_starts_at: string;
          event_venue: string;
          items: Json;
          optout_token: string;
          order_id: string;
          public_token: string;
          session_ends_at: string | null;
          session_id: string;
          session_name: string | null;
          session_starts_at: string;
        }[];
      };
      mark_abandoned_reminder_sent: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      release_abandoned_reminder: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      register_reminder_optout: {
        Args: { p_token: string };
        Returns: boolean;
      };
      reminder_email_hash: {
        Args: { p_email: string };
        Returns: string;
      };
      save_event_ticket_types: {
        Args: { p_event_id: string; p_types: Json };
        Returns: undefined;
      };
      ticket_type_units_taken: {
        Args: { p_exclude_order_id?: string | null; p_ticket_type_id: string };
        Returns: number;
      };
      update_event_with_capacity: {
        Args: {
          p_capacity: number;
          p_cover_image_url: string | null;
          p_description: string;
          p_event_id: string;
          p_inteira_quota: number | null;
          p_meia_quota: number | null;
          p_name: string;
          p_starts_at: string;
          p_ticket_types: Json;
          p_venue: string;
        };
        Returns: undefined;
      };
      session_ops_summary: {
        Args: { p_session_id: string };
        Returns: Json;
      };
      session_notice_progress: {
        Args: { p_notice_id: string };
        Returns: Json;
      };
      queue_schedule_change_notice: {
        Args: { p_session_id: string; p_staff_user_id: string };
        Returns: Json;
      };
      cancel_event_session: {
        Args: {
          p_confirmation: string;
          p_notify: boolean;
          p_reason: string;
          p_session_id: string;
          p_staff_user_id: string;
        };
        Returns: Json;
      };
      queue_cancellation_refund_notice: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      claim_session_notice_deliveries: {
        Args: { p_limit: number; p_notice_id?: string | null; p_order_id?: string | null };
        Returns: {
          buyer_email: string;
          buyer_name: string;
          delivery_id: string;
          event_name: string;
          event_venue: string | null;
          kind: string;
          notice_id: string;
          order_id: string;
          previous_ends_at: string | null;
          previous_starts_at: string | null;
          public_token: string;
          reason: string | null;
          refund_amount_cents: number | null;
          session_ends_at: string | null;
          session_name: string | null;
          session_starts_at: string;
          tickets: Json | null;
          total_cents: number;
        }[];
      };
      mark_session_notice_sent: {
        Args: { p_delivery_id: string };
        Returns: boolean;
      };
      release_session_notice_delivery: {
        Args: { p_delivery_id: string; p_error_code: string; p_quota?: boolean };
        Returns: string;
      };
      pause_session_notice_emails: {
        Args: { p_until: string };
        Returns: string;
      };
      retry_failed_session_notices: {
        Args: { p_notice_id: string; p_staff_user_id: string };
        Returns: number;
      };
      start_session_refund_batch: {
        Args: {
          p_confirm_total_cents: number;
          p_reason: string;
          p_session_id: string;
          p_staff_user_id: string;
        };
        Returns: Json;
      };
      claim_session_refund_item: {
        Args: { p_batch_id: string; p_staff_user_id: string };
        Returns: Json;
      };
      finish_session_refund_item: {
        Args: { p_code?: string | null; p_item_id: string; p_status: string };
        Returns: Json;
      };
      retry_session_refund_failures: {
        Args: { p_batch_id: string; p_staff_user_id: string };
        Returns: number;
      };
    };
    Enums: {
      order_status:
        | "pendente"
        | "pago"
        | "cancelado"
        | "expirado"
        | "estornado"
        | "aguardando_decisao";
      refund_status: "solicitado" | "concluido" | "falhou";
      ticket_kind: "inteira" | "meia" | "cortesia";
      ticket_status: "nao_pago" | "pago" | "cancelado" | "check_in" | "estornado";
    };
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];

export type Tables<
  TableName extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][TableName]["Row"];

export type TablesInsert<
  TableName extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][TableName]["Insert"];

export type TablesUpdate<
  TableName extends keyof PublicSchema["Tables"],
> = PublicSchema["Tables"][TableName]["Update"];

export type Enums<
  EnumName extends keyof PublicSchema["Enums"],
> = PublicSchema["Enums"][EnumName];
