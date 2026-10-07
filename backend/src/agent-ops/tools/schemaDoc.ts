import { z } from 'zod';

// Descrição enxuta dos campos de entrada de uma ferramenta, para o catálogo exibido na UI.
function typeName(schema: z.ZodTypeAny): string {
  const def: any = schema._def;
  switch (def.typeName) {
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodNullable':
      return typeName(def.innerType);
    case 'ZodString': return 'texto';
    case 'ZodNumber': return 'número';
    case 'ZodBoolean': return 'sim/não';
    case 'ZodEnum': return def.values.join(' | ');
    case 'ZodArray': return `lista de ${typeName(def.type)}`;
    case 'ZodRecord':
    case 'ZodObject': return 'objeto';
    case 'ZodUnion': return def.options.map(typeName).join(' ou ');
    case 'ZodDiscriminatedUnion': return 'ação';
    default: return 'qualquer';
  }
}

export function zodToCatalog(schema: z.ZodTypeAny) {
  const def: any = schema._def;
  const shape = def.typeName === 'ZodObject' ? def.shape() : def.schema?._def?.shape?.();
  if (!shape) return [];
  return Object.entries(shape as Record<string, z.ZodTypeAny>).map(([name, s]) => ({
    name,
    type: typeName(s),
    required: !s.isOptional(),
  }));
}
