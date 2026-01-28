import { z } from 'zod';

interface JsonSchema {
    type?: string;
    description?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    items?: unknown;
    additionalProperties?: boolean | unknown;
}

export function jsonSchemaToZod(schema: JsonSchema | string): z.ZodTypeAny {
    if (!schema) return z.any();
    if (typeof schema === 'string') {
        // handle shorthand types? "string", "number"
        if (schema === 'string') return z.string();
        if (schema === 'number') return z.number();
        if (schema === 'boolean') return z.boolean();
        return z.any();
    }

    const type = schema.type;

    if (type === 'string') {
        let s = z.string();
        if (schema.description) s = s.describe(schema.description);
        return s;
    }
    else if (type === 'number' || type === 'integer') {
        let n = z.number();
        if (schema.description) n = n.describe(schema.description);
        return n;
    }
    else if (type === 'boolean') {
        let b = z.boolean();
        if (schema.description) b = b.describe(schema.description);
        return b;
    }
    else if (type === 'array') {
        const itemSchema = schema.items ? jsonSchemaToZod(schema.items as JsonSchema) : z.any();
        let a = z.array(itemSchema);
        if (schema.description) a = a.describe(schema.description);
        return a;
    }
    else if (type === 'object') {
        const shape: Record<string, z.ZodTypeAny> = {};
        const props = (schema.properties || {}) as Record<string, JsonSchema>;
        const required = new Set(Array.isArray(schema.required) ? schema.required : []);

        for (const [key, propSchema] of Object.entries(props)) {
            let zodProp = jsonSchemaToZod(propSchema);
            if (!required.has(key)) {
                zodProp = zodProp.optional();
            }
            shape[key] = zodProp;
        }

        // Handle record (additionalProperties) if no properties defined?
        // simple map support
        if (Object.keys(props).length === 0 && schema.additionalProperties !== false) {
            return z.record(z.string(), z.any());
        }

        let o = z.object(shape);
        if (schema.description) o = o.describe(schema.description);
        return o;
    }

    return z.any();
}
