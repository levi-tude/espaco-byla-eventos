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
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
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
