import { redact } from '../../shared/security/crypto.js';
import { AgentOpsError, ExecutionTimeoutError, InterventionError } from '../errors.js';
import { buildNow, resolveTemplates } from '../templating.js';
import { PlaybookSchema } from '../types.js';
import { ExecutionProvider, ExecutionRunContext, ProviderOutcome } from './ExecutionProvider.js';

/**
 * Runtime próprio da Simplisoft: executa o playbook do agente etapa a etapa via Tool Gateway.
 * Cada etapa concluída é persistida — um retry ou uma aprovação retoma de onde parou.
 */
export class NativeExecutionProvider implements ExecutionProvider {
  id = 'native';
  label = 'Runtime Simplisoft';
  description = 'Executa o playbook (API, RPA, IA, entrega) no worker da própria plataforma.';

  async run(ctx: ExecutionRunContext): Promise<ProviderOutcome> {
    const { agent, execution, state, gateway, logger } = ctx;
    const parsed = PlaybookSchema.safeParse(agent.playbook ?? []);
    if (!parsed.success || !parsed.data.length) {
      throw new InterventionError('O agente não possui um playbook válido (aba Ferramentas & etapas).');
    }
    const playbook = parsed.data;

    for (let i = state.nextStep; i < playbook.length; i++) {
      if (ctx.signal.aborted) throw new ExecutionTimeoutError(`Duração máxima de ${agent.maxDurationSec}s excedida.`);
      if (await ctx.isCancelled()) return { status: 'cancelled' };

      const step = playbook[i];
      if (state.rejectedSteps.includes(step.id)) {
        if (state.stepStatus[step.id] !== 'rejected') {
          state.outputs[step.id] = { rejected: true };
          state.stepStatus[step.id] = 'rejected';
          await logger.warn(`${step.label}: ação rejeitada pelo aprovador — etapa ignorada.`, { stepId: step.id });
        }
        state.nextStep = i + 1;
        await ctx.saveState(state);
        continue;
      }

      const tool = gateway.tool(step.tool);
      const templateCtx = {
        input: execution.input ?? {},
        steps: Object.fromEntries(Object.entries(state.outputs).map(([k, v]) => [k, { output: v }])),
        agent: { name: agent.name, objective: agent.objective },
        now: buildNow(agent.timezone),
        sandbox: execution.sandbox,
      };
      const raw = { ...resolveTemplates(step.input, templateCtx), ...(state.overrides[step.id] || {}) };
      const inputCheck = tool.inputSchema.safeParse(raw);
      if (!inputCheck.success) {
        const detail = inputCheck.error.issues.map((x) => `${x.path.join('.') || '(input)'}: ${x.message}`).join('; ');
        throw Object.assign(new InterventionError(`Configuração inválida na etapa "${step.label}": ${detail}`), { stepId: step.id });
      }
      const input = inputCheck.data;
      const decision = gateway.decide(step, tool, input, state.approvedSteps.includes(step.id));

      if (decision.mode === 'approval') {
        state.nextStep = i;
        await ctx.saveState(state);
        return {
          status: 'waiting_approval',
          approval: {
            stepId: step.id,
            title: `${agent.name}: ${step.label}`,
            proposedAction: { tool: tool.name, toolLabel: tool.label, permission: decision.permission, reason: decision.reason, input: redact(input) },
          },
        };
      }

      if (decision.mode === 'skip' || decision.mode === 'simulate') {
        state.outputs[step.id] = { [decision.mode === 'skip' ? 'skipped' : 'simulated']: true, reason: decision.reason, wouldExecute: redact(input) };
        state.stepStatus[step.id] = decision.mode === 'skip' ? 'skipped' : 'simulated';
        if (decision.mode === 'skip' && decision.recommendation) {
          state.recommendations.push({ step: step.label, tool: tool.name, action: redact(input) });
        }
        await logger.warn(`${step.label}: ${decision.reason}`, { stepId: step.id, tool: tool.name, data: { wouldExecute: input } });
      } else {
        try {
          const result = await gateway.call(step, tool, input, ctx.signal);
          state.outputs[step.id] = result.output;
          state.stepStatus[step.id] = 'done';
        } catch (err) {
          const e = err as AgentOpsError;
          if (step.onError === 'continue' && e.kind !== 'POLICY_BLOCKED') {
            state.outputs[step.id] = { error: e.message };
            state.stepStatus[step.id] = 'failed';
            await logger.warn(`${step.label}: falhou (${e.message}) — etapa configurada para continuar.`, { stepId: step.id });
          } else {
            throw Object.assign(e, { stepId: step.id });
          }
        }
      }

      state.nextStep = i + 1;
      await ctx.saveState(state);
    }

    const resultStep = playbook.find((s) => s.result) || [...playbook].reverse().find((s) => s.tool === 'ai.analyze');
    const result = resultStep ? state.outputs[resultStep.id] : null;
    return {
      status: 'completed',
      output: {
        summary: typeof result?.text === 'string' ? result.text : result,
        resultStep: resultStep?.id ?? null,
        recommendations: state.recommendations,
        steps: playbook.map((s) => ({ id: s.id, label: s.label, tool: s.tool, status: state.stepStatus[s.id] || 'pending' })),
      },
    };
  }
}
