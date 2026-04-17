import type { CredentialDataHandlerOptions } from '@package/app'
import type { InvitationType } from '@paradym/wallet-sdk'
import { useFeatureFlag } from '../hooks/useFeatureFlag'

const isDIDCommEnabled = useFeatureFlag('DIDCOMM')

export const credentialDataHandlerOptions = {
  routeMethod: 'push',
  allowedInvitationTypes: [
    'openid-credential-offer',
    'openid-authorization-request',
    ...(isDIDCommEnabled ? (['didcomm'] as InvitationType[]) : []),
  ],
} satisfies CredentialDataHandlerOptions
