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
          approval_decided_at: string | null;
          approval_decided_by: string | null;
          approval_note: string | null;
          approval_status: string;
          capacity: number;
          cover_image_url: string | null;
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string;
          hidden_from_past: boolean;
          id: string;
          inteira_quota: number | null;
          meia_quota: number | null;
          name: string;
          organizer_id: string | null;
          published_at: string | null;
          sales_open: boolean;
          slug: string;
          starts_at: string;
          submitted_at: string | null;
          updated_at: string;
          venue: string;
        };
        Insert: {
          approval_decided_at?: string | null;
          approval_decided_by?: string | null;
          approval_note?: string | null;
          approval_status?: string;
          capacity: number;
          cover_image_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string;
          hidden_from_past?: boolean;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name: string;
          organizer_id?: string | null;
          published_at?: string | null;
          sales_open?: boolean;
          slug: string;
          starts_at: string;
          submitted_at?: string | null;
          updated_at?: string;
          venue: string;
        };
        Update: {
          approval_decided_at?: string | null;
          approval_decided_by?: string | null;
          approval_note?: string | null;
          approval_status?: string;
          capacity?: number;
          cover_image_url?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string;
          hidden_from_past?: boolean;
          id?: string;
          inteira_quota?: number | null;
          meia_quota?: number | null;
          name?: string;
          organizer_id?: string | null;
          published_at?: string | null;
          sales_open?: boolean;
          slug?: string;
          starts_at?: string;
          submitted_at?: string | null;
          updated_at?: string;
          venue?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey";
            columns: ["organizer_id"];
            isOneToOne: false;
            referencedRelation: "organizer_profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      /** Só leitura do próprio perfil (organizador verificado); escrita só pelas funções do banco. */
      organizer_profiles: {
        Row: {
          created_at: string;
          full_name: string;
          invite_id: string;
          phone: string;
          pix_holder_document: string;
          pix_holder_name: string;
          pix_key: string;
          pix_key_changed_at: string | null;
          pix_key_type: string;
          public_name: string;
          status: string;
          status_reason: string | null;
          terms_accepted_at: string;
          terms_version: string;
          updated_at: string;
          user_id: string;
        };
        Insert: never;
        Update: never;
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
          service_fee_total_cents: number;
          service_fee_unit_cents: number;
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
          service_fee_total_cents?: number;
          service_fee_unit_cents?: number;
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
          service_fee_total_cents?: number;
          service_fee_unit_cents?: number;
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
          service_fee_cents: number;
          service_fee_min_cents: number;
          service_fee_rate_bps: number;
          session_id: string;
          status: Database["public"]["Enums"]["order_status"];
          terms_accepted_at: string | null;
          terms_version: string | null;
          tickets_subtotal_cents: number;
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
          service_fee_cents?: number;
          service_fee_min_cents?: number;
          service_fee_rate_bps?: number;
          session_id?: string;
          status?: Database["public"]["Enums"]["order_status"];
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          tickets_subtotal_cents?: number;
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
          service_fee_cents?: number;
          service_fee_min_cents?: number;
          service_fee_rate_bps?: number;
          session_id?: string;
          status?: Database["public"]["Enums"]["order_status"];
          terms_accepted_at?: string | null;
          terms_version?: string | null;
          tickets_subtotal_cents?: number;
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
          is_developer: boolean;
          role: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          is_developer?: boolean;
          role?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          is_developer?: boolean;
          role?: string;
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
      check_in_ticket: {
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
          p_expected_fee_rate_bps?: number | null;
          p_expected_fee_min_cents?: number | null;
          p_terms_version?: string | null;
        };
        Returns: {
          expires_at: string;
          order_id: string;
          service_fee_cents: number;
          total_cents: number;
        }[];
      };
      service_fee_policy: {
        Args: Record<PropertyKey, never>;
        Returns: { enabled: boolean; min_cents: number; rate_bps: number }[];
      };
      staff_finance_role: {
        Args: { p_staff_user_id: string };
        Returns: string | null;
      };
      event_finance_summary: {
        Args: { p_event_id: string; p_staff_user_id: string };
        Returns: Json;
      };
      service_fee_overview: {
        Args: { p_from: string; p_staff_user_id: string; p_to: string };
        Returns: Json;
      };
      record_service_fee_payout: {
        Args: {
          p_event_id: string;
          p_expected_amount_cents: number;
          p_note: string | null;
          p_pix_date: string;
          p_staff_user_id: string;
        };
        Returns: Json;
      };
      record_service_fee_adjustment: {
        Args: {
          p_amount_cents: number;
          p_event_id: string;
          p_reason: string;
          p_staff_user_id: string;
        };
        Returns: Json;
      };
      register_order_chargeback: {
        Args: {
          p_kind: string;
          p_order_id: string;
          p_reason: string;
          p_source?: string;
          p_staff_user_id: string;
        };
        Returns: Json;
      };
      event_availability: {
        Args: { p_event_id: string };
        Returns: Json;
      };
      event_sessions_summary: {
        Args: { p_event_id: string };
        Returns: Json;
      };
      event_is_past: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
      public_past_events: {
        Args: { p_limit: number };
        Returns: {
          cover_image_url: string | null;
          id: string;
          last_session_at: string;
          name: string;
          session_starts: string[];
          slug: string;
          venue: string;
        }[];
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
      save_event_sessions: {
        Args: { p_event_id: string; p_sessions: Json; p_staff_user_id: string };
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
      session_is_verified: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      login_session_state: {
        Args: Record<PropertyKey, never>;
        Returns: {
          status: string;
          user_id: string | null;
          session_id: string | null;
          code_expires_at: string | null;
          resend_at: string | null;
        }[];
      };
      issue_login_code: {
        Args: { p_user_id: string; p_session_id: string; p_code: string };
        Returns: string;
      };
      verify_login_code: {
        Args: { p_code: string; p_device_token?: string | null; p_device_label?: string | null };
        Returns: string;
      };
      verify_session_with_device: {
        Args: { p_device_token: string };
        Returns: boolean;
      };
      end_login_verification: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      purge_login_verification: {
        Args: Record<PropertyKey, never>;
        Returns: number;
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
      // Contas de organizador (migrations 20261018100000 e 20261018110000).
      organizer_area_enabled: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      my_account_kind: {
        Args: Record<PropertyKey, never>;
        Returns: string | null;
      };
      is_organizer: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      owns_event: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
      actor_event_access: {
        Args: { p_actor_user_id: string; p_event_id: string };
        Returns: string | null;
      };
      organizer_max_capacity: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      event_deletion_pending: {
        Args: { p_event_id: string };
        Returns: boolean;
      };
      log_audit: {
        Args: {
          p_action: string;
          p_actor: string | null;
          p_details: Json;
          p_event_id: string | null;
          p_order_id: string | null;
          p_organizer_id: string | null;
        };
        Returns: undefined;
      };
      valid_tax_document: {
        Args: { p_doc: string };
        Returns: boolean;
      };
      create_organizer_invite: {
        Args: {
          p_admin: string;
          p_kind: string;
          p_label: string | null;
          p_request_id: string | null;
          p_target_user_id: string | null;
          p_token_hash: string;
        };
        Returns: string;
      };
      revoke_organizer_invite: {
        Args: { p_admin: string; p_invite_id: string };
        Returns: boolean;
      };
      list_organizer_invites: {
        Args: { p_admin: string };
        Returns: {
          created_at: string;
          expires_at: string;
          id: string;
          kind: string;
          label: string | null;
          status: string;
          used_at: string | null;
          used_by_public_name: string | null;
        }[];
      };
      check_organizer_invite: {
        Args: { p_token_hash: string };
        Returns: string;
      };
      start_invite_email_code: {
        Args: { p_code: string; p_email: string; p_token_hash: string };
        Returns: string;
      };
      verify_invite_email_code: {
        Args: { p_code: string; p_token_hash: string };
        Returns: string;
      };
      invite_verified_email: {
        Args: { p_token_hash: string };
        Returns: string | null;
      };
      accept_organizer_invite: {
        Args: {
          p_full_name: string;
          p_phone: string;
          p_pix_holder_document: string;
          p_pix_holder_name: string;
          p_pix_key: string;
          p_pix_key_type: string;
          p_public_name: string;
          p_terms_version: string;
          p_token_hash: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      use_password_reset_invite: {
        Args: { p_token_hash: string };
        Returns: string;
      };
      submit_signup_request: {
        Args: {
          p_approx_date: string | null;
          p_contact: string;
          p_idea: string;
          p_name: string;
          p_privacy_version: string;
        };
        Returns: string;
      };
      list_signup_requests: {
        Args: { p_admin: string; p_status: string };
        Returns: {
          approx_date: string | null;
          contact: string;
          created_at: string;
          handled_at: string | null;
          id: string;
          idea: string;
          name: string;
          status: string;
        }[];
      };
      archive_signup_request: {
        Args: { p_admin: string; p_id: string };
        Returns: boolean;
      };
      list_organizers: {
        Args: { p_admin: string };
        Returns: {
          created_at: string;
          devices_count: number;
          email: string | null;
          events_count: number;
          full_name: string;
          phone: string;
          pix_holder_document_masked: string;
          pix_holder_name: string;
          pix_key_masked: string;
          pix_key_type: string;
          public_name: string;
          status: string;
          user_id: string;
        }[];
      };
      set_organizer_status: {
        Args: { p_admin: string; p_reason: string | null; p_status: string; p_user_id: string };
        Returns: undefined;
      };
      list_my_devices: {
        Args: { p_current_token: string | null };
        Returns: {
          created_at: string;
          expires_at: string;
          id: string;
          is_current: boolean;
          label: string;
          last_used_at: string | null;
        }[];
      };
      forget_my_device: {
        Args: { p_device_id: string };
        Returns: boolean;
      };
      admin_forget_devices: {
        Args: { p_admin: string; p_user_id: string };
        Returns: number;
      };
      staff_security_overview: {
        Args: { p_admin: string };
        Returns: {
          devices_count: number;
          display_name: string;
          is_developer: boolean;
          last_used_at: string | null;
          role: string;
          user_id: string;
        }[];
      };
      organizer_change_violations: {
        Args: { p_event_id: string; p_name: string; p_sessions: Json; p_venue: string };
        Returns: string[];
      };
      create_organizer_event: {
        Args: {
          p_actor: string;
          p_cover_image_url: string | null;
          p_description: string | null;
          p_name: string;
          p_sessions: Json;
          p_slug: string;
          p_ticket_types: Json;
          p_venue: string;
        };
        Returns: string;
      };
      submit_event_for_approval: {
        Args: { p_actor: string; p_event_id: string };
        Returns: undefined;
      };
      withdraw_event_submission: {
        Args: { p_actor: string; p_event_id: string };
        Returns: undefined;
      };
      decide_event_approval: {
        Args: {
          p_admin: string;
          p_decision: string;
          p_event_id: string;
          p_note: string | null;
          p_publish: boolean;
        };
        Returns: undefined;
      };
      public_event_producer: {
        Args: { p_event_id: string };
        Returns: string | null;
      };
      event_producer_names: {
        Args: { p_event_ids: string[] };
        Returns: { event_id: string; public_name: string }[];
      };
      purge_organizer_records: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      record_payment_fee: {
        Args: {
          p_order_id: string;
          p_gross_cents: number;
          p_fee_cents: number;
          p_breakdown: Json;
          p_release_date: string | null;
          p_after_refund: boolean;
        };
        Returns: string;
      };
      record_payment_fee_failure: {
        Args: { p_order_id: string; p_code: string };
        Returns: number;
      };
      record_event_fee_total: {
        Args: {
          p_admin: string;
          p_event_id: string;
          p_expected_orders: number;
          p_expected_pending_cents: number;
          p_total_fee_cents: number;
          p_note: string;
        };
        Returns: Json;
      };
      record_payment_fee_manual: {
        Args: { p_admin: string; p_order_id: string; p_fee_cents: number; p_note: string };
        Returns: Json;
      };
      event_fee_pending_orders: {
        Args: { p_admin: string; p_event_id: string };
        Returns: {
          order_id: string;
          created_at: string;
          total_cents: number;
          status: string;
          attempts: number;
          last_error: string | null;
        }[];
      };
      issue_organizer_action_code: {
        Args: { p_actor: string; p_purpose: string; p_code: string };
        Returns: string;
      };
      request_pix_change: {
        Args: {
          p_actor: string;
          p_code: string;
          p_pix_key_type: string;
          p_pix_key: string;
          p_holder_name: string;
          p_holder_document: string;
        };
        Returns: Json;
      };
      cancel_pix_change: {
        Args: { p_actor: string; p_request_id: string };
        Returns: undefined;
      };
      decide_pix_change: {
        Args: { p_admin: string; p_request_id: string; p_approve: boolean; p_note: string | null };
        Returns: Json;
      };
      list_pix_change_requests: {
        Args: { p_admin: string };
        Returns: {
          request_id: string;
          organizer_id: string;
          public_name: string;
          status: string;
          current_key_masked: string;
          new_key_type: string;
          new_key_masked: string;
          new_document_masked: string;
          confirm_after: string;
          can_confirm: boolean;
          created_at: string;
          decided_at: string | null;
          decided_by_name: string | null;
          decision_note: string | null;
        }[];
      };
      pix_change_details: {
        Args: { p_admin: string; p_request_id: string };
        Returns: Json;
      };
      organizer_pix_change_state: {
        Args: { p_actor: string };
        Returns: Json;
      };
      claim_refund_request_notice: {
        Args: { p_order_id: string };
        Returns: { request_id: string; requested_by: string; event_id: string; event_name: string }[];
      };
      claim_event_refund_notice: {
        Args: { p_order_id: string };
        Returns: { organizer_id: string; event_id: string; event_name: string }[];
      };
      orders_missing_fee: {
        Args: { p_limit: number };
        Returns: {
          order_id: string;
          created_at: string;
          provider_order_id: string | null;
          after_refund: boolean;
          attempts: number;
        }[];
      };
      record_organizer_payout: {
        Args: {
          p_admin: string;
          p_event_id: string;
          p_expected_amount_cents: number;
          p_pix_date: string | null;
          p_note: string | null;
        };
        Returns: Json;
      };
      record_organizer_payout_adjustment: {
        Args: { p_admin: string; p_event_id: string; p_amount_cents: number; p_reason: string };
        Returns: string;
      };
      record_organizer_refund_received: {
        Args: {
          p_admin: string;
          p_organizer_id: string;
          p_amount_cents: number;
          p_pix_date: string;
          p_note: string | null;
        };
        Returns: Json;
      };
      refresh_organizer_balance_flags: {
        Args: Record<PropertyKey, never>;
        Returns: {
          flag_id: string;
          organizer_id: string;
          event_id: string;
          event_name: string;
          owed_cents: number;
          return_due_date: string;
        }[];
      };
      mark_balance_flag_notified: {
        Args: { p_flag_id: string };
        Returns: undefined;
      };
      organizer_finance_daily_summary: {
        Args: Record<PropertyKey, never>;
        Returns: Json;
      };
      organizer_event_finance: {
        Args: { p_actor: string; p_event_id: string };
        Returns: Json;
      };
      organizer_payouts_overview: {
        Args: { p_admin: string; p_from: string; p_to: string };
        Returns: Json;
      };
      organizer_payout_details: {
        Args: { p_admin: string; p_event_id: string };
        Returns: Json;
      };
      organizer_payouts_csv: {
        Args: { p_admin: string; p_from: string; p_to: string };
        Returns: {
          data_pix: string | null;
          registrado_em: string;
          tipo: string;
          organizador: string;
          evento: string;
          valor_cents: number;
          registrado_por: string;
          nota_ou_motivo: string | null;
        }[];
      };
      organizer_event_orders: {
        Args: { p_actor: string; p_event_id: string; p_session_id?: string | null };
        Returns: {
          buyer_email: string;
          buyer_name: string;
          created_at: string;
          is_courtesy: boolean;
          items: Json;
          order_id: string;
          refund_request_reason: string | null;
          refund_request_status: string | null;
          session_id: string;
          session_name: string | null;
          session_starts_at: string;
          status: string;
          tickets_checked_in: number;
          tickets_subtotal_cents: number;
          tickets_total: number;
        }[];
      };
      request_order_refund: {
        Args: { p_actor: string; p_order_id: string; p_reason: string };
        Returns: string;
      };
      request_event_change: {
        Args: { p_actor: string; p_event_id: string; p_reason: string; p_what: string };
        Returns: string;
      };
      request_event_deletion: {
        Args: { p_actor: string; p_event_id: string; p_reason: string };
        Returns: string;
      };
      cancel_ops_request: {
        Args: { p_actor: string; p_request_id: string };
        Returns: boolean;
      };
      decline_ops_request: {
        Args: { p_note: string | null; p_request_id: string; p_staff: string };
        Returns: undefined;
      };
      finish_event_change: {
        Args: { p_admin: string; p_request_id: string };
        Returns: undefined;
      };
      finish_event_deletion: {
        Args: { p_admin: string; p_request_id: string };
        Returns: undefined;
      };
      delete_own_event: {
        Args: { p_actor: string; p_confirm_name: string; p_event_id: string };
        Returns: string;
      };
      set_event_sales_open: {
        Args: { p_actor: string; p_event_id: string; p_open: boolean };
        Returns: boolean;
      };
      list_ops_requests: {
        Args: { p_event_id?: string | null; p_staff: string; p_status: string };
        Returns: {
          created_at: string;
          decided_at: string | null;
          decision_note: string | null;
          details: Json;
          event_id: string;
          event_name: string;
          id: string;
          kind: string;
          order_id: string | null;
          organizer_public_name: string | null;
          reason: string;
          status: string;
        }[];
      };
      organizer_event_requests: {
        Args: { p_actor: string; p_event_id: string };
        Returns: {
          created_at: string;
          decided_at: string | null;
          decision_note: string | null;
          details: Json;
          id: string;
          kind: string;
          order_id: string | null;
          reason: string;
          status: string;
        }[];
      };
      organizer_event_history: {
        Args: { p_actor: string; p_event_id: string };
        Returns: { action: string; actor_kind: string; created_at: string }[];
      };
      team_pending_counts: {
        Args: { p_staff: string };
        Returns: {
          approvals: number;
          changes: number;
          deletions: number;
          refunds: number;
          signup_requests: number;
        }[];
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
