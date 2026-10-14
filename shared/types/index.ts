// Shared DTO and interface types for frontend and backend

export type QuestionType = "SCALE_1_5" | "YES_NO" | "TEXT";

export type MetaSpendResult = { totalSpend: number; cpl: number };

export type MetaCampaignRecord = {
  id: string;
  name: string;
  status: string;
  effective_status?: string;
  objective?: string;
  created_time?: string;
  updated_time?: string;
  spend: number;
  leads: number;
  cpl: number;
  is_enabled: boolean;
};

export type MetaCampaignsListResult = {
  campaigns: MetaCampaignRecord[];
  totalCount: number;
  account: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
  };
  summary: {
    totalCampaigns: number;
    enabledCount: number;
    combinedSpend: number;
    combinedLeads: number;
    combinedCpl: number;
  };
};

export type MetaCplResult = {
  hasEnabledCampaigns: boolean;
  enabledCount: number;
  totalSpend: number;
  totalLeads: number;
  cpl: number;
  currency: string;
  error?: string | null;
};

export type UserRole = "super_admin" | "kob_manager" | "team_leader" | "executive";

export type MyRoleResponse = {
  role: UserRole | string;
  profile: any;
};

export type ChannelMetric = { leads: number; conv: number; cpl: number };

export type ChannelConversionData = {
  marketing: ChannelMetric;
  website: ChannelMetric;
  organic: ChannelMetric;
  whatsapp: ChannelMetric;
  other: ChannelMetric;
};
