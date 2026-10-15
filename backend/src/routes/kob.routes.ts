import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getMyPageAccess, getUserPageAccess, putUserPageAccess } from "../controllers/pageAccess.controller.js";
import {
  listBrands,
  listSources,
  listStates,
  listStatePincodeTotals,
  listCitiesWithScope,
  listStateNativeBrands,
  getConfig,
  listKpiTargets,
  listAuditLogs,
  getScvRules,
  getIncentiveRules,
  listRateableUsers,
  listRoleWeights,
  listAllProfiles,
  getKpiSnapshot,
  getContractsCount,
  getDashboardKpis,
  getFunnelBySource,
  getFunnelByLanguage,
  getFunnelByBrand,
  getStageDistribution,
  getStateSummary,
  listMarketingTargets,
  listManualRatings,
  listScvComposite,
  getMyAllocationMode,
  listGallaboxTemplates,
  getAbandonedLeads,
  getAllocationBreakdownByTL,
  getExecutiveStageSummary,
  getKpiTrend,
  getMarketingKpis,
  getMetricDrilldown,
  getMyRetargetingQueue,
  getMyScvScore,
  getMyStageHistory,
  getMyTeam,
  getRetargetingQueue,
  getScvComponentWeights,
  getScvLeaderboard,
  getScvModeIncentives,
  getTLBrandPerformance,
  getTLExecutivePerformance,
  getTLLanguagePerformance,
  getTLOverview,
  getTLRetargeting,
  getTLScvIncentives,
  getTLTATBreach,
  getUnallocatedLeads,
  listActiveExecutives,
  listAllExecutives,
  listAllocatableExecutives,
  listExecutivesWithStats,
  getLeadDetail,
  getMyExecOverview,
  getScvModeConfig,
  getTATBreachDetailed,
  getMyRole,
  listGallaboxFireQueue,
  listLeads,
  listWhatsappExecutives,
  listWhatsappMessages,
  upsertKpiTarget,
  deleteKpiTarget,
  upsertMarketingTarget,
  upsertManualRating,
  createBrand,
  updateSourceCost,
  upsertStateNativeBrand,
  upsertGallaboxTemplate,
  updateIncentiveRule,
  updateScvRules,
  updateConfig,
  updateMyAllocationMode,
  updateExecutiveLanguage,
  reassignExecutiveTeamLeader,
  updateScvComponentWeights,
  saveScvMonthlyInput,
  toggleEntity,
  saveIncentiveAmount,
  saveIncentiveSlabs,
  saveScvModeConfig,
  saveScvModeInput,
  setLeadCuisine,
  updateLeadNextAction,
  setLeadRnrTag,
  markLeadMessagesRead,
  createExecutive,
  reassignLead,
  createManualLead,
  updateLeadStage,
  importLeads,
} from "../controllers/kob.controller.js";
import {
  updateCityPincodeAliases,
  syncCityPincodesFromIndiaPost,
} from "../controllers/admin.controller.js";

export const kobRouter = Router();

// GET /api/kob/list-brands - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-brands", requireAuth, listBrands);

// GET /api/kob/list-sources - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-sources", requireAuth, listSources);

// GET /api/kob/list-states - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-states", requireAuth, listStates);

// GET /api/kob/list-state-pincode-totals - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-state-pincode-totals", requireAuth, listStatePincodeTotals);

// GET /api/kob/list-cities-with-scope - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-cities-with-scope", requireAuth, listCitiesWithScope);

// GET /api/kob/list-state-native-brands - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-state-native-brands", requireAuth, listStateNativeBrands);

// GET /api/kob/get-config - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/get-config", requireAuth, getConfig);

// GET /api/kob/list-kpi-targets - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-kpi-targets", requireAuth, listKpiTargets);

// GET /api/kob/list-audit-logs - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-audit-logs", requireAuth, listAuditLogs);

// GET /api/kob/get-scv-rules - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/get-scv-rules", requireAuth, getScvRules);

// GET /api/kob/get-incentive-rules - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/get-incentive-rules", requireAuth, getIncentiveRules);

