import type { Tool } from '@aws-sdk/client-bedrock-runtime';

// Tool schemas exposed to Claude via Bedrock Converse `toolConfig`.
// `patient_id` is intentionally NOT in any schema — it's bound by the
// controller from the URL path and passed to ToolsService.execute() server-side.

export const TOOL_DEFINITIONS: Tool[] = [
  {
    toolSpec: {
      name: 'get_medications',
      description:
        'Return medications for the current patient. Set active_only=true for currently-prescribed meds (default true). Use since to filter by start date.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            active_only: { type: 'boolean', default: true },
            since: { type: 'string', format: 'date' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_conditions',
      description:
        'Return diagnoses/conditions for the current patient. Set active_only=true for unresolved conditions.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            active_only: { type: 'boolean', default: false },
            code_system: { type: 'string', enum: ['SNOMED', 'ICD10'] },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_labs',
      description:
        'Return laboratory observations for the current patient. By default returns ONLY the most recent value per LOINC code (latest_only=true). Set latest_only=false to retrieve historical trend data. Filter by LOINC codes or date range.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            loinc_codes: { type: 'array', items: { type: 'string' } },
            since: { type: 'string', format: 'date' },
            until: { type: 'string', format: 'date' },
            latest_only: { type: 'boolean', default: true },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_allergies',
      description: 'Return all known allergies for the current patient.',
      inputSchema: {
        json: { type: 'object', properties: {}, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_encounters',
      description:
        'Return encounters (visits/admissions) for the current patient. Filter by date or type.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            since: { type: 'string', format: 'date' },
            type: { type: 'string' },
          },
          required: [],
        },
      },
    },
  },
  {
    toolSpec: {
      name: 'get_immunizations',
      description: 'Return immunizations administered to the current patient.',
      inputSchema: {
        json: { type: 'object', properties: {}, required: [] },
      },
    },
  },
  {
    toolSpec: {
      name: 'search_notes',
      description:
        'Semantic search over clinical notes for the current patient only. Use when the question requires narrative context (e.g., assessment, plan, HPI). Returns top-k chunks with section and similarity.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            k: { type: 'integer', default: 5, minimum: 1, maximum: 20 },
          },
          required: ['query'],
        },
      },
    },
  },
];
