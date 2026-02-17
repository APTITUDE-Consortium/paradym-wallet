import { type DigitalCredentialsRequest, sendErrorResponse, sendResponse } from '@animo-id/expo-digital-credentials-api'
import { getHostNameFromUrl } from '@package/utils'
import type { EitherAgent } from '../agent'
import { type CredentialsForProofRequest, getCredentialsForProofRequest } from '../invitation'
import { shareProof } from '../invitation/shareProof'

export async function resolveRequestForDcApi({
  agent,
  request,
}: {
  agent: EitherAgent
  request: DigitalCredentialsRequest
}): Promise<CredentialsForProofRequest> {
  const providerRequest = request.request.requests
    ? request.request.requests[request.selectedEntry.providerIndex].data
    : request.request.providers[request.selectedEntry.providerIndex].request

  const authorizationRequestPayload =
    typeof providerRequest === 'string' ? JSON.parse(providerRequest) : providerRequest

  // TODO: should allow limiting it to a specific credential (as we already know the credential id)
  const result = await getCredentialsForProofRequest({
    agent,
    requestPayload: authorizationRequestPayload,
    origin: request.origin,
  })

  agent.config.logger.debug('Resolved request', {
    result,
  })

  let credentialFound = false
  for (const entry of result.formattedSubmission.entries) {
    if (entry.isSatisfied) {
      const credential = entry.credentials.find((c) => c.credential.record.id === request.selectedEntry.credentialId)
      if (credential) {
        // Update to only contain the already selected credential
        entry.credentials = [credential]
        credentialFound = true
      }
    }
  }

  if (!credentialFound) {
    throw new Error(
      `Could not find selected credential with id '${request.selectedEntry.credentialId}' in formatted submission`
    )
  }

  return {
    ...result,
    verifier: {
      ...result.verifier,
      hostName: getHostNameFromUrl(request.origin),
    },
  } satisfies CredentialsForProofRequest
}

export async function sendResponseForDcApi({
  agent,
  resolvedRequest,
  dcRequest,
}: {
  agent: EitherAgent
  resolvedRequest: CredentialsForProofRequest
  dcRequest: DigitalCredentialsRequest
}) {
  const selectedCredentials: { [inputDescriptorId: string]: string } = {}
  const credentialIds: string[] = []

  for (const entry of resolvedRequest.formattedSubmission.entries) {
    if (!entry.isSatisfied) {
      agent.config.logger.debug('Expected entry to be satisfied for DC API response', {
        resolvedRequest,
        dcRequest,
        entry,
      })
      throw new Error('Expected entry to be satisfied for DC API response')
    }

    // We take the first credential. In resolveRequestForDcApi we already filtered the
    // entry that matches the selected credential to only contain that credential.
    // For other entries we just take the first one.
    const credential = entry.credentials[0]
    selectedCredentials[entry.inputDescriptorId] = credential.credential.record.id
    credentialIds.push(credential.credential.record.id)
  }

  const acceptTransactionData =
    resolvedRequest.transactionData && resolvedRequest.transactionData.length > 0
      ? credentialIds.map((credentialId) => ({ credentialId }))
      : undefined

  const result = await shareProof({
    agent,
    resolvedRequest,
    selectedCredentials,
    acceptTransactionData,
  })

  agent.config.logger.debug('Sending response for Digital Credentials API', {
    result,
  })

  sendResponse({
    response: JSON.stringify(result.authorizationResponse),
  })
}

export async function sendErrorResponseForDcApi(errorMessage: string) {
  sendErrorResponse({
    errorMessage,
  })
}
