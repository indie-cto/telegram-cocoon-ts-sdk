/**
 * Models resource — list available AI models on the network.
 *
 * Uses client.getWorkerTypesV2 TL function to query the proxy.
 */

import type { CocoonSession } from '../../core/protocol/session.js';
import type { ClientWorkerTypesV2 } from '../../core/tl/types.js';
import type { Model, ModelList } from '../../types/models.js';

type SessionProvider = () => Promise<CocoonSession>;

export class Models {
  constructor(private readonly getSession: SessionProvider) {}

  /**
   * List all available models on the network.
   */
  async list(): Promise<ModelList> {
    const session = await this.getSession();

    const result = await session.sendRpcQuery({
      _type: 'client.getWorkerTypesV2',
    });

    const workerTypes = result as unknown as ClientWorkerTypesV2;

    const models: Model[] = workerTypes.types.map((wt) => {
      const totalWorkers = wt.workers.length;
      const coefficients = wt.workers.map((w) => w.coefficient);
      const minCoeff = coefficients.length > 0 ? Math.min(...coefficients) : 0;
      const maxCoeff = coefficients.length > 0 ? Math.max(...coefficients) : 0;

      return {
        id: wt.name,
        object: 'model' as const,
        created: Math.floor(Date.now() / 1000),
        owned_by: 'cocoon',
        active_workers: totalWorkers,
        coefficient_min: minCoeff,
        coefficient_max: maxCoeff,
      };
    });

    return {
      object: 'list',
      data: models,
    };
  }
}
