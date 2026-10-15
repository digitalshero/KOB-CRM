export const KPIS = [
  {
    key: "leads",
    label: "Leads",
    icon: "users",
    value: "820",
    mom: "+3.80%",
    momDir: "up" as const,
    target: "Target: 1,000",
    ach: "Ach 82.00%",
    achTone: "good" as const,
    runRate: "3,075",
  },
  {
    key: "contracts",
    label: "Contracts",
    icon: "file",
    value: "118",
    mom: "+7.30%",
    momDir: "up" as const,
    target: "Target: 150",
    ach: "Ach 78.67%",
    achTone: "bad" as const,
    runRate: "443",
  },
  {
    key: "conv",
    label: "Conv %",
    icon: "filter",
    value: "14.39%",
    mom: "+0.60%",
    momDir: "up" as const,
    target: "Target: 15.00%",
    ach: "Ach 95.93%",
    achTone: "good" as const,
    runRate: "14.39%",
  },
  {
    key: "cpl",
    label: "CPL (₹)",
    icon: "rupee",
    value: "430",
    mom: "-8.50%",
    momDir: "down" as const,
    target: "Target: 450",
    ach: "Ach 104.65%",
    achTone: "good" as const,
    runRate: "₹ 430",
  },
  {
    key: "zones",
    label: "High-Priority Zones",
    icon: "flame",
    value: "42",
    mom: "+16.67%",
    momDir: "up" as const,
    target: "Target: 60",
    ach: "Ach 70.00%",
    achTone: "bad" as const,
    runRate: "",
  },
  {
    key: "void",
    label: "Void Rate",
    icon: "ban",
    value: "56 · 6.78%",
    mom: "-1.34%",
    momDir: "down" as const,
    target: "Target: 5.00%",
    ach: "Ach -35.60%",
    achTone: "bad" as const,
    runRate: "",
  },
  {
    key: "abandoned",
    label: "Abandoned Leads",
    icon: "ban",
    value: "0",
    mom: "—",
    momDir: "down" as const,
    target: "Not auto-fired",
    ach: "—",
    achTone: "bad" as const,
    runRate: "",
  },
  {
    key: "failedFire",
    label: "Failed Fire",
    icon: "ban",
    value: "0",
    mom: "—",
    momDir: "down" as const,
    target: "No message triggered",
    ach: "—",
    achTone: "bad" as const,
    runRate: "",
  },
];


export const MANUAL_FUNNEL = [
  { stage: "Lead Generated", fired: 820, notFired: 0, pct: "100.00%", color: "#7c3aed", width: 100, link: false },
  { stage: "EOI 1", fired: 512, notFired: 308, pct: "62.44%", color: "#6366f1", width: 90, link: true },
  { stage: "Webinar", fired: 366, notFired: 146, pct: "44.63%", color: "#3b82f6", width: 80, link: false },
  { stage: "EOI 2", fired: 248, notFired: 118, pct: "30.24%", color: "#14b8a6", width: 70, link: true },
  { stage: "Fee Paid", fired: 118, notFired: 130, pct: "14.39%", color: "#10b981", width: 62, link: false },
  { stage: "Contract Signed", fired: 96, notFired: 22, pct: "11.71%", color: "#f59e0b", width: 54, link: false },
];

export const AUTO_FUNNEL = [
  { stage: "Lead Generated", fired: 820, notFired: 0, pct: "100.00%", color: "#7c3aed", width: 100, link: false },
  { stage: "EOI 1 Auto-Fired", fired: 742, notFired: 78, pct: "90.49%", color: "#6366f1", width: 92, link: true },
  { stage: "Webinar Invite Sent", fired: 596, notFired: 146, pct: "72.68%", color: "#3b82f6", width: 84, link: true },
  { stage: "Webinar Attendees", fired: 388, notFired: 208, pct: "47.32%", color: "#0ea5e9", width: 78, link: false },
  { stage: "EOI 2", fired: 296, notFired: 92, pct: "36.10%", color: "#14b8a6", width: 70, link: true },
  { stage: "Fee Paid", fired: 152, notFired: 144, pct: "18.54%", color: "#10b981", width: 62, link: false },
  { stage: "Contract Signed", fired: 138, notFired: 14, pct: "16.83%", color: "#f59e0b", width: 54, link: false },
];

