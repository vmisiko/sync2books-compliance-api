import type {
  ClassificationResolution,
  IClassificationResolver,
} from '../domain/ports/classification-resolver.port';

/**
 * Stub - replace with mapping-table-backed implementation.
 * Resolution order: merchant override → rule-based → default.
 */
export class ClassificationResolverStub implements IClassificationResolver {
  async resolveClassification(): Promise<ClassificationResolution> {
    return Promise.resolve({
      classificationCode: '1234567890',
      unitCode: 'EA',
      source: 'default',
    });
  }
}
