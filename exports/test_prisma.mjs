import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';

const match = fs.readFileSync('.env', 'utf8').match(/DATABASE_URL="([^"]+)"/);
const connectionString = match[1];

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function test() {
  const leadsCount = await prisma.kob_leads.count();
  const stagesCount = await prisma.lead_stage_history.count();
  const activitiesCount = await prisma.lead_activities.count();
  const eventsCount = await prisma.lead_events.count();
  const auditCount = await prisma.audit_logs.count();

  console.log('PRISMA QUERY TEST ON kob_local:');
  console.log('kob_leads count         :', leadsCount);
  console.log('lead_stage_history count :', stagesCount);
  console.log('lead_activities count    :', activitiesCount);
  console.log('lead_events count        :', eventsCount);
  console.log('audit_logs count         :', auditCount);

  await prisma.$disconnect();
}

test().catch(e => {
  console.error('Prisma test error:', e);
  process.exit(1);
});
