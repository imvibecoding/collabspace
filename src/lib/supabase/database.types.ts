export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_history: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          payload: Json
          room_id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          payload?: Json
          room_id: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          payload?: Json
          room_id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_history_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          free_tier: boolean
          id: number
          kind: Database["public"]["Enums"]["credit_kind"]
          provider_cost_cents: number | null
          reason: string
          room_id: string | null
          stripe_ref: string | null
          submission_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          free_tier?: boolean
          id?: never
          kind?: Database["public"]["Enums"]["credit_kind"]
          provider_cost_cents?: number | null
          reason: string
          room_id?: string | null
          stripe_ref?: string | null
          submission_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          free_tier?: boolean
          id?: never
          kind?: Database["public"]["Enums"]["credit_kind"]
          provider_cost_cents?: number | null
          reason?: string
          room_id?: string | null
          stripe_ref?: string | null
          submission_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_submission_fk"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "queue_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      health_check: {
        Row: {
          created_at: string
          id: number
          label: string
        }
        Insert: {
          created_at?: string
          id?: never
          label: string
        }
        Update: {
          created_at?: string
          id?: never
          label?: string
        }
        Relationships: []
      }
      kanban_cards: {
        Row: {
          body: string | null
          column_id: string
          created_at: string
          created_by: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          position: number
          room_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          column_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          position?: number
          room_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          column_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          position?: number
          room_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_cards_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "kanban_columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_cards_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kanban_cards_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      kanban_columns: {
        Row: {
          created_at: string
          id: string
          position: number
          room_id: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          room_id: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          room_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "kanban_columns_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_flags: {
        Row: {
          created_at: string
          id: number
          kind: string
          reason: string | null
          reporter_id: string
          room_id: string
          status: Database["public"]["Enums"]["flag_status"]
          submission_id: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          id?: never
          kind?: string
          reason?: string | null
          reporter_id: string
          room_id: string
          status?: Database["public"]["Enums"]["flag_status"]
          submission_id?: string | null
          weight?: number
        }
        Update: {
          created_at?: string
          id?: never
          kind?: string
          reason?: string | null
          reporter_id?: string
          room_id?: string
          status?: Database["public"]["Enums"]["flag_status"]
          submission_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "moderation_flags_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_flags_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "queue_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          banned_at: string | null
          card_on_file: boolean
          created_at: string
          display_name: string | null
          handle: string | null
          id: string
          phone_verified: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          banned_at?: string | null
          card_on_file?: boolean
          created_at?: string
          display_name?: string | null
          handle?: string | null
          id: string
          phone_verified?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          banned_at?: string | null
          card_on_file?: boolean
          created_at?: string
          display_name?: string | null
          handle?: string | null
          id?: string
          phone_verified?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      queue_submissions: {
        Row: {
          applied_at: string | null
          bid_credits: number
          created_at: string
          id: string
          lane: Database["public"]["Enums"]["queue_lane"]
          moderation: Json
          prompt: string
          provider: string | null
          result_asset_url: string | null
          reverted_at: string | null
          room_id: string
          status: Database["public"]["Enums"]["submission_status"]
          user_id: string
          window_start: string
        }
        Insert: {
          applied_at?: string | null
          bid_credits?: number
          created_at?: string
          id?: string
          lane?: Database["public"]["Enums"]["queue_lane"]
          moderation?: Json
          prompt: string
          provider?: string | null
          result_asset_url?: string | null
          reverted_at?: string | null
          room_id: string
          status?: Database["public"]["Enums"]["submission_status"]
          user_id: string
          window_start: string
        }
        Update: {
          applied_at?: string | null
          bid_credits?: number
          created_at?: string
          id?: string
          lane?: Database["public"]["Enums"]["queue_lane"]
          moderation?: Json
          prompt?: string
          provider?: string | null
          result_asset_url?: string | null
          reverted_at?: string | null
          room_id?: string
          status?: Database["public"]["Enums"]["submission_status"]
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_submissions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reputation_scores: {
        Row: {
          cooldown_until: string | null
          priority_penalty: number
          score: number
          strikes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cooldown_until?: string | null
          priority_penalty?: number
          score?: number
          strikes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cooldown_until?: string | null
          priority_penalty?: number
          score?: number
          strikes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reputation_scores_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_mode_changes: {
        Row: {
          accepted: boolean | null
          changed_by: string | null
          created_at: string
          from_mode: Database["public"]["Enums"]["collab_mode"] | null
          id: number
          reason: string | null
          room_id: string
          suggested: boolean
          to_mode: Database["public"]["Enums"]["collab_mode"]
        }
        Insert: {
          accepted?: boolean | null
          changed_by?: string | null
          created_at?: string
          from_mode?: Database["public"]["Enums"]["collab_mode"] | null
          id?: never
          reason?: string | null
          room_id: string
          suggested?: boolean
          to_mode: Database["public"]["Enums"]["collab_mode"]
        }
        Update: {
          accepted?: boolean | null
          changed_by?: string | null
          created_at?: string
          from_mode?: Database["public"]["Enums"]["collab_mode"] | null
          id?: never
          reason?: string | null
          room_id?: string
          suggested?: boolean
          to_mode?: Database["public"]["Enums"]["collab_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "room_mode_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_mode_changes_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_participants: {
        Row: {
          invited_by: string | null
          joined_at: string
          role: Database["public"]["Enums"]["participant_role"]
          room_id: string
          user_id: string
        }
        Insert: {
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["participant_role"]
          room_id: string
          user_id: string
        }
        Update: {
          invited_by?: string | null
          joined_at?: string
          role?: Database["public"]["Enums"]["participant_role"]
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          base_price_credits: number
          base_window_seconds: number
          created_at: string
          current_asset_url: string | null
          current_submission_id: string | null
          id: string
          instant_price_credits: number
          mode: Database["public"]["Enums"]["collab_mode"]
          name: string
          owner_id: string
          premium_bid_increment_credits: number
          premium_min_bid_credits: number
          premium_window_seconds: number
          rules: Json
          slug: string
          type: Database["public"]["Enums"]["room_type"]
          updated_at: string
          visibility: Database["public"]["Enums"]["room_visibility"]
        }
        Insert: {
          base_price_credits?: number
          base_window_seconds?: number
          created_at?: string
          current_asset_url?: string | null
          current_submission_id?: string | null
          id?: string
          instant_price_credits?: number
          mode?: Database["public"]["Enums"]["collab_mode"]
          name: string
          owner_id: string
          premium_bid_increment_credits?: number
          premium_min_bid_credits?: number
          premium_window_seconds?: number
          rules?: Json
          slug: string
          type: Database["public"]["Enums"]["room_type"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["room_visibility"]
        }
        Update: {
          base_price_credits?: number
          base_window_seconds?: number
          created_at?: string
          current_asset_url?: string | null
          current_submission_id?: string | null
          id?: string
          instant_price_credits?: number
          mode?: Database["public"]["Enums"]["collab_mode"]
          name?: string
          owner_id?: string
          premium_bid_increment_credits?: number
          premium_min_bid_credits?: number
          premium_window_seconds?: number
          rules?: Json
          slug?: string
          type?: Database["public"]["Enums"]["room_type"]
          updated_at?: string
          visibility?: Database["public"]["Enums"]["room_visibility"]
        }
        Relationships: [
          {
            foreignKeyName: "rooms_current_submission_fk"
            columns: ["current_submission_id"]
            isOneToOne: false
            referencedRelation: "queue_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      snapshots: {
        Row: {
          asset_url: string | null
          created_at: string
          created_by: string | null
          id: string
          room_id: string
          state: Json
        }
        Insert: {
          asset_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          room_id: string
          state?: Json
        }
        Update: {
          asset_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          room_id?: string
          state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snapshots_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_edit_room: { Args: { p_room_id: string }; Returns: boolean }
      can_view_room: { Args: { p_room_id: string }; Returns: boolean }
      credit_balance: {
        Args: {
          p_kind?: Database["public"]["Enums"]["credit_kind"]
          p_user_id: string
        }
        Returns: number
      }
      credit_balances: {
        Args: {
          p_kind: Database["public"]["Enums"]["credit_kind"]
          p_user_id: string
        }
        Returns: {
          free: number
          paid: number
        }[]
      }
      find_user_id_by_email: { Args: { p_email: string }; Returns: string }
      grant_credits: {
        Args: {
          p_amount: number
          p_free_tier?: boolean
          p_kind: Database["public"]["Enums"]["credit_kind"]
          p_reason: string
          p_stripe_ref?: string
          p_user_id: string
        }
        Returns: number
      }
      is_room_owner: { Args: { p_room_id: string }; Returns: boolean }
      is_room_participant: { Args: { p_room_id: string }; Returns: boolean }
      my_credit_balances: {
        Args: never
        Returns: {
          free: number
          kind: Database["public"]["Enums"]["credit_kind"]
          paid: number
        }[]
      }
      refund_submission: {
        Args: { p_reason?: string; p_submission_id: string }
        Returns: number
      }
      room_is_public: { Args: { p_room_id: string }; Returns: boolean }
      spend_credits: {
        Args: {
          p_amount: number
          p_kind: Database["public"]["Enums"]["credit_kind"]
          p_provider_cost_cents?: number
          p_reason: string
          p_room_id?: string
          p_submission_id?: string
          p_user_id: string
        }
        Returns: number[]
      }
    }
    Enums: {
      collab_mode: "freeform" | "queue" | "sectioned"
      credit_kind:
        | "text"
        | "image"
        | "music"
        | "video"
        | "threed"
        | "priority"
        | "hosting"
        | "universal"
      flag_status: "open" | "reviewing" | "upheld" | "dismissed"
      participant_role: "owner" | "editor" | "viewer"
      queue_lane: "base" | "premium" | "instant"
      room_type: "art" | "kanban"
      room_visibility: "public" | "private"
      submission_status:
        | "pending"
        | "applied"
        | "rejected"
        | "reverted"
        | "expired"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      collab_mode: ["freeform", "queue", "sectioned"],
      credit_kind: [
        "text",
        "image",
        "music",
        "video",
        "threed",
        "priority",
        "hosting",
        "universal",
      ],
      flag_status: ["open", "reviewing", "upheld", "dismissed"],
      participant_role: ["owner", "editor", "viewer"],
      queue_lane: ["base", "premium", "instant"],
      room_type: ["art", "kanban"],
      room_visibility: ["public", "private"],
      submission_status: [
        "pending",
        "applied",
        "rejected",
        "reverted",
        "expired",
      ],
    },
  },
} as const