export const TREND = [
  { date: "Jun 08", leads: 33, contracts: 24, conv: 3.2 },
  { date: "Jun 10", leads: 38, contracts: 27, conv: 3.4 },
  { date: "Jun 12", leads: 41, contracts: 30, conv: 3.3 },
  { date: "Jun 14", leads: 39, contracts: 28, conv: 3.5 },
  { date: "Jun 16", leads: 37, contracts: 25, conv: 3.1 },
  { date: "Jun 18", leads: 43, contracts: 29, conv: 3.4 },
  { date: "Jun 20", leads: 45, contracts: 31, conv: 3.6 },
  { date: "Jun 22", leads: 44, contracts: 28, conv: 3.5 },
  { date: "Jun 24", leads: 47, contracts: 30, conv: 3.7 },
  { date: "Jun 26", leads: 49, contracts: 33, conv: 3.6 },
  { date: "Jun 28", leads: 46, contracts: 31, conv: 3.8 },
  { date: "Jun 30", leads: 44, contracts: 30, conv: 3.6 },
  { date: "Jul 02", leads: 42, contracts: 28, conv: 3.5 },
  { date: "Jul 04", leads: 47, contracts: 33, conv: 3.9 },
  { date: "Jul 06", leads: 50, contracts: 36, conv: 4.0 },
  { date: "Jul 08", leads: 52, contracts: 38, conv: 4.1 },
];

export const EXECS = [
  { name: "Arun", leads: 120, contracts: 24, target: 25, conv: "20.00%", pending: 8 },
  { name: "Bala", leads: 98, contracts: 18, target: 20, conv: "18.37%", pending: 11 },
  { name: "Kumar", leads: 110, contracts: 15, target: 22, conv: "13.64%", pending: 22 },
  { name: "Harish", leads: 95, contracts: 14, target: 19, conv: "14.74%", pending: 13 },
  { name: "Deepak", leads: 85, contracts: 12, target: 17, conv: "14.12%", pending: 12 },
];

// Coming Soon — forced to 0 until a real "untouched leads" computation exists.
export const UNTOUCHED = [
  { label: "Today", value: 0, pct: "0.00%", tone: "text-sky-600" },
  { label: "1 Day", value: 0, pct: "0.00%", tone: "text-emerald-600" },
  { label: "2 Days", value: 0, pct: "0.00%", tone: "text-amber-600" },
  { label: "3+ Days", value: 0, pct: "0.00%", tone: "text-rose-600" },
];

// Coming Soon — forced to 0 until a real state-wise spread computation exists.
export const STATES = [
  { state: "Tamil Nadu", leads: 0, conv: "0.00%", coverage: "0.00%" },
  { state: "Karnataka", leads: 0, conv: "0.00%", coverage: "0.00%" },
  { state: "Telangana", leads: 0, conv: "0.00%", coverage: "0.00%" },
  { state: "Kerala", leads: 0, conv: "0.00%", coverage: "0.00%" },
  { state: "Andhra Pradesh", leads: 0, conv: "0.00%", coverage: "0.00%" },
];

export const SIMPLE_FUNNEL = [
  { stage: "Leads", fired: 820, notFired: 0, pct: "100.00%", color: "#7c3aed", width: 100, link: false },
  { stage: "EOI 1", fired: 656, notFired: 164, pct: "80.00%", color: "#6366f1", width: 90, link: true },
  { stage: "Webinar", fired: 512, notFired: 144, pct: "62.44%", color: "#3b82f6", width: 80, link: false },
  { stage: "EOI 2", fired: 425, notFired: 87, pct: "51.83%", color: "#14b8a6", width: 70, link: true },
  { stage: "Fee Paid", fired: 215, notFired: 210, pct: "26.22%", color: "#10b981", width: 60, link: false },
  { stage: "Contract Signed", fired: 194, notFired: 21, pct: "23.66%", color: "#f59e0b", width: 50, link: false },
];

export const CHANNELS = [
  { channel: "Marketing", leads: 310, conv: "14.84%", target: "16.00%", cpl: "₹ 512" },
  { channel: "Website", leads: 205, conv: "16.59%", target: "15.00%", cpl: "₹ 386" },
  { channel: "Organic", leads: 168, conv: "12.50%", target: "14.00%", cpl: "₹ 0" },
  { channel: "Referral", leads: 137, conv: "12.41%", target: "13.00%", cpl: "₹ 190" },
];

export const ACTIONS = [
  { task: "Approve July partner incentive slab", owner: "R. Menon", due: "Today", age: "0d", status: "Pending" },
  { task: "Publish Q2 KOB SOP v3 to all executives", owner: "S. Iyer", due: "10 Jul", age: "2d", status: "In Review" },
  { task: "Approve 6 new kitchen inactivation requests", owner: "V. Rao", due: "09 Jul", age: "1d", status: "Pending" },
  { task: "Sign off Andhra Pradesh CPL correction plan", owner: "R. Menon", due: "12 Jul", age: "3d", status: "Blocked" },
];

export const SUMMARY = [
  { label: "Follow-up Due Today", value: 0, icon: "clock", bg: "bg-sky-50", ring: "border-sky-100", tone: "text-sky-600" },
  { label: "Documents Pending", value: 0, icon: "file", bg: "bg-amber-50", ring: "border-amber-100", tone: "text-amber-600" },
  { label: "Agreement Pending", value: 0, icon: "pen", bg: "bg-orange-50", ring: "border-orange-100", tone: "text-orange-600" },
  { label: "Escalations", value: 0, icon: "alert", bg: "bg-rose-50", ring: "border-rose-100", tone: "text-rose-600" },
];
