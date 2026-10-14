import { Route as funnelsRoute } from "../src/routes/api/public/kob/conversion-funnels.js";
import { Route as stageCountsRoute } from "../src/routes/api/public/kob/lead-stage-counts.js";
import { Route as metricsRoute } from "../src/routes/api/public/metrics.js";

console.log("funnelsRoute handlers:", Object.keys((funnelsRoute.options as any)?.server?.handlers ?? {}));
console.log("stageCountsRoute handlers:", Object.keys((stageCountsRoute.options as any)?.server?.handlers ?? {}));
console.log("metricsRoute handlers:", Object.keys((metricsRoute.options as any)?.server?.handlers ?? {}));