// GET /api/kob/list-rateable-users - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-rateable-users", requireAuth, listRateableUsers);

// GET /api/kob/list-role-weights - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-role-weights", requireAuth, listRoleWeights);

// GET /api/kob/list-all-profiles - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-all-profiles", requireAuth, listAllProfiles);

// GET /api/kob/get-kpi-snapshot - Protected by auth middleware, uses supabaseAdmin or req.supabase
kobRouter.get("/get-kpi-snapshot", requireAuth, getKpiSnapshot);

// GET /api/kob/get-contracts-count - Protected by auth middleware, uses supabaseAdmin or req.supabase
kobRouter.get("/get-contracts-count", requireAuth, getContractsCount);

// GET /api/kob/get-dashboard-kpis - Protected by auth middleware, uses supabaseAdmin or req.supabase
kobRouter.get("/get-dashboard-kpis", requireAuth, getDashboardKpis);

// GET /api/kob/get-funnel-by-source - Protected by auth middleware, uses orgRead and req.supabase
kobRouter.get("/get-funnel-by-source", requireAuth, getFunnelBySource);

// GET /api/kob/get-funnel-by-language - Protected by auth middleware, uses orgRead
kobRouter.get("/get-funnel-by-language", requireAuth, getFunnelByLanguage);

// GET /api/kob/get-funnel-by-brand - Protected by auth middleware, uses orgRead and req.supabase
kobRouter.get("/get-funnel-by-brand", requireAuth, getFunnelByBrand);

// GET /api/kob/get-stage-distribution - Protected by auth middleware, uses orgRead
kobRouter.get("/get-stage-distribution", requireAuth, getStageDistribution);

// GET /api/kob/get-state-summary - Protected by auth middleware, uses orgRead and req.supabase
kobRouter.get("/get-state-summary", requireAuth, getStateSummary);

// GET /api/kob/list-marketing-targets - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-marketing-targets", requireAuth, listMarketingTargets);

// GET /api/kob/list-manual-ratings - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-manual-ratings", requireAuth, listManualRatings);

// GET /api/kob/list-scv-composite - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-scv-composite", requireAuth, listScvComposite);

// GET /api/kob/get-my-allocation-mode - Protected by auth middleware, strictly scoped to req.userId
kobRouter.get("/get-my-allocation-mode", requireAuth, getMyAllocationMode);

// GET /api/kob/list-gallabox-templates - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/list-gallabox-templates", requireAuth, listGallaboxTemplates);

// GET /api/kob/abandoned-leads - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/abandoned-leads", requireAuth, getAbandonedLeads);

// GET /api/kob/allocation-breakdown-by-tl - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/allocation-breakdown-by-tl", requireAuth, getAllocationBreakdownByTL);

// GET /api/kob/executive-stage-summary - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/executive-stage-summary", requireAuth, getExecutiveStageSummary);

// GET /api/kob/kpi-trend - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/kpi-trend", requireAuth, getKpiTrend);

// GET /api/kob/marketing-kpis - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/marketing-kpis", requireAuth, getMarketingKpis);

// GET /api/kob/metric-drilldown - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/metric-drilldown", requireAuth, getMetricDrilldown);

// GET /api/kob/my-retargeting-queue - Protected by auth middleware, scoped to req.user.id
kobRouter.get("/my-retargeting-queue", requireAuth, getMyRetargetingQueue);

// GET /api/kob/my-scv-score - Protected by auth middleware, scoped to req.user.id
kobRouter.get("/my-scv-score", requireAuth, getMyScvScore);

// GET /api/kob/my-stage-history - Protected by auth middleware, scoped to req.user.id
kobRouter.get("/my-stage-history", requireAuth, getMyStageHistory);

// GET /api/kob/my-team - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/my-team", requireAuth, getMyTeam);

// GET /api/kob/retargeting-queue - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/retargeting-queue", requireAuth, getRetargetingQueue);

// GET /api/kob/scv-component-weights - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/scv-component-weights", requireAuth, getScvComponentWeights);

