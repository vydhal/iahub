import { Queue, Worker } from 'bullmq';
import { redisConnection } from '../config/redis.js';
import { orchestratorService } from '../shared/orchestrator/OrchestratorService.js';

export const CAMPAIGN_QUEUE_NAME = 'campaign-orchestration';

export const campaignQueue = new Queue(CAMPAIGN_QUEUE_NAME, {
  connection: redisConnection,
});

export const campaignWorker = new Worker(
  CAMPAIGN_QUEUE_NAME,
  async (job) => {
    console.log(`📥 Processando job de campanha #${job.id} (Campanha ID: ${job.data.campaignId})`);
    const { campaignId } = job.data;

    await orchestratorService.executeCampaignWorkflow(campaignId, (step, label) => {
      job.updateProgress({ step, label });
    });

    return { success: true, campaignId };
  },
  { connection: redisConnection }
);

campaignWorker.on('completed', (job) => {
  console.log(`🎉 Job #${job.id} concluído com sucesso!`);
});

campaignWorker.on('failed', (job, err) => {
  console.error(`💥 Job #${job?.id} falhou:`, err);
});
