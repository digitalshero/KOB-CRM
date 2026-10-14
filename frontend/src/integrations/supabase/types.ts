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
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          meta: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
        }
        Relationships: []
      }
      meta_campaign_selections: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          is_enabled: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          is_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      brand_state_availability: {
        Row: {
          active: boolean
          brand_id: string
          id: string
          is_native: boolean
          state_id: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          id?: string
          is_native?: boolean
          state_id: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          id?: string
          is_native?: boolean
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_state_availability_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_state_availability_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["native_brand_id"]
          },
          {
            foreignKeyName: "brand_state_availability_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "brand_state_availability_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "india_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_state_availability_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["state_id"]
          },
        ]
      }
      brands: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          is_shero: boolean
          name: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          is_shero?: boolean
          name: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          is_shero?: boolean
          name?: string
        }
        Relationships: []
      }
      csv_import_initial_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          template_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "csv_import_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "csv_import_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      email_fire_queue: {
        Row: {
          body: string
          created_at: string
          error: string | null
          id: string
          lead_id: string
          sent_at: string | null
          status: string
          subject: string
          template_id: string | null
          to_email: string
        }
        Insert: {
          body: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          sent_at?: string | null
          status?: string
          subject: string
          template_id?: string | null
          to_email: string
        }
        Update: {
          body?: string
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          sent_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_fire_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_fire_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "email_fire_queue_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "gallabox_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_questions: {
        Row: {
          active: boolean
          created_at: string
          id: string
          question_text: string
          question_type: string
          sort_order: number
          updated_at: string
          weight: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          question_text: string
          question_type: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          question_text?: string
          question_type?: string
          sort_order?: number
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      evaluation_responses: {
        Row: {
          answer_text: string | null
          answer_value: number | null
          evaluation_id: string
          filled_at: string
          filled_by: string | null
          id: string
          lead_id: string
          question_id: string
          weight_at_time: number | null
        }
        Insert: {
          answer_text?: string | null
          answer_value?: number | null
          evaluation_id: string
          filled_at?: string
          filled_by?: string | null
          id?: string
          lead_id: string
          question_id: string
          weight_at_time?: number | null
        }
        Update: {
          answer_text?: string | null
          answer_value?: number | null
          evaluation_id?: string
          filled_at?: string
          filled_by?: string | null
          id?: string
          lead_id?: string
          question_id?: string
          weight_at_time?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "evaluation_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "evaluation_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      gallabox_fire_queue: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          fired_at: string | null
          id: string
          lead_id: string
          status: string
          template_id: string | null
        }
        Insert: {
          channel?: string
          created_at?: string
          error?: string | null
          fired_at?: string | null
          id?: string
          lead_id: string
          status?: string
          template_id?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          fired_at?: string | null
          id?: string
          lead_id?: string
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gallabox_fire_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gallabox_fire_queue_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "gallabox_fire_queue_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "gallabox_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      gallabox_templates: {
        Row: {
          active: boolean
          body: string
          bucket: string | null
          category: string
          created_at: string
          email_body: string | null
          email_subject: string | null
          id: string
          language: Database["public"]["Enums"]["lead_language"]
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          body: string
          bucket?: string | null
          category?: string
          created_at?: string
          email_body?: string | null
          email_subject?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lead_language"]
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          bucket?: string | null
          category?: string
          created_at?: string
          email_body?: string | null
          email_subject?: string | null
          id?: string
          language?: Database["public"]["Enums"]["lead_language"]
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      incentive_rules: {
        Row: {
          created_at: string
          id: string
          incentive_amount: number
          incentive_pct: number
          label: string
          max_score: number
          min_score: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          incentive_amount?: number
          incentive_pct: number
          label: string
          max_score: number
          min_score: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          incentive_amount?: number
          incentive_pct?: number
          label?: string
          max_score?: number
          min_score?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      incentives: {
        Row: {
          amount: number
          created_at: string
          id: string
          kitchens_converted: number
          period_month: string
          slab_pct: number
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          kitchens_converted?: number
          period_month: string
          slab_pct?: number
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kitchens_converted?: number
          period_month?: string
          slab_pct?: number
          user_id?: string
        }
        Relationships: []
      }
      india_cities: {
        Row: {
          active: boolean
          district_aliases: string[]
          district_id: string
          id: string
          name: string
          native_brand_id: string | null
          pincode_count: number
          state_aliases: string[]
          state_id: string
          tier: number
        }
        Insert: {
          active?: boolean
          district_aliases?: string[]
          district_id: string
          id?: string
          name: string
          native_brand_id?: string | null
          pincode_count?: number
          state_aliases?: string[]
          state_id: string
          tier: number
        }
        Update: {
          active?: boolean
          district_aliases?: string[]
          district_id?: string
          id?: string
          name?: string
          native_brand_id?: string | null
          pincode_count?: number
          state_aliases?: string[]
          state_id?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "india_cities_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "india_districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "india_cities_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["district_id"]
          },
          {
            foreignKeyName: "india_cities_native_brand_id_fkey"
            columns: ["native_brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "india_cities_native_brand_id_fkey"
            columns: ["native_brand_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["native_brand_id"]
          },
          {
            foreignKeyName: "india_cities_native_brand_id_fkey"
            columns: ["native_brand_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "india_cities_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "india_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "india_cities_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["state_id"]
          },
        ]
      }
      india_districts: {
        Row: {
          active: boolean
          id: string
          name: string
          state_id: string
        }
        Insert: {
          active?: boolean
          id?: string
          name: string
          state_id: string
        }
        Update: {
          active?: boolean
          id?: string
          name?: string
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "india_districts_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "india_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "india_districts_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["state_id"]
          },
        ]
      }
      india_pincodes: {
        Row: {
          created_at: string
          district: string
          pincode: string
          state: string
          taluk: string | null
        }
        Insert: {
          created_at?: string
          district: string
          pincode: string
          state: string
          taluk?: string | null
        }
        Update: {
          created_at?: string
          district?: string
          pincode?: string
          state?: string
          taluk?: string | null
        }
        Relationships: []
      }
      india_states: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          region: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          region?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          region?: string | null
        }
        Relationships: []
      }
      integration_settings: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      kob_configuration: {
        Row: {
          auto_mode_killswitch: boolean
          default_mode: string
          id: number
          incentive_amount: number
          incentive_slab_a: number
          incentive_slab_b: number
          incentive_slab_c: number
          incentive_slab_d: number
          native_brand_multiplier: number
          native_multiplier: number
          other_brand_multiplier: number
          other_multiplier: number
          rt_later_dead_days: number
          rt_later_first_attempts: number
          rt_later_first_days: number
          rt_later_first_msg_days: number
          rt_later_source_first_msg_days: number
          rt_later_then_days: number
          rt_no_attempts: number
          rt_no_days: number
          rt_no_dead_attempts: number
          rt_no_dead_days: number
          rt_no_dead_mode: string
          rt_noresp_dead_days: number
          rt_noresp_final_days: number
          rt_noresp_first_attempts: number
          rt_noresp_first_days: number
          rt_noresp_first_msg_days: number
          rt_noresp_second_attempts: number
          rt_noresp_second_days: number
          updated_at: string
        }
        Insert: {
          auto_mode_killswitch?: boolean
          default_mode?: string
          id?: number
          incentive_amount?: number
          incentive_slab_a?: number
          incentive_slab_b?: number
          incentive_slab_c?: number
          incentive_slab_d?: number
          native_brand_multiplier?: number
          native_multiplier?: number
          other_brand_multiplier?: number
          other_multiplier?: number
          rt_later_dead_days?: number
          rt_later_first_attempts?: number
          rt_later_first_days?: number
          rt_later_first_msg_days?: number
          rt_later_source_first_msg_days?: number
          rt_later_then_days?: number
          rt_no_attempts?: number
          rt_no_days?: number
          rt_no_dead_attempts?: number
          rt_no_dead_days?: number
          rt_no_dead_mode?: string
          rt_noresp_dead_days?: number
          rt_noresp_final_days?: number
          rt_noresp_first_attempts?: number
          rt_noresp_first_days?: number
          rt_noresp_first_msg_days?: number
          rt_noresp_second_attempts?: number
          rt_noresp_second_days?: number
          updated_at?: string
        }
        Update: {
          auto_mode_killswitch?: boolean
          default_mode?: string
          id?: number
          incentive_amount?: number
          incentive_slab_a?: number
          incentive_slab_b?: number
          incentive_slab_c?: number
          incentive_slab_d?: number
          native_brand_multiplier?: number
          native_multiplier?: number
          other_brand_multiplier?: number
          other_multiplier?: number
          rt_later_dead_days?: number
          rt_later_first_attempts?: number
          rt_later_first_days?: number
          rt_later_first_msg_days?: number
          rt_later_source_first_msg_days?: number
          rt_later_then_days?: number
          rt_no_attempts?: number
          rt_no_days?: number
          rt_no_dead_attempts?: number
          rt_no_dead_days?: number
          rt_no_dead_mode?: string
          rt_noresp_dead_days?: number
          rt_noresp_final_days?: number
          rt_noresp_first_attempts?: number
          rt_noresp_first_days?: number
          rt_noresp_first_msg_days?: number
          rt_noresp_second_attempts?: number
          rt_noresp_second_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      kob_leads: {
        Row: {
          assigned_language_executive: string | null
          assigned_to: string | null
          auto_fired_status: Database["public"]["Enums"]["auto_fire_status"]
          av_link_sent: boolean
          brand_id: string | null
          city_id: string | null
          code: string
          converted_at: string | null
          created_at: string
          cuisine: string | null
          district_id: string | null
          email: string | null
          form_link_sent: boolean
          full_name: string
          gallabox_template_sent: boolean
          has_unread_messages: boolean
          id: string
          investment_capacity: number | null
          language: Database["public"]["Enums"]["lead_language"]
          last_activity_at: string
          last_message: string | null
          last_message_at: string | null
          mode: Database["public"]["Enums"]["lead_mode"]
          next_action: string | null
          notes: string | null
          phone: string | null
          scv_score: number
          source_id: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          stage_entered_at: string
          state_id: string | null
          tags: string[]
          team_leader_id: string | null
          unread_message_count: number
          updated_at: string
        }
        Insert: {
          assigned_language_executive?: string | null
          assigned_to?: string | null
          auto_fired_status?: Database["public"]["Enums"]["auto_fire_status"]
          av_link_sent?: boolean
          brand_id?: string | null
          city_id?: string | null
          code: string
          converted_at?: string | null
          created_at?: string
          cuisine?: string | null
          district_id?: string | null
          email?: string | null
          form_link_sent?: boolean
          full_name: string
          gallabox_template_sent?: boolean
          has_unread_messages?: boolean
          id?: string
          investment_capacity?: number | null
          language?: Database["public"]["Enums"]["lead_language"]
          last_activity_at?: string
          last_message?: string | null
          last_message_at?: string | null
          mode?: Database["public"]["Enums"]["lead_mode"]
          next_action?: string | null
          notes?: string | null
          phone?: string | null
          scv_score?: number
          source_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          stage_entered_at?: string
          state_id?: string | null
          tags?: string[]
          team_leader_id?: string | null
          unread_message_count?: number
          updated_at?: string
        }
        Update: {
          assigned_language_executive?: string | null
          assigned_to?: string | null
          auto_fired_status?: Database["public"]["Enums"]["auto_fire_status"]
          av_link_sent?: boolean
          brand_id?: string | null
          city_id?: string | null
          code?: string
          converted_at?: string | null
          created_at?: string
          cuisine?: string | null
          district_id?: string | null
          email?: string | null
          form_link_sent?: boolean
          full_name?: string
          gallabox_template_sent?: boolean
          has_unread_messages?: boolean
          id?: string
          investment_capacity?: number | null
          language?: Database["public"]["Enums"]["lead_language"]
          last_activity_at?: string
          last_message?: string | null
          last_message_at?: string | null
          mode?: Database["public"]["Enums"]["lead_mode"]
          next_action?: string | null
          notes?: string | null
          phone?: string | null
          scv_score?: number
          source_id?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          stage_entered_at?: string
          state_id?: string | null
          tags?: string[]
          team_leader_id?: string | null
          unread_message_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["native_brand_id"]
          },
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "kob_leads_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "india_cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "kob_leads_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "india_districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["district_id"]
          },
          {
            foreignKeyName: "kob_leads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_source"
            referencedColumns: ["source_id"]
          },
          {
            foreignKeyName: "kob_leads_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "india_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["state_id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          metric: string
          period: string
          target_value: number
        }
        Insert: {
          created_at?: string
          effective_from?: string
          id?: string
          metric: string
          period?: string
          target_value?: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          metric?: string
          period?: string
          target_value?: number
        }
        Relationships: []
      }
      lead_activities: {
        Row: {
          activity_type: string
          actor_id: string | null
          created_at: string
          detail: string | null
          id: string
          lead_id: string
        }
        Insert: {
          activity_type: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          lead_id: string
        }
        Update: {
          activity_type?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_eoi1_retarget_malayalam_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_eoi1_retarget_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_eoi1_retarget_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_eoi1_retarget_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_eoi1_retarget_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_eoi1_retarget_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_eoi1_retarget_telugu_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_eoi1_retarget_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_eoi1_retarget_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_events: {
        Row: {
          created_at: string
          event: string
          event_at: string | null
          id: string
          lead_id: string | null
          payload: Json | null
          phone: string
          status: string | null
          template: string | null
        }
        Insert: {
          created_at?: string
          event: string
          event_at?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          phone: string
          status?: string | null
          template?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          event_at?: string | null
          id?: string
          lead_id?: string | null
          payload?: Json | null
          phone?: string
          status?: string | null
          template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_inbox_retarget_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_inbox_retarget_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_inbox_retarget_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          active: boolean
          category: string
          cost_per_lead: number
          created_at: string
          id: string
          name: string
        }
        Insert: {
          active?: boolean
          category?: string
          cost_per_lead?: number
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          active?: boolean
          category?: string
          cost_per_lead?: number
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      lead_stage_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_stage: Database["public"]["Enums"]["lead_stage"] | null
          id: string
          lead_id: string
          note: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: string
          lead_id: string
          note?: string | null
          to_stage: Database["public"]["Enums"]["lead_stage"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_stage?: Database["public"]["Enums"]["lead_stage"] | null
          id?: string
          lead_id?: string
          note?: string | null
          to_stage?: Database["public"]["Enums"]["lead_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_stage_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_webinar_retarget_malayalam_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_webinar_retarget_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_webinar_retarget_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_webinar_retarget_tamil_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_webinar_retarget_tamil_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_webinar_retarget_tamil_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      lead_webinar_retarget_telugu_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          stage_entered_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          stage_entered_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_webinar_retarget_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_webinar_retarget_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      marketing_kpi_targets: {
        Row: {
          created_at: string
          id: string
          metric: string
          period: string
          target_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metric: string
          period: string
          target_value?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metric?: string
          period?: string
          target_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      meta_ads_initial_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_ads_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_ads_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      profiles: {
        Row: {
          allocation_mode: string
          assignment_active: boolean
          created_at: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          primary_language: Database["public"]["Enums"]["lead_language"] | null
          rr_last_executive_id: string | null
          scv_score: number | null
          secondary_language:
            | Database["public"]["Enums"]["lead_language"]
            | null
          team_leader_id: string | null
          updated_at: string
        }
        Insert: {
          allocation_mode?: string
          assignment_active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          phone?: string | null
          primary_language?: Database["public"]["Enums"]["lead_language"] | null
          rr_last_executive_id?: string | null
          scv_score?: number | null
          secondary_language?:
            | Database["public"]["Enums"]["lead_language"]
            | null
          team_leader_id?: string | null
          updated_at?: string
        }
        Update: {
          allocation_mode?: string
          assignment_active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          primary_language?: Database["public"]["Enums"]["lead_language"] | null
          rr_last_executive_id?: string | null
          scv_score?: number | null
          secondary_language?:
            | Database["public"]["Enums"]["lead_language"]
            | null
          team_leader_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_team_leader_id_fkey"
            columns: ["team_leader_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_team_leader_id_fkey"
            columns: ["team_leader_id"]
            isOneToOne: false
            referencedRelation: "v_scv_composite"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profiles_team_leader_id_fkey"
            columns: ["team_leader_id"]
            isOneToOne: false
            referencedRelation: "v_scv_leaderboard"
            referencedColumns: ["user_id"]
          },
        ]
      }
      retargeting_attempts: {
        Row: {
          attempt_no: number
          bucket: Database["public"]["Enums"]["lead_stage"]
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          schedule_id: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          template_name: string
          updated_at: string
        }
        Insert: {
          attempt_no?: number
          bucket: Database["public"]["Enums"]["lead_stage"]
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          schedule_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          attempt_no?: number
          bucket?: Database["public"]["Enums"]["lead_stage"]
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          schedule_id?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retargeting_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retargeting_attempts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
          {
            foreignKeyName: "retargeting_attempts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "retargeting_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retargeting_attempts_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "v_retargeting_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      retargeting_rules: {
        Row: {
          bucket: string
          cadence: Json
          created_at: string
          max_attempts: number
          max_period_days: number
          updated_at: string
        }
        Insert: {
          bucket: string
          cadence: Json
          created_at?: string
          max_attempts: number
          max_period_days: number
          updated_at?: string
        }
        Update: {
          bucket?: string
          cadence?: Json
          created_at?: string
          max_attempts?: number
          max_period_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      retargeting_schedule: {
        Row: {
          attempts_done: number
          bucket: Database["public"]["Enums"]["lead_stage"]
          created_at: string
          first_touch_at: string
          first_touch_source: string | null
          id: string
          is_dead: boolean
          lead_id: string
          next_touch_at: string
          phase: number
          updated_at: string
        }
        Insert: {
          attempts_done?: number
          bucket: Database["public"]["Enums"]["lead_stage"]
          created_at?: string
          first_touch_at?: string
          first_touch_source?: string | null
          id?: string
          is_dead?: boolean
          lead_id: string
          next_touch_at?: string
          phase?: number
          updated_at?: string
        }
        Update: {
          attempts_done?: number
          bucket?: Database["public"]["Enums"]["lead_stage"]
          created_at?: string
          first_touch_at?: string
          first_touch_source?: string | null
          id?: string
          is_dead?: boolean
          lead_id?: string
          next_touch_at?: string
          phase?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retargeting_schedule_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retargeting_schedule_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      scv_component_weights: {
        Row: {
          id: number
          updated_at: string
          updated_by: string | null
          weight_conversion: number
          weight_crm_discipline: number
          weight_eoi2_payment: number
          weight_tat: number
        }
        Insert: {
          id?: number
          updated_at?: string
          updated_by?: string | null
          weight_conversion?: number
          weight_crm_discipline?: number
          weight_eoi2_payment?: number
          weight_tat?: number
        }
        Update: {
          id?: number
          updated_at?: string
          updated_by?: string | null
          weight_conversion?: number
          weight_crm_discipline?: number
          weight_eoi2_payment?: number
          weight_tat?: number
        }
        Relationships: []
      }
      scv_manual_ratings: {
        Row: {
          compliance_score: number | null
          created_at: string
          id: string
          notes: string | null
          period: string
          personal_score: number
          rated_at: string
          rated_by: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          compliance_score?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          period: string
          personal_score: number
          rated_at?: string
          rated_by?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          compliance_score?: number | null
          created_at?: string
          id?: string
          notes?: string | null
          period?: string
          personal_score?: number
          rated_at?: string
          rated_by?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      scv_mode_config: {
        Row: {
          components: Json
          incentive_amount: number
          mode: string
          tat_movements: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          components: Json
          incentive_amount?: number
          mode: string
          tat_movements: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          components?: Json
          incentive_amount?: number
          mode?: string
          tat_movements?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      scv_mode_config_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          component: string
          id: string
          mode: string
          new_value: string | null
          previous_value: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          component: string
          id?: string
          mode: string
          new_value?: string | null
          previous_value?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          component?: string
          id?: string
          mode?: string
          new_value?: string | null
          previous_value?: string | null
        }
        Relationships: []
      }
      scv_mode_inputs: {
        Row: {
          created_at: string
          discipline: number | null
          id: string
          ktn_cs_target: number | null
          marks: Json
          mode: string
          period: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          discipline?: number | null
          id?: string
          ktn_cs_target?: number | null
          marks?: Json
          mode: string
          period: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          discipline?: number | null
          id?: string
          ktn_cs_target?: number | null
          marks?: Json
          mode?: string
          period?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scv_monthly_inputs: {
        Row: {
          created_at: string
          crm_discipline: number | null
          id: string
          ktn_cs_target: number | null
          period: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          crm_discipline?: number | null
          id?: string
          ktn_cs_target?: number | null
          period: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          crm_discipline?: number | null
          id?: string
          ktn_cs_target?: number | null
          period?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      scv_role_weights: {
        Row: {
          compliance_weight: number
          official_weight: number
          personal_weight: number
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          compliance_weight: number
          official_weight: number
          personal_weight: number
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          compliance_weight?: number
          official_weight?: number
          personal_weight?: number
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      scv_rules: {
        Row: {
          id: number
          updated_at: string
          weight_conversion: number
          weight_crm_discipline: number
          weight_eoi1_webinar: number
          weight_eoi2_payment: number
          weight_tat: number
        }
        Insert: {
          id: number
          updated_at?: string
          weight_conversion?: number
          weight_crm_discipline?: number
          weight_eoi1_webinar?: number
          weight_eoi2_payment?: number
          weight_tat?: number
        }
        Update: {
          id?: number
          updated_at?: string
          weight_conversion?: number
          weight_crm_discipline?: number
          weight_eoi1_webinar?: number
          weight_eoi2_payment?: number
          weight_tat?: number
        }
        Relationships: []
      }
      scv_weight_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          component: string
          id: string
          new_weight: number
          previous_weight: number
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          component: string
          id?: string
          new_weight: number
          previous_weight: number
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          component?: string
          id?: string
          new_weight?: number
          previous_weight?: number
        }
        Relationships: []
      }
      state_native_brand: {
        Row: {
          brand_id: string
          created_at: string
          state_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          state_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          state_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "state_native_brand_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "state_native_brand_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["native_brand_id"]
          },
          {
            foreignKeyName: "state_native_brand_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_brand"
            referencedColumns: ["brand_id"]
          },
          {
            foreignKeyName: "state_native_brand_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: true
            referencedRelation: "india_states"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "state_native_brand_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: true
            referencedRelation: "v_city_scope"
            referencedColumns: ["state_id"]
          },
        ]
      }
      support_lead_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          template_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_lead_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_lead_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webinar_attendance: {
        Row: {
          attended: boolean
          batch_id: string
          created_at: string
          defaulter_marked_at: string | null
          id: string
          lead_id: string
          marked_at: string | null
          marked_by: string | null
          updated_at: string
        }
        Insert: {
          attended?: boolean
          batch_id: string
          created_at?: string
          defaulter_marked_at?: string | null
          id?: string
          lead_id: string
          marked_at?: string | null
          marked_by?: string | null
          updated_at?: string
        }
        Update: {
          attended?: boolean
          batch_id?: string
          created_at?: string
          defaulter_marked_at?: string | null
          id?: string
          lead_id?: string
          marked_at?: string | null
          marked_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_attendance_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "webinar_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_attendance_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_attendance_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      webinar_batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          language: string | null
          name: string
          notes: string | null
          scheduled_at: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          language?: string | null
          name: string
          notes?: string | null
          scheduled_at: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          language?: string | null
          name?: string
          notes?: string | null
          scheduled_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      website_form_default_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_form_default_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_form_default_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      website_form_malayalam_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_form_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_form_malayalam_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      website_form_tamil_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_form_tamil_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_form_tamil_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      website_form_telugu_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_form_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_form_telugu_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      whatsapp_broadcast_initial_sends: {
        Row: {
          created_at: string
          error: string | null
          id: string
          lead_id: string
          request_id: number | null
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          lead_id?: string
          request_id?: number | null
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_broadcast_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_broadcast_initial_sends_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
    }
    Views: {
      v_abandoned_leads: {
        Row: {
          assigned_to: string | null
          brand_id: string | null
          brand_name: string | null
          code: string | null
          days_in_stage: number | null
          full_name: string | null
          is_abandoned: boolean | null
          language: Database["public"]["Enums"]["lead_language"] | null
          lead_id: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          stage_entered_at: string | null
          team_leader_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_city_scope"
            referencedColumns: ["native_brand_id"]
          },
          {
            foreignKeyName: "kob_leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "v_funnel_by_brand"
            referencedColumns: ["brand_id"]
          },
        ]
      }
      v_city_scope: {
        Row: {
          city_active: boolean | null
          city_id: string | null
          city_name: string | null
          district_active: boolean | null
          district_id: string | null
          district_name: string | null
          native_brand_id: string | null
          native_brand_multiplier: number | null
          native_brand_name: string | null
          native_kitchen_scope: number | null
          other_brand_multiplier: number | null
          other_kitchen_scope: number | null
          pincode_count: number | null
          state_active: boolean | null
          state_id: string | null
          state_name: string | null
          tier: number | null
        }
        Relationships: []
      }
      v_funnel_by_brand: {
        Row: {
          agreement: number | null
          brand_code: string | null
          brand_id: string | null
          brand_name: string | null
          fee_paid: number | null
          ktn_cs: number | null
          ktn_live: number | null
          total_leads: number | null
        }
        Relationships: []
      }
      v_funnel_by_language: {
        Row: {
          agreement: number | null
          fee_paid: number | null
          ktn_cs: number | null
          ktn_live: number | null
          language: Database["public"]["Enums"]["lead_language"] | null
          total_leads: number | null
        }
        Relationships: []
      }
      v_funnel_by_source: {
        Row: {
          agreement_count: number | null
          cost_per_lead: number | null
          eoi1_count: number | null
          eoi2_count: number | null
          fee_paid_count: number | null
          form_filled_count: number | null
          inbox_count: number | null
          ktn_cs_count: number | null
          ktn_live_count: number | null
          source_id: string | null
          source_name: string | null
          total_leads: number | null
          total_spend: number | null
          webinar_count: number | null
        }
        Relationships: []
      }
      v_kpi_snapshot: {
        Row: {
          achieved: number | null
          achieved_pct: number | null
          metric: string | null
          prev_period: number | null
          run_rate: number | null
          target: number | null
          trend: string | null
        }
        Relationships: []
      }
      v_lead_evaluation_history: {
        Row: {
          answered_count: number | null
          evaluation_id: string | null
          filled_at: string | null
          filled_by: string | null
          lead_id: string | null
          scored_answered_count: number | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      v_lead_evaluation_score: {
        Row: {
          answered_count: number | null
          evaluation_id: string | null
          filled_at: string | null
          lead_id: string | null
          scored_answered_count: number | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_responses_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      v_retargeting_queue: {
        Row: {
          assigned_to: string | null
          attempts_done: number | null
          brand_name: string | null
          bucket: Database["public"]["Enums"]["lead_stage"] | null
          city_name: string | null
          code: string | null
          full_name: string | null
          id: string | null
          is_dead: boolean | null
          language: Database["public"]["Enums"]["lead_language"] | null
          lead_id: string | null
          mode: Database["public"]["Enums"]["lead_mode"] | null
          next_touch_at: string | null
          phase: number | null
          phone: string | null
          stage: Database["public"]["Enums"]["lead_stage"] | null
          state_name: string | null
          team_leader_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retargeting_schedule_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "kob_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retargeting_schedule_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "v_abandoned_leads"
            referencedColumns: ["lead_id"]
          },
        ]
      }
      v_scv_composite: {
        Row: {
          compliance_score: number | null
          compliance_weight: number | null
          composite_score: number | null
          full_name: string | null
          official_score: number | null
          official_weight: number | null
          personal_score: number | null
          personal_weight: number | null
          rated_at: string | null
          rating_period: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
        }
        Relationships: []
      }
      v_scv_leaderboard: {
        Row: {
          avg_scv: number | null
          conversion_pct: number | null
          conversions: number | null
          crm_pct: number | null
          eoi1_webinar_pct: number | null
          eoi2_payment_pct: number | null
          fee_paid: number | null
          full_name: string | null
          lead_count: number | null
          tat_pct: number | null
          user_id: string | null
        }
        Relationships: []
      }
      v_state_pincode_totals: {
        Row: {
          state: string | null
          total_pincodes: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      advance_retargeting: {
        Args: never
        Returns: {
          advanced: number
          killed: number
          processed: number
          skipped_no_template: number
        }[]
      }
      advance_retargeting_schedule: {
        Args: never
        Returns: {
          advanced: number
          killed: number
          processed: number
        }[]
      }
      apply_later_retargeting: {
        Args: { _lead_id: string }
        Returns: {
          new_stage: Database["public"]["Enums"]["lead_stage"]
          previous_stage: Database["public"]["Enums"]["lead_stage"]
          updated: boolean
        }[]
      }
      apply_no_retargeting: {
        Args: { _lead_id: string }
        Returns: {
          new_stage: Database["public"]["Enums"]["lead_stage"]
          previous_stage: Database["public"]["Enums"]["lead_stage"]
          updated: boolean
        }[]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      lead_has_any_message: { Args: { _lead_id: string }; Returns: boolean }
      mark_failed_fire_leads: {
        Args: { _grace_hours?: number }
        Returns: {
          moved: number
          processed: number
        }[]
      }
      mark_webinar_defaulters: {
        Args: never
        Returns: {
          marked: number
          skipped_no_template: number
        }[]
      }
      move_eoi1_48h_to_no_response: {
        Args: never
        Returns: {
          moved: number
        }[]
      }
      move_lead_inbox_24h_to_no_response: {
        Args: never
        Returns: {
          moved: number
        }[]
      }
      move_webinar_48h_to_no_response: {
        Args: never
        Returns: {
          moved: number
        }[]
      }
      process_retargeting_sends: {
        Args: never
        Returns: {
          killed: number
          processed: number
          sent: number
          skipped: number
        }[]
      }
      recompute_city_pincode_counts: {
        Args: { _city_id?: string }
        Returns: {
          city_id: string
          city_name: string
          pincode_count: number
        }[]
      }
      reconcile_website_form_sends: {
        Args: never
        Returns: {
          checked: number
          failed: number
        }[]
      }
      render_email_text: {
        Args: { _lead_name: string; _text: string }
        Returns: string
      }
      retry_failed_website_form_malayalam_sends: {
        Args: { _lead_id?: string }
        Returns: number
      }
      send_csv_import_meta_ads_initial: {
        Args: { _lead_id: string }
        Returns: string
      }
      send_eoi1_7day_retargeting: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_eoi1_7day_retargeting_malayalam: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_eoi1_7day_retargeting_telugu: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_lead_inbox_7day_retargeting: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_webinar_7day_retargeting_malayalam: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_webinar_7day_retargeting_tamil: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
      send_webinar_7day_retargeting_telugu: {
        Args: never
        Returns: {
          processed: number
          sent: number
          skipped: number
        }[]
      }
    }
    Enums: {
      app_role: "super_admin" | "kob_manager" | "team_leader" | "executive"
      auto_fire_status: "NOT_FIRED" | "FIRED" | "FAILED"
      lead_language:
        | "TAMIL"
        | "TELUGU"
        | "MALAYALAM"
        | "HINDI"
        | "BENGALI"
        | "ENGLISH"
        | "KANNADA"
        | "MARATHI"
        | "GUJARATI"
        | "OTHERS"
      lead_mode: "AUTO" | "MANUAL"
      lead_stage:
        | "LEAD_INBOX"
        | "AUTO_FIRED"
        | "FAILED_FIRE"
        | "EOI_1"
        | "WEBINAR"
        | "WEBINAR_ATTENDED"
        | "EOI2_PENDING"
        | "EOI_2"
        | "FORM_FILLED"
        | "FEE_PAID"
        | "AGREEMENT_SIGNED"
        | "KTN_CS"
        | "KTN_LIVE"
        | "NO"
        | "LATER"
        | "NO_RESPONSE"
        | "RETARGETING"
        | "DEAD_LEAD"
        | "NON_SERVICEABLE"
        | "NO_VACANCY"
        | "DUPLICATE_LEAD"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["super_admin", "kob_manager", "team_leader", "executive"],
      auto_fire_status: ["NOT_FIRED", "FIRED", "FAILED"],
      lead_language: [
        "TAMIL",
        "TELUGU",
        "MALAYALAM",
        "HINDI",
        "BENGALI",
        "ENGLISH",
        "KANNADA",
        "MARATHI",
        "GUJARATI",
        "OTHERS",
      ],
      lead_mode: ["AUTO", "MANUAL"],
      lead_stage: [
        "LEAD_INBOX",
        "AUTO_FIRED",
        "FAILED_FIRE",
        "EOI_1",
        "WEBINAR",
        "WEBINAR_ATTENDED",
        "EOI2_PENDING",
        "EOI_2",
        "FORM_FILLED",
        "FEE_PAID",
        "AGREEMENT_SIGNED",
        "KTN_CS",
        "KTN_LIVE",
        "NO",
        "LATER",
        "NO_RESPONSE",
        "RETARGETING",
        "DEAD_LEAD",
        "NON_SERVICEABLE",
        "NO_VACANCY",
        "DUPLICATE_LEAD",
      ],
    },
  },
} as const