// GET /api/kob/scv-leaderboard - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/scv-leaderboard", requireAuth, getScvLeaderboard);

// GET /api/kob/scv-mode-incentives - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/scv-mode-incentives", requireAuth, getScvModeIncentives);

// GET /api/kob/tl-brand-performance - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-brand-performance", requireAuth, getTLBrandPerformance);

// GET /api/kob/tl-executive-performance - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-executive-performance", requireAuth, getTLExecutivePerformance);

// GET /api/kob/tl-language-performance - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-language-performance", requireAuth, getTLLanguagePerformance);

// GET /api/kob/tl-overview - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-overview", requireAuth, getTLOverview);

// GET /api/kob/tl-retargeting - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-retargeting", requireAuth, getTLRetargeting);

// GET /api/kob/tl-scv-incentives - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/tl-scv-incentives", requireAuth, getTLScvIncentives);

// GET /api/kob/tl-tat-breach - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/tl-tat-breach", requireAuth, getTLTATBreach);

// GET /api/kob/unallocated-leads - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/unallocated-leads", requireAuth, getUnallocatedLeads);

// GET /api/kob/active-executives - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/active-executives", requireAuth, listActiveExecutives);

// GET /api/kob/all-executives - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/all-executives", requireAuth, listAllExecutives);

// GET /api/kob/allocatable-executives - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/allocatable-executives", requireAuth, listAllocatableExecutives);

// GET /api/kob/executives-with-stats - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/executives-with-stats", requireAuth, listExecutivesWithStats);

// GET /api/kob/lead-detail - Protected by auth middleware, uses supabaseAdmin/req.supabase
kobRouter.get("/lead-detail", requireAuth, getLeadDetail);

// GET /api/kob/my-exec-overview - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/my-exec-overview", requireAuth, getMyExecOverview);

// GET /api/kob/scv-mode-config - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/scv-mode-config", requireAuth, getScvModeConfig);

// GET /api/kob/tat-breach-detailed - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/tat-breach-detailed", requireAuth, getTATBreachDetailed);

// GET /api/kob/my-role - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/my-role", requireAuth, getMyRole);

// Page Access Management (additive, CEO-controlled) — RDS-only, see pageAccess.controller.ts
kobRouter.get("/my-page-access", requireAuth, getMyPageAccess);
kobRouter.get("/users/:userId/page-access", requireAuth, getUserPageAccess);
kobRouter.put("/users/:userId/page-access", requireAuth, putUserPageAccess);

// GET /api/kob/gallabox-fire-queue - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.get("/gallabox-fire-queue", requireAuth, listGallaboxFireQueue);

// GET /api/kob/leads - Protected by auth middleware, uses role-based client
kobRouter.get("/leads", requireAuth, listLeads);

// GET /api/kob/whatsapp-executives - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/whatsapp-executives", requireAuth, listWhatsappExecutives);

// GET /api/kob/whatsapp-messages - Protected by auth middleware, uses getOrgReadClient (RLS/role)
kobRouter.get("/whatsapp-messages", requireAuth, listWhatsappMessages);

// POST /api/kob/kpi-targets - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/kpi-targets", requireAuth, upsertKpiTarget);

// DELETE /api/kob/kpi-targets/:id - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.delete("/kpi-targets/:id", requireAuth, deleteKpiTarget);
kobRouter.delete("/kpi-targets", requireAuth, deleteKpiTarget);

// POST /api/kob/marketing-targets - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/marketing-targets", requireAuth, upsertMarketingTarget);

// POST /api/kob/manual-ratings - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/manual-ratings", requireAuth, upsertManualRating);

// POST /api/kob/brands - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/brands", requireAuth, createBrand);

// PATCH /api/kob/sources/:id/cost - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/sources/:id/cost", requireAuth, updateSourceCost);
kobRouter.post("/sources/:id/cost", requireAuth, updateSourceCost);
kobRouter.post("/sources/cost", requireAuth, updateSourceCost);

