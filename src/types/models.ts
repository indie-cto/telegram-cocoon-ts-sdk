/**
 * OpenAI-compatible model types.
 */

export interface Model {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  /** Cocoon-specific: number of active workers for this model */
  active_workers?: number;
  /** Cocoon-specific: coefficient range */
  coefficient_min?: number;
  coefficient_max?: number;
}

export interface ModelList {
  object: 'list';
  data: Model[];
}
