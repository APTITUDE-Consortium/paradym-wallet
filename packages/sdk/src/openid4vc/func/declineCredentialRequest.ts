import type { ParadymWalletSdk } from '../../ParadymWalletSdk'
import { type ActivityStatus, storeSharedActivityForCredentialsForRequest } from '../../storage/activityStore'
import type { CredentialsForProofRequest } from '../func/resolveCredentialRequest'
import { getFormattedTransactionData } from '../transaction'
import {
  type OpenId4VpAuthorizationErrorCode,
  type OpenId4VpAuthorizationErrorResponseResult,
  sendAuthorizationErrorResponse,
} from './sendAuthorizationErrorResponse'

export type DeclineCredentialRequestOptions = {
  paradym: ParadymWalletSdk
  resolvedRequest: CredentialsForProofRequest
  error?: OpenId4VpAuthorizationErrorCode
  errorDescription?: string
  activityStatus?: Exclude<ActivityStatus, 'pending'>
  openRedirectUri?: boolean
}

export const declineCredentialRequest = async ({
  resolvedRequest,
  paradym,
  error = 'access_denied',
  errorDescription,
  activityStatus = resolvedRequest.formattedSubmission.areAllSatisfied ? 'stopped' : 'failed',
  openRedirectUri = true,
}: DeclineCredentialRequestOptions): Promise<OpenId4VpAuthorizationErrorResponseResult> => {
  const formattedTransactionData = getFormattedTransactionData(resolvedRequest)

  try {
    return await sendAuthorizationErrorResponse({
      paradym,
      resolvedRequest,
      error,
      errorDescription,
      openRedirectUri,
    })
  } finally {
    await storeSharedActivityForCredentialsForRequest(
      paradym,
      resolvedRequest,
      activityStatus,
      formattedTransactionData
    )
  }
}