// POST /api/kob/state-native-brand - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/state-native-brand", requireAuth, upsertStateNativeBrand);

// POST /api/kob/gallabox-templates - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/gallabox-templates", requireAuth, upsertGallaboxTemplate);

// PATCH /api/kob/incentive-rules/:id - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/incentive-rules/:id", requireAuth, updateIncentiveRule);
kobRouter.post("/incentive-rules/:id", requireAuth, updateIncentiveRule);
kobRouter.post("/incentive-rules", requireAuth, updateIncentiveRule);

// PATCH /api/kob/scv-rules - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/scv-rules", requireAuth, updateScvRules);
kobRouter.post("/scv-rules", requireAuth, updateScvRules);

// PATCH /api/kob/config - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/config", requireAuth, updateConfig);
kobRouter.post("/config", requireAuth, updateConfig);

// PATCH /api/kob/my-allocation-mode - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/my-allocation-mode", requireAuth, updateMyAllocationMode);
kobRouter.post("/my-allocation-mode", requireAuth, updateMyAllocationMode);

// PATCH /api/kob/executives/:id/language - Protected by auth middleware, uses req.supabase/admin
kobRouter.patch("/executives/:id/language", requireAuth, updateExecutiveLanguage);
kobRouter.post("/executives/:id/language", requireAuth, updateExecutiveLanguage);
kobRouter.patch("/executives/language", requireAuth, updateExecutiveLanguage);
kobRouter.post("/executives/language", requireAuth, updateExecutiveLanguage);

// PATCH /api/kob/executives/:id/team-leader - Protected by auth middleware, uses req.supabase
kobRouter.patch("/executives/:id/team-leader", requireAuth, reassignExecutiveTeamLeader);
kobRouter.post("/executives/:id/team-leader", requireAuth, reassignExecutiveTeamLeader);
kobRouter.patch("/executives/team-leader", requireAuth, reassignExecutiveTeamLeader);
kobRouter.post("/executives/team-leader", requireAuth, reassignExecutiveTeamLeader);

// PATCH /api/kob/scv-component-weights - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.patch("/scv-component-weights", requireAuth, updateScvComponentWeights);
kobRouter.post("/scv-component-weights", requireAuth, updateScvComponentWeights);

// POST /api/kob/scv-monthly-input - Protected by auth middleware, uses req.supabase (RLS)
kobRouter.post("/scv-monthly-input", requireAuth, saveScvMonthlyInput);
kobRouter.patch("/scv-monthly-input", requireAuth, saveScvMonthlyInput);

// PATCH/POST /api/kob/entities/:entity/:id/toggle - Protected by auth middleware, uses req.supabase
kobRouter.patch("/entities/:entity/:id/toggle", requireAuth, toggleEntity);
kobRouter.post("/entities/:entity/:id/toggle", requireAuth, toggleEntity);
kobRouter.patch("/entities/toggle", requireAuth, toggleEntity);
kobRouter.post("/entities/toggle", requireAuth, toggleEntity);

// POST/PATCH /api/kob/scv/incentive-amount - Protected by auth middleware, uses req.supabase
kobRouter.post("/scv/incentive-amount", requireAuth, saveIncentiveAmount);
kobRouter.patch("/scv/incentive-amount", requireAuth, saveIncentiveAmount);

// POST/PATCH /api/kob/scv/incentive-slabs - Protected by auth middleware, uses req.supabase/admin
kobRouter.post("/scv/incentive-slabs", requireAuth, saveIncentiveSlabs);
kobRouter.patch("/scv/incentive-slabs", requireAuth, saveIncentiveSlabs);

// POST/PATCH /api/kob/scv/mode-config - Protected by auth middleware, uses req.supabase
kobRouter.post("/scv/mode-config", requireAuth, saveScvModeConfig);
kobRouter.patch("/scv/mode-config", requireAuth, saveScvModeConfig);

// POST/PATCH /api/kob/scv/mode-input - Protected by auth middleware, uses req.supabase
kobRouter.post("/scv/mode-input", requireAuth, saveScvModeInput);
kobRouter.patch("/scv/mode-input", requireAuth, saveScvModeInput);

