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
          name?: string;
          sales_open?: boolean;
          slug?: string;
          starts_at?: string;
          updated_at?: string;
          venue?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: {
          buyer_email: string;
          buyer_name: string;
          buyer_phone: string | null;
          created_at: string;
          event_id: string;
          expires_at: string | null;
          id: string;
          paid_at: string | null;
          payment_external_id: string | null;
          payment_provider: string | null;
          public_token: string;
          status: Database["public"]["Enums"]["order_status"];
          total_cents: number;
        };
        Insert: {
          buyer_email: string;
          buyer_name: string;
          buyer_phone?: string | null;
          created_at?: string;
          event_id: string;
          expires_at?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_external_id?: string | null;
          payment_provider?: string | null;
          public_token: string;
          status?: Database["public"]["Enums"]["order_status"];
          total_cents: number;
        };
        Update: {
          buyer_email?: string;
          buyer_name?: string;
          buyer_phone?: string | null;
          created_at?: string;
          event_id?: string;
          expires_at?: string | null;
          id?: string;
          paid_at?: string | null;
          payment_external_id?: string | null;
          payment_provider?: string | null;
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
          event_id: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          price_cents: number;
        };
        Insert: {
          active?: boolean;
          event_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          price_cents: number;
        };
        Update: {
          active?: boolean;
          event_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_kind"];
          price_cents?: number;
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
          code: string;
          created_at: string;
          event_id: string;
          id: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          order_id: string;
          price_cents: number;
          status: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id: string;
        };
        Insert: {
          buyer_name: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          code: string;
          created_at?: string;
          event_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["ticket_kind"];
          order_id: string;
          price_cents: number;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id: string;
        };
        Update: {
          buyer_name?: string;
          cancelled_at?: string | null;
          checked_in_at?: string | null;
          code?: string;
          created_at?: string;
          event_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["ticket_kind"];
          order_id?: string;
          price_cents?: number;
          status?: Database["public"]["Enums"]["ticket_status"];
          ticket_type_id?: string;
        };
        Relationships: [
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
      cancel_order_by_external: {
        Args: { p_external_id: string; p_provider: string };
        Returns: string;
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
          p_public_token: string;
        };
        Returns: {
          expires_at: string;
          order_id: string;
          total_cents: number;
        }[];
      };
      event_occupied_count: {
        Args: { p_event_id: string; p_exclude_order_id?: string | null };
        Returns: number;
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
        Args: { p_external_id: string; p_provider: string };
        Returns: string;
      };
      purge_rate_limit_hits: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      update_event_with_capacity: {
        Args: {
          p_capacity: number;
          p_cover_image_url: string | null;
          p_description: string;
          p_event_id: string;
          p_full_price_cents: number;
          p_half_price_cents: number;
          p_name: string;
          p_starts_at: string;
          p_venue: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      order_status: "pendente" | "pago" | "cancelado" | "expirado";
      ticket_kind: "inteira" | "meia" | "cortesia";
      ticket_status: "nao_pago" | "pago" | "cancelado" | "check_in";
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
