import { HelperError } from '@shared/helperProtocol'
import { helperHas, helperRequest } from '../native/helper'
import type { AppleBackend } from './ai'

/** Apple's on-device model, reached through the Swift helper. */
export const helperAppleModel: AppleBackend = {
  async status() {
    if (!helperHas('llm')) throw new HelperError('unavailable', 'The helper has no language model support')
    return helperRequest('llm.status', {}, { timeoutMs: 5_000 })
  },
  generate(params, timeoutMs) {
    return helperRequest('llm.generate', params, { timeoutMs })
  }
}