// PATCH/POST /api/kob/leads/:id/cuisine - Protected by auth middleware, uses req.supabase
kobRouter.patch("/leads/:id/cuisine", requireAuth, setLeadCuisine);
kobRouter.post("/leads/:id/cuisine", requireAuth, setLeadCuisine);
kobRouter.patch("/leads/cuisine", requireAuth, setLeadCuisine);
kobRouter.post("/leads/cuisine", requireAuth, setLeadCuisine);

// PATCH/POST /api/kob/leads/:id/next-action - Protected by auth middleware, uses req.supabase
kobRouter.patch("/leads/:id/next-action", requireAuth, updateLeadNextAction);
kobRouter.post("/leads/:id/next-action", requireAuth, updateLeadNextAction);
kobRouter.patch("/leads/next-action", requireAuth, updateLeadNextAction);
kobRouter.post("/leads/next-action", requireAuth, updateLeadNextAction);

// PATCH/POST /api/kob/leads/:id/rnr-tag - Protected by auth middleware, uses req.supabase
kobRouter.patch("/leads/:id/rnr-tag", requireAuth, setLeadRnrTag);
kobRouter.post("/leads/:id/rnr-tag", requireAuth, setLeadRnrTag);
kobRouter.patch("/leads/rnr-tag", requireAuth, setLeadRnrTag);
kobRouter.post("/leads/rnr-tag", requireAuth, setLeadRnrTag);

// POST/PATCH /api/kob/leads/:id/messages/read - Protected by auth middleware, uses req.supabase
kobRouter.post("/leads/:id/messages/read", requireAuth, markLeadMessagesRead);
kobRouter.patch("/leads/:id/messages/read", requireAuth, markLeadMessagesRead);
kobRouter.post("/leads/messages/read", requireAuth, markLeadMessagesRead);
kobRouter.patch("/leads/messages/read", requireAuth, markLeadMessagesRead);

// POST /api/kob/executives - Protected by auth middleware, uses supabaseAdmin
kobRouter.post("/executives", requireAuth, createExecutive);

// PATCH/POST /api/kob/leads/:id/assignee - Protected by auth middleware, uses req.supabase
kobRouter.patch("/leads/:id/assignee", requireAuth, reassignLead);
kobRouter.post("/leads/:id/assignee", requireAuth, reassignLead);
kobRouter.patch("/leads/:id/reassign", requireAuth, reassignLead);
kobRouter.post("/leads/:id/reassign", requireAuth, reassignLead);
kobRouter.patch("/leads/reassign", requireAuth, reassignLead);
kobRouter.post("/leads/reassign", requireAuth, reassignLead);

// POST /api/kob/leads/manual - Protected by auth middleware, uses req.supabase
kobRouter.post("/leads/manual", requireAuth, createManualLead);

// PATCH/POST /api/kob/leads/:id/stage - Protected by auth middleware, uses req.supabase
kobRouter.patch("/leads/:id/stage", requireAuth, updateLeadStage);
kobRouter.post("/leads/:id/stage", requireAuth, updateLeadStage);
kobRouter.patch("/leads/stage", requireAuth, updateLeadStage);
kobRouter.post("/leads/stage", requireAuth, updateLeadStage);

// POST /api/kob/leads/import - Protected by auth middleware, bulk imports leads
kobRouter.post("/leads/import", requireAuth, importLeads);

// PATCH/POST /api/kob/pincodes/aliases - Fallback route matching admin aliases
kobRouter.patch("/pincodes/aliases", requireAuth, updateCityPincodeAliases);
kobRouter.post("/pincodes/aliases", requireAuth, updateCityPincodeAliases);

// POST /api/kob/pincodes/sync-india-post - Recompute pincode counts
kobRouter.post("/pincodes/sync-india-post", requireAuth, syncCityPincodesFromIndiaPost);
kobRouter.post("/pincodes/recompute", requireAuth, syncCityPincodesFromIndiaPost);


