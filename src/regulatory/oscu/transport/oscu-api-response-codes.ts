/**
 * OSCU API response codes.
 * Source: spec section "API Response Code" (listed as 4.18 in the extracted text).
 */

export type OscuResponseCodeSystem = 'Server' | 'Client';

export type OscuResponseCodeDefinition = {
  code: string;
  system: OscuResponseCodeSystem;
  description: string;
};

export const OSCU_API_RESPONSE_CODES: ReadonlyArray<OscuResponseCodeDefinition> =
  [
    { code: '000', system: 'Server', description: 'It is succeeded' },
    {
      code: '001',
      system: 'Server',
      description: 'There is no search result',
    },
    {
      code: '891',
      system: 'Client',
      description: 'An error occurred while Request URL is created.',
    },
    {
      code: '892',
      system: 'Client',
      description: 'An error occurred while Request Header data is created.',
    },
    {
      code: '893',
      system: 'Client',
      description: 'An error occurred while Request Body data is created.',
    },
    {
      code: '894',
      system: 'Client',
      description: 'An error regarding server communication occurred.',
    },
    {
      code: '895',
      system: 'Client',
      description: 'An error regarding unallowed Request Method occurred.',
    },
    {
      code: '896',
      system: 'Client',
      description: 'An error regarding Request Status occurred.',
    },
    {
      code: '899',
      system: 'Client',
      description: 'An error regarding Client occurred.',
    },
    {
      code: '900',
      system: 'Server',
      description: 'There is no Header information',
    },
    { code: '901', system: 'Server', description: 'It is not valid device' },
    { code: '902', system: 'Server', description: 'This device is installed' },
    {
      code: '903',
      system: 'Server',
      description: 'Only OSCU device can be verified.',
    },
    { code: '910', system: 'Server', description: 'Request parameter error' },
    {
      code: '911',
      system: 'Server',
      description: 'There is no request full text',
    },
    {
      code: '912',
      system: 'Server',
      description: 'There is a request Method error.',
    },
    {
      code: '921',
      system: 'Server',
      description:
        'Sales or sales invoice data which is declared cannot be received.',
    },
    {
      code: '922',
      system: 'Server',
      description:
        'Sales invoice data can be received after receiving the sales data.',
    },
    {
      code: '990',
      system: 'Server',
      description: 'The maxium number of views are exceeded',
    },
    {
      code: '991',
      system: 'Server',
      description: 'There is an error during registration',
    },
    {
      code: '992',
      system: 'Server',
      description: 'There is an error during modification',
    },
    {
      code: '993',
      system: 'Server',
      description: 'There is an error during deletion',
    },
    {
      code: '994',
      system: 'Server',
      description: 'There is an overlapped Data',
    },
    {
      code: '995',
      system: 'Server',
      description: 'There is no downloaded file',
    },
    {
      code: '999',
      system: 'Server',
      description: 'There is an unknown error. Please ask it administrator',
    },
  ];

export function getOscuResponseCodeDefinition(
  code: string,
): OscuResponseCodeDefinition | undefined {
  return OSCU_API_RESPONSE_CODES.find((c) => c.code === code);
}

export function isOscuSuccess(code: string): boolean {
  return code === '000';
}

export function isOscuNoResult(code: string): boolean {
  return code === '001';
}

/**
 * Conservative retry hint:
 * - Spec does not prescribe retry strategy, but communication errors are typically retryable.
 */
export function isOscuRetryable(code: string): boolean {
  return code === '894' || code === '999';
}
