import { ExecutionProvider } from './ExecutionProvider.js';
import { NativeExecutionProvider } from './NativeExecutionProvider.js';

// Registro de provedores de execução. Um CoworkProvider/ClaudeCodeProvider futuro entra aqui
// implementando a mesma interface — agentes, fila, logs e aprovação não mudam.
const providers: ExecutionProvider[] = [new NativeExecutionProvider()];

export const executionProviders = new Map(providers.map((p) => [p.id, p]));

export function providerCatalog() {
  return providers.map((p) => ({ id: p.id, label: p.label, description: p.description }));
}
