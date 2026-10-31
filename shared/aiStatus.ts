/** Why Apple's model can't answer, in the user's words. */
export function describeAppleReason(reason: string | null | undefined): string {
  switch (reason) {
    case 'not_enabled':
      return 'Turn on Apple Intelligence in System Settings to use it.'
    case 'model_not_ready':
      return 'Apple Intelligence is still downloading its model.'
    case 'device_not_eligible':
      return 'This Mac can’t run Apple Intelligence.'
    case 'os_too_old':
      return 'Apple Intelligence needs macOS 26 or later.'
    default:
      return 'Apple Intelligence isn’t available right now.'
  }
}
