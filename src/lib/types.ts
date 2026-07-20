export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          qr_id: string;
          display_name: string;
          avatar_url: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          username: string;
          qr_id?: string;
          display_name?: string;
          avatar_url?: string | null;
          created_at?: string;
        };
        Update: {
          username?: string;
          qr_id?: string;
          display_name?: string;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          title: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          user_id: string;
          role: 'owner' | 'member';
          joined_at: string;
        };
        Insert: {
          conversation_id: string;
          user_id: string;
          role?: 'owner' | 'member';
          joined_at?: string;
        };
        Update: {
          role?: 'owner' | 'member';
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender_id: string;
          body: string;
          attachment_path?: string | null;
          created_at?: string;
        };
        Update: {
          body?: string;
          attachment_path?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      conversation_role: 'owner' | 'member';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Conversation = Database['public']['Tables']['conversations']['Row'];
export type Message = Database['public']['Tables']['messages']['Row'];
export type Profile = Database['public']['Tables']['profiles']['Row'];
