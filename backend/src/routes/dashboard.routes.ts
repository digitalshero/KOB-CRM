import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  getAbandonedFunnel,
  getAbandonedSplit,
  getAutoFunnel,
  getAutoFunnelBuckets,
  getBrandPerformance,
  getCombinedFunnel,
  getCombinedFunnelBuckets,
  getCombinedStageResponseSplit,
  getCombinedStageResponseSplitTable,
  getLeadsTrend,
  getManualFunnel,
  getManualFunnelBuckets,
  getManualStageResponseSplit,
  getRetargetingFunnel,
  getRetargetingSplit,
  getStageResponseSplit,
  getStateSpread,
  getVariantStageResponseSplitTable,
  getExecPerformanceSummary,
  getFunnelStageLeads,
  getChannelConversion,
} from "../controllers/dashboard.controller.js";

export const dashboardRouter = Router();

// GET /api/dashboard/abandoned-funnel - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/abandoned-funnel", requireAuth, getAbandonedFunnel);

// GET /api/dashboard/abandoned-split - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/abandoned-split", requireAuth, getAbandonedSplit);

// GET /api/dashboard/auto-funnel - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/auto-funnel", requireAuth, getAutoFunnel);

// GET /api/dashboard/auto-funnel-buckets - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/auto-funnel-buckets", requireAuth, getAutoFunnelBuckets);

// GET /api/dashboard/brand-performance - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/brand-performance", requireAuth, getBrandPerformance);

// GET /api/dashboard/combined-funnel - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/combined-funnel", requireAuth, getCombinedFunnel);

// GET /api/dashboard/combined-funnel-buckets - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/combined-funnel-buckets", requireAuth, getCombinedFunnelBuckets);

// GET /api/dashboard/combined-stage-response-split - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/combined-stage-response-split", requireAuth, getCombinedStageResponseSplit);

// GET /api/dashboard/combined-stage-response-split-table - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/combined-stage-response-split-table", requireAuth, getCombinedStageResponseSplitTable);

// GET /api/dashboard/leads-trend - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/leads-trend", requireAuth, getLeadsTrend);

// GET /api/dashboard/manual-funnel - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/manual-funnel", requireAuth, getManualFunnel);

// GET /api/dashboard/manual-funnel-buckets - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/manual-funnel-buckets", requireAuth, getManualFunnelBuckets);

// GET /api/dashboard/manual-stage-response-split - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/manual-stage-response-split", requireAuth, getManualStageResponseSplit);

// GET /api/dashboard/retargeting-funnel - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/retargeting-funnel", requireAuth, getRetargetingFunnel);

// GET /api/dashboard/retargeting-split - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/retargeting-split", requireAuth, getRetargetingSplit);

// GET /api/dashboard/stage-response-split - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/stage-response-split", requireAuth, getStageResponseSplit);

// GET /api/dashboard/state-spread - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/state-spread", requireAuth, getStateSpread);

// GET /api/dashboard/variant-stage-response-split-table - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/variant-stage-response-split-table", requireAuth, getVariantStageResponseSplitTable);

// GET /api/dashboard/executive-performance-summary - Protected by auth middleware, uses role-based db client
dashboardRouter.get("/executive-performance-summary", requireAuth, getExecPerformanceSummary);

// GET /api/dashboard/funnel-stage-leads - Protected by auth middleware, uses req.supabase (RLS)
dashboardRouter.get("/funnel-stage-leads", requireAuth, getFunnelStageLeads);

// GET /api/dashboard/channel-conversion - Protected by auth middleware, uses role-based db client
dashboardRouter.get("/channel-conversion", requireAuth, getChannelConversion);



